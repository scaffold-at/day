import type { VercelRequest, VercelResponse } from "@vercel/node";
import { loadBrokerConfig } from "../../_lib/config.js";
import { buildGoogleAuthorizationUrl, randomState } from "../../_lib/google-oauth.js";

const ONE_HOUR_SECONDS = 60 * 60;

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

export default function handler(req: VercelRequest, res: VercelResponse): void {
  try {
    const config = loadBrokerConfig();
    const state = randomState();
    const returnUrl = firstQueryValue(req.query.return_url);
    const authorizationUrl = buildGoogleAuthorizationUrl({
      clientId: config.googleClientId,
      redirectUri: config.googleRedirectUri,
      state,
    });

    const cookies = [
      `google_oauth_state=${state}; Path=/api/auth/google; Max-Age=${ONE_HOUR_SECONDS}; HttpOnly; Secure; SameSite=Lax`,
    ];
    if (isAllowedCliReturnUrl(returnUrl)) {
      cookies.push(
        `google_oauth_return_url=${encodeURIComponent(returnUrl)}; Path=/api/auth/google; Max-Age=${ONE_HOUR_SECONDS}; HttpOnly; Secure; SameSite=Lax`,
      );
    }
    res.setHeader("Set-Cookie", cookies);
    res.writeHead(302, { Location: authorizationUrl.toString() });
    res.end();
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Failed to start Google OAuth",
    });
  }
}
