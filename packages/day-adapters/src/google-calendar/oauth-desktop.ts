/**
 * Live Google OAuth desktop flow (PRD v0.2 §S70).
 *
 * PKCE-based authorization code flow per RFC 7636. The CLI:
 *   1. Generates a random `code_verifier` and `state`.
 *   2. Starts a local HTTP server bound to 127.0.0.1 on a free port.
 *   3. Opens the user's browser to Google's authorization URL with
 *      `redirect_uri = http://127.0.0.1:<port>/callback`.
 *   4. Receives the authorization code on the callback, validates
 *      `state`, then exchanges the code + verifier for tokens at
 *      Google's token endpoint.
 *   5. Returns the parsed GoogleOAuthToken.
 *
 * The desktop client_id / client_secret are *not* secrets in the
 * cryptographic sense — Google explicitly documents that desktop
 * apps may embed them, since anyone can extract them from a
 * distributed binary. Embedding follows the Google docs pattern:
 *   https://developers.google.com/identity/protocols/oauth2/native-app
 *
 * Forks override via `SCAFFOLD_DAY_GOOGLE_CLIENT_ID` /
 * `_CLIENT_SECRET` to redirect to their own Cloud project.
 */

import { ScaffoldError } from "@scaffold/day-core";
import type { GoogleOAuthToken } from "./token-storage";

const AUTH_BASE = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const USERINFO_ENDPOINT = "https://www.googleapis.com/oauth2/v3/userinfo";

const CLIENT_ID_ENV = "SCAFFOLD_DAY_GOOGLE_CLIENT_ID";
const CLIENT_SECRET_ENV = "SCAFFOLD_DAY_GOOGLE_CLIENT_SECRET";

/**
 * Default OAuth client. The client_id is fine to commit — Google
 * docs say desktop client_ids may be public. The client_secret is
 * NOT committed (GitHub secret scanning would block the push and,
 * more importantly, accidentally tagging it as a `GOCSPX-` literal
 * in repo history is bad hygiene).
 *
 * Instead, the release workflow injects the secret at build time via
 * `bun build --define 'process.env.SCAFFOLD_DAY_GOOGLE_CLIENT_SECRET=…'`.
 * Forks override either constant via the same env vars at runtime.
 *
 * dev mode (`bun run dev:cli`) without env vars exposed will refuse
 * the live flow with a clear "client credentials not configured"
 * error; explicit-token login still works.
 */
const DEFAULT_CLIENT_ID =
  "165083085350-dkoj0qqr4lobtmr4s225sjcl4m9tdkm6.apps.googleusercontent.com";

export function effectiveClientId(): string {
  return process.env[CLIENT_ID_ENV] ?? DEFAULT_CLIENT_ID;
}
export function effectiveClientSecret(): string {
  return process.env[CLIENT_SECRET_ENV] ?? "";
}

const DEFAULT_SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "openid",
  "email",
] as const;

// ─── PKCE helpers ─────────────────────────────────────────────────

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function generatePkceVerifier(): string {
  // RFC 7636: 43–128 chars, [A-Z / a-z / 0-9 / "-" / "." / "_" / "~"].
  // Use 32 random bytes → ~43 chars after base64url.
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return base64url(buf);
}

export async function pkceChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const ab = new ArrayBuffer(data.byteLength);
  new Uint8Array(ab).set(data);
  const digest = await crypto.subtle.digest("SHA-256", ab);
  return base64url(new Uint8Array(digest));
}

export function generateState(): string {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return base64url(buf);
}

// ─── public flow ──────────────────────────────────────────────────

