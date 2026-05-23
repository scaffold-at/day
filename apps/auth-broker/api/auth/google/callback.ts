import type { VercelRequest, VercelResponse } from "@vercel/node";
import { loadBrokerConfig } from "../../_lib/config.js";
import { getSql } from "../../_lib/db.js";
import { exchangeGoogleCode } from "../../_lib/google-oauth.js";
import { fetchGoogleUserInfo } from "../../_lib/google-userinfo.js";
import {
  initAuthBrokerSchema,
  storeGoogleTokenSet,
  upsertBrokerSession,
} from "../../_lib/token-store.js";

function getCookie(req: VercelRequest, name: string): string | undefined {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const [rawKey, ...rawValueParts] = part.trim().split("=");
    if (rawKey === name) return decodeURIComponent(rawValueParts.join("="));
  }
  return undefined;
}

function firstQueryValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isAllowedCliReturnUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost")
    );
  } catch {
    return false;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    const config = loadBrokerConfig();
    const error = firstQueryValue(req.query.error);
    if (error) {
      res.status(400).json({ ok: false, error });
      return;
    }

    const code = firstQueryValue(req.query.code);
    if (!code) {
      res.status(400).json({ ok: false, error: "Missing authorization code" });
      return;
    }

    const state = firstQueryValue(req.query.state);
    const expectedState = getCookie(req, "google_oauth_state");
    if (!state || !expectedState || state !== expectedState) {
      res.status(400).json({ ok: false, error: "Invalid OAuth state" });
      return;
    }

    const tokens = await exchangeGoogleCode({
      code,
      clientId: config.googleClientId,
      clientSecret: config.googleClientSecret,
      redirectUri: config.googleRedirectUri,
    });
    const user = await fetchGoogleUserInfo(tokens.accessToken);
    const sql = getSql();
    await initAuthBrokerSchema(sql);
    await storeGoogleTokenSet(
      sql,
      {
        googleSubject: user.sub,
        email: user.email,
        refreshToken: tokens.refreshToken,
        accessToken: tokens.accessToken,
        scope: tokens.scope,
        expiresIn: tokens.expiresIn,
      },
      config.tokenEncryptionKey,
    );
    const session = await upsertBrokerSession(
      sql,
      { googleSubject: user.sub, email: user.email },
      config.brokerSessionSigningKey,
    );

    const clearCookies = [
      "google_oauth_state=; Path=/api/auth/google; Max-Age=0; HttpOnly; Secure; SameSite=Lax",
      "google_oauth_return_url=; Path=/api/auth/google; Max-Age=0; HttpOnly; Secure; SameSite=Lax",
    ];
    res.setHeader("Set-Cookie", clearCookies);

    const returnUrl = getCookie(req, "google_oauth_return_url");
    if (isAllowedCliReturnUrl(returnUrl)) {
      const redirect = new URL(returnUrl);
      redirect.searchParams.set("broker_session_token", session.token);
      redirect.searchParams.set("account_email", user.email);
      redirect.searchParams.set("scope", tokens.scope);
      redirect.searchParams.set("broker_session_expires_at", session.expiresAt.toISOString());
      res.writeHead(302, { Location: redirect.toString() });
      res.end();
      return;
    }

    res.status(200).json({
      ok: true,
      mode: "broker-session-issued",
      email: user.email,
      brokerSessionToken: session.token,
      brokerSessionExpiresAt: session.expiresAt.toISOString(),
      hasRefreshToken: Boolean(tokens.refreshToken),
      scope: tokens.scope,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Failed to complete Google OAuth",
    });
  }
}
