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

function escapeHtml(value: string): string {
  return value.replace(
    /[<>&"]/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c] ?? c,
  );
}

function renderBrokerSessionIssuedPage(input: {
  email: string;
  brokerSessionToken: string;
  brokerSessionExpiresAt: string;
  scope: string;
  hasRefreshToken: boolean;
}): string {
  const token = escapeHtml(input.brokerSessionToken);
  const email = escapeHtml(input.email);
  const expiresAt = escapeHtml(input.brokerSessionExpiresAt);
  const scope = escapeHtml(input.scope);
  const hasRefreshToken = input.hasRefreshToken ? "Yes" : "No";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Scaffold Day auth complete</title>
  <style>
    :root { color-scheme: light dark; --bg: #0f172a; --card: #111827; --text: #e5e7eb; --muted: #9ca3af; --accent: #60a5fa; --ok: #34d399; --warn: #fbbf24; --border: #334155; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: radial-gradient(circle at top, #1e3a8a 0, var(--bg) 42rem); color: var(--text); }
    main { width: min(760px, 100%); background: color-mix(in srgb, var(--card), transparent 4%); border: 1px solid var(--border); border-radius: 24px; padding: 28px; box-shadow: 0 24px 80px rgb(0 0 0 / 0.35); }
    .badge { display: inline-flex; align-items: center; gap: 8px; color: var(--ok); font-weight: 700; letter-spacing: -0.01em; }
    h1 { margin: 12px 0 8px; font-size: clamp(28px, 5vw, 42px); letter-spacing: -0.04em; }
    p { line-height: 1.6; color: var(--muted); }
    .token-wrap { margin: 22px 0; }
    label { display: block; margin-bottom: 8px; font-weight: 700; }
    .token-row { display: flex; gap: 10px; }
    textarea { width: 100%; min-height: 86px; resize: vertical; border: 1px solid var(--border); border-radius: 14px; padding: 14px; font: 14px/1.45 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace; color: var(--text); background: #020617; }
    button { border: 0; border-radius: 14px; padding: 0 18px; min-width: 112px; cursor: pointer; background: var(--accent); color: #06111f; font-weight: 800; }
    button:active { transform: translateY(1px); }
    code { color: #bfdbfe; background: #020617; border: 1px solid var(--border); border-radius: 8px; padding: 2px 6px; }
    dl { display: grid; grid-template-columns: 130px 1fr; gap: 10px 16px; margin-top: 20px; padding-top: 20px; border-top: 1px solid var(--border); }
    dt { color: var(--muted); }
    dd { margin: 0; overflow-wrap: anywhere; }
    .warning { border: 1px solid color-mix(in srgb, var(--warn), transparent 50%); background: color-mix(in srgb, var(--warn), transparent 88%); border-radius: 14px; padding: 12px 14px; color: #fde68a; }
  </style>
</head>
<body>
  <main>
    <div class="badge">✓ Google authorization complete</div>
    <h1>Scaffold Day 인증이 완료됐습니다</h1>
    <p>아래 broker session token을 복사해서 터미널의 <code>brokerSessionToken&gt;</code> 프롬프트에 붙여넣고 Enter를 누르세요.</p>
    <div class="token-wrap">
      <label for="token">Broker session token</label>
      <div class="token-row">
        <textarea id="token" readonly spellcheck="false">${token}</textarea>
        <button id="copy" type="button">Copy</button>
      </div>
    </div>
    <p id="copy-status" aria-live="polite"></p>
    <div class="warning">이 값은 비밀번호처럼 다루세요. 채팅/로그에 붙여넣었다면 새로 로그인해서 새 토큰을 발급받는 것이 안전합니다.</div>
    <dl>
      <dt>Account</dt><dd>${email}</dd>
      <dt>Expires</dt><dd>${expiresAt}</dd>
      <dt>Refresh token</dt><dd>${hasRefreshToken}</dd>
      <dt>Scope</dt><dd>${scope}</dd>
    </dl>
  </main>
  <script>
    const token = document.getElementById('token');
    const button = document.getElementById('copy');
    const status = document.getElementById('copy-status');
    button.addEventListener('click', async () => {
      token.focus();
      token.select();
      try {
        await navigator.clipboard.writeText(token.value);
        status.textContent = 'Copied. Paste it into the CLI and press Enter.';
        button.textContent = 'Copied';
      } catch {
        document.execCommand('copy');
        status.textContent = 'Selected/copied. If copy failed, press Cmd+C/Ctrl+C.';
      }
    });
  </script>
</body>
</html>`;
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

    res.status(200).setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(
      renderBrokerSessionIssuedPage({
        email: user.email,
        brokerSessionToken: session.token,
        brokerSessionExpiresAt: session.expiresAt.toISOString(),
        hasRefreshToken: Boolean(tokens.refreshToken),
        scope: tokens.scope,
      }),
    );
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Failed to complete Google OAuth",
    });
  }
}