export type OAuthDesktopOptions = {
  /** Override the OAuth client id (else env / default). */
  clientId?: string;
  /** Override the OAuth client secret (else env / default). */
  clientSecret?: string;
  /** Scopes; defaults to calendar + openid + email. */
  scopes?: readonly string[];
  /**
   * Called with the authorization URL so the caller can open it in
   * a browser. Defaults to `Bun.spawn(["open", url])` on macOS,
   * `xdg-open` on Linux. Tests inject a noop.
   */
  openBrowser?: (url: string) => void | Promise<void>;
  /**
   * Called after the local server starts so the caller can print
   * a "waiting for browser" message etc. Receives the authorization
   * URL.
   */
  onAuthUrl?: (url: string) => void;
  /**
   * Bind port for the local callback server. 0 picks a free port
   * (default).
   */
  port?: number;
  /** Abort the wait after this many ms. */
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

async function defaultOpenBrowser(url: string): Promise<void> {
  const platform = process.platform;
  let cmd: string[];
  if (platform === "darwin") cmd = ["open", url];
  else if (platform === "win32") cmd = ["cmd", "/c", "start", "", url];
  else cmd = ["xdg-open", url];
  try {
    Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
  } catch {
    // best-effort; the CLI prints the URL anyway via onAuthUrl
  }
}

/**
 * Run a full PKCE desktop flow and return the resulting tokens.
 * Throws ScaffoldError on user-cancelled, state mismatch, network
 * failure, or token exchange error.
 */
export async function runOAuthDesktopFlow(
  options: OAuthDesktopOptions = {},
): Promise<GoogleOAuthToken> {
  const clientId = options.clientId ?? effectiveClientId();
  const clientSecret = options.clientSecret ?? effectiveClientSecret();
  if (!clientId || !clientSecret) {
    throw new ScaffoldError({
      code: "DAY_INVALID_INPUT",
      summary: { en: "Google OAuth client credentials are not configured" },
      cause: `Set ${CLIENT_ID_ENV} + ${CLIENT_SECRET_ENV}, or rebuild a binary with defaults baked in.`,
      try: ["Use a release binary, or run `bun run dev:cli` after exporting the env vars."],
    });
  }

  const scopes = options.scopes ?? DEFAULT_SCOPES;
  const verifier = generatePkceVerifier();
  const challenge = await pkceChallenge(verifier);
  const state = generateState();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // Capture the resolution of the callback in a Promise so the
  // server handler can hand off to the caller.
  type CallbackResult =
    | { ok: true; code: string }
    | { ok: false; reason: string };
  let resolveCallback!: (r: CallbackResult) => void;
  const callbackPromise = new Promise<CallbackResult>((resolve) => {
    resolveCallback = resolve;
  });

  const server = Bun.serve({
    port: options.port ?? 0,
    hostname: "127.0.0.1",
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname !== "/callback") {
        return new Response("not found", { status: 404 });
      }
      const params = url.searchParams;
      const error = params.get("error");
      if (error) {
        resolveCallback({ ok: false, reason: error });
        return new Response(htmlError(error), {
          status: 400,
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
      const got = params.get("state");
      const code = params.get("code");
      if (got !== state) {
        resolveCallback({ ok: false, reason: "state mismatch" });
        return new Response(htmlError("state mismatch"), {
          status: 400,
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
      if (!code) {
        resolveCallback({ ok: false, reason: "missing code" });
        return new Response(htmlError("missing code"), {
          status: 400,
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
      resolveCallback({ ok: true, code });
      return new Response(htmlSuccess(), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    },
  });

  const redirectUri = `http://127.0.0.1:${server.port}/callback`;
  const authUrl = buildAuthUrl({
    clientId,
    redirectUri,
    scopes,
    state,
    challenge,
  });

  options.onAuthUrl?.(authUrl);
  const open = options.openBrowser ?? defaultOpenBrowser;
  try {
    await open(authUrl);
  } catch {
    // ignore — the URL is already surfaced via onAuthUrl
  }

  let result: CallbackResult;
  try {
    result = await Promise.race<CallbackResult>([
      callbackPromise,
      new Promise<CallbackResult>((_, reject) =>
        setTimeout(
          () => reject(new Error(`OAuth flow timed out after ${timeoutMs}ms`)),
          timeoutMs,
        ),
      ),
    ]);
  } finally {
    server.stop(true);
  }

  if (!result.ok) {
    throw new ScaffoldError({
      code: "DAY_INVALID_INPUT",
      summary: { en: `OAuth flow rejected: ${result.reason}` },
      cause: "The browser callback did not complete a valid authorization.",
      try: [
        "Re-run `scaffold-day auth login` and approve in the browser.",
        "If you closed the tab, re-run.",
      ],
    });
  }

  // Exchange the code + verifier for tokens.
  const tokenRes = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code: result.code,
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }).toString(),
  });
  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    throw new ScaffoldError({
      code: "DAY_INVALID_INPUT",
      summary: { en: `token exchange failed: ${tokenRes.status} ${tokenRes.statusText}` },
      cause: body.slice(0, 500),
      try: ["Re-run; if this persists, check the Google Cloud OAuth client config."],
    });
  }
  const tokens = (await tokenRes.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    token_type?: string;
    id_token?: string;
  };
  if (!tokens.access_token) {
    throw new ScaffoldError({
      code: "DAY_INVALID_INPUT",
      summary: { en: "token response missing access_token" },
      cause: JSON.stringify(tokens),
      try: ["Retry."],
    });
  }
  if (!tokens.refresh_token) {
    // Google only returns a refresh token on the FIRST consent (or
    // when access_type=offline + prompt=consent are sent). We send
    // those, but if the user has consented before they may need to
    // revoke at https://myaccount.google.com/connections.
    throw new ScaffoldError({
      code: "DAY_INVALID_INPUT",
      summary: { en: "OAuth response did not include a refresh_token" },
      cause:
        "Google returns a refresh_token only on first consent. Revoke prior consent at https://myaccount.google.com/connections and retry.",
      try: [
        "Visit https://myaccount.google.com/connections, find scaffold-day, click 'Remove access', then re-run `scaffold-day auth login`.",
      ],
    });
  }

  // Best-effort userinfo fetch for the email.
  let accountEmail: string | null = null;
  try {
    const r = await fetch(USERINFO_ENDPOINT, {
      headers: { authorization: `Bearer ${tokens.access_token}` },
    });
    if (r.ok) {
      const info = (await r.json()) as { email?: string };
      accountEmail = info.email ?? null;
    }
  } catch {
    // ignore
  }

  const expiryAt =
    typeof tokens.expires_in === "number"
      ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      : null;

  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    token_type: tokens.token_type ?? "Bearer",
    expiry_at: expiryAt,
    scope: tokens.scope ?? scopes.join(" "),
    account_email: accountEmail,
    storage: "file",
  };
}

// ─── helpers ──────────────────────────────────────────────────────

function buildAuthUrl(args: {
  clientId: string;
  redirectUri: string;
  scopes: readonly string[];
  state: string;
  challenge: string;
}): string {
  const params = new URLSearchParams({
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    response_type: "code",
    scope: args.scopes.join(" "),
    code_challenge: args.challenge,
    code_challenge_method: "S256",
    state: args.state,
    access_type: "offline",
    prompt: "consent",
  });
  return `${AUTH_BASE}?${params.toString()}`;
}

function htmlSuccess(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>scaffold-day</title>
  <style>body{font:16px/1.5 -apple-system,Segoe UI,sans-serif;max-width:30em;margin:4em auto;padding:0 1em;color:#1a1a1a;}
  h1{font-size:1.4em;}code{background:#f4f4f5;padding:0.1em 0.4em;border-radius:4px;}</style>
  </head><body>
  <h1>✅ Authorized</h1>
  <p>You can close this tab and return to the terminal.</p>
  <p style="color:#6b7280">scaffold-day stored your refresh token at <code>~/.scaffold-day/.secrets/google-oauth.json</code>.</p>
  </body></html>`;
}

function htmlError(reason: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>scaffold-day</title>
  <style>body{font:16px/1.5 -apple-system,Segoe UI,sans-serif;max-width:30em;margin:4em auto;padding:0 1em;color:#1a1a1a;}
  h1{font-size:1.4em;color:#dc2626;}code{background:#f4f4f5;padding:0.1em 0.4em;border-radius:4px;}</style>
  </head><body>
  <h1>✗ OAuth flow failed</h1>
  <p>Reason: <code>${reason.replace(/[<>"']/g, "")}</code></p>
  <p>Please return to the terminal and re-run <code>scaffold-day auth login</code>.</p>
  </body></html>`;
}
