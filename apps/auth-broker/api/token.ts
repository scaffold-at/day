import type { VercelRequest, VercelResponse } from "@vercel/node";
import { loadBrokerConfig } from "./_lib/config.js";
import { getSql } from "./_lib/db.js";
import { exchangeRefreshToken } from "./_lib/google-refresh.js";
import { findGoogleTokenByBrokerSession } from "./_lib/token-store.js";

function readBearerToken(req: VercelRequest): string | undefined {
  const authorization = req.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) return undefined;
  return authorization.slice("Bearer ".length).trim();
}

function readBodyBrokerSessionToken(req: VercelRequest): string | undefined {
  const body = req.body as unknown;
  if (body && typeof body === "object" && "broker_session_token" in body) {
    const token = (body as { broker_session_token?: unknown }).broker_session_token;
    return typeof token === "string" && token.trim() ? token.trim() : undefined;
  }
  return undefined;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    const config = loadBrokerConfig();
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      res.status(405).json({ ok: false, error: "Method not allowed" });
      return;
    }

    const brokerSessionToken = readBearerToken(req) ?? readBodyBrokerSessionToken(req);
    if (!brokerSessionToken) {
      res.status(401).json({ ok: false, error: "Missing broker session token" });
      return;
    }

    const storedToken = await findGoogleTokenByBrokerSession(
      getSql(),
      brokerSessionToken,
      config.brokerSessionSigningKey,
      config.tokenEncryptionKey,
    );
    if (!storedToken) {
      res.status(401).json({ ok: false, error: "Invalid or expired broker session" });
      return;
    }

    const accessToken = await exchangeRefreshToken({
      refreshToken: storedToken.refreshToken,
      clientId: config.googleClientId,
      clientSecret: config.googleClientSecret,
    });

    res.status(200).json({
      ok: true,
      account_email: storedToken.email,
      access_token: accessToken.accessToken,
      expires_in: accessToken.expiresIn,
      token_type: accessToken.tokenType,
      scope: accessToken.scope ?? storedToken.scope,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Failed to mint Google access token",
    });
  }
}
