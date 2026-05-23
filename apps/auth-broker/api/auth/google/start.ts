import type { VercelRequest, VercelResponse } from "@vercel/node";
import { loadBrokerConfig } from "../../_lib/config.js";
import { buildGoogleAuthorizationUrl, randomState } from "../../_lib/google-oauth.js";

const ONE_HOUR_SECONDS = 60 * 60;

export default function handler(_req: VercelRequest, res: VercelResponse): void {
  try {
    const config = loadBrokerConfig();
    const state = randomState();
    const authorizationUrl = buildGoogleAuthorizationUrl({
      clientId: config.googleClientId,
      redirectUri: config.googleRedirectUri,
      state,
    });

    res.setHeader("Set-Cookie", [
      `google_oauth_state=${state}; Path=/api/auth/google; Max-Age=${ONE_HOUR_SECONDS}; HttpOnly; Secure; SameSite=Lax`,
    ]);
    res.writeHead(302, { Location: authorizationUrl.toString() });
    res.end();
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Failed to start Google OAuth",
    });
  }
}
