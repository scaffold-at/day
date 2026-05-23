import {
  deleteGoogleOAuthToken,
  type GoogleOAuthToken,
  readGoogleOAuthToken,
  runOAuthDesktopFlow,
  writeGoogleOAuthToken,
} from "@scaffold/day-adapters";
import { defaultHomeDir, ScaffoldError } from "@scaffold/day-core";
import type { Command } from "../cli/command";
import { emitDryRun, isDryRun } from "../cli/runtime";

const AUTH_BROKER_URL_ENV = "SCAFFOLD_DAY_AUTH_BROKER_URL";
const DEFAULT_AUTH_BROKER_URL = "https://auth.scaffold.at";

function usage(message: string): ScaffoldError {
  return new ScaffoldError({
    code: "DAY_USAGE",
    summary: { en: message },
    cause: "See `scaffold-day auth --help` for the full input contract.",
    try: ["Run `scaffold-day auth --help`."],
  });
}

function authBrokerBaseUrl(): string {
  return (process.env[AUTH_BROKER_URL_ENV] ?? DEFAULT_AUTH_BROKER_URL).replace(/\/+$/, "");
}

async function readBrokerSessionTokenFromStdin(): Promise<string> {
  const text = await new Response(Bun.stdin.stream()).text();
  const token = text.trim();
  if (!token) throw usage("auth login: --broker-session-token-stdin received empty stdin");
  return token;
}

type BrokerTokenResponse = {
  ok?: boolean;
  account_email?: string;
  access_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
  error?: string;
};

async function verifyBrokerSessionToken(brokerSessionToken: string): Promise<GoogleOAuthToken> {
  const response = await fetch(`${authBrokerBaseUrl()}/api/auth/google/token`, {
    method: "POST",
    headers: { authorization: `Bearer ${brokerSessionToken}` },
  });
  const payload = (await response.json().catch(() => ({}))) as BrokerTokenResponse;
  if (!response.ok || payload.ok !== true) {
    throw new ScaffoldError({
      code: "DAY_PROVIDER_AUTH_EXPIRED",
      summary: { en: "auth login: broker session token verification failed" },
      cause: payload.error ?? `broker returned HTTP ${response.status}`,
      try: ["Generate a new broker session token and pipe it via --broker-session-token-stdin."],
    });
  }
  if (!payload.access_token || !payload.scope) {
    throw new ScaffoldError({
      code: "DAY_PROVIDER_UNAVAILABLE",
      summary: { en: "auth login: broker returned an invalid token response" },
      cause: "Expected access_token and scope in the broker response.",
      try: ["Check the configured auth broker deployment."],
    });
  }
  const expiresIn = typeof payload.expires_in === "number" ? payload.expires_in : 3600;
  return {
    access_token: payload.access_token,
    broker_session_token: brokerSessionToken,
    token_type: payload.token_type ?? "Bearer",
    expiry_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
    scope: payload.scope,
    account_email: payload.account_email ?? null,
    storage: "broker",
  };
}

// ─── auth login ───────────────────────────────────────────────────

async function runLogin(args: string[]): Promise<number> {
  let overwrite = false;
  let manual = false;
  let noKeychain = false;
  let brokerSessionTokenStdin = false;

  for (const a of args) {
    if (a === "--overwrite") { overwrite = true; }
    else if (a === "--manual") { manual = true; }
    else if (a === "--no-keychain") { noKeychain = true; }
    else if (a === "--broker-session-token-stdin") { brokerSessionTokenStdin = true; }
    else throw usage(`auth login: unexpected argument '${a}'`);
  }

  if (manual && brokerSessionTokenStdin) {
    throw usage("auth login: use only one login mode, not both --manual and --broker-session-token-stdin");
  }

  const home = defaultHomeDir();
  const existing = await readGoogleOAuthToken(home);
  if (existing && !overwrite) {
    throw new ScaffoldError({
      code: "DAY_INVALID_INPUT",
      summary: { en: "auth login: already authenticated" },
      cause: `Token for ${existing.account_email ?? "unknown account"} is already stored.`,
      try: [
        "Re-run with --overwrite to replace the stored auth.",
        "Or `scaffold-day auth logout` first.",
      ],
    });
  }

  let token: GoogleOAuthToken;
  if (brokerSessionTokenStdin) {
    const brokerSessionToken = await readBrokerSessionTokenFromStdin();
    token = await verifyBrokerSessionToken(brokerSessionToken);
  } else {
    const mode = manual ? "manual" : "browser";
    if (isDryRun()) {
      emitDryRun(false, {
        command: "auth login",
        writes: [{ path: ".secrets/google-oauth.json", op: existing ? "update" : "create" }],
        note: manual
          ? "would start a manual browser OAuth flow: print the auth URL without opening a browser, then wait for the local callback"
          : "would open the browser for OAuth desktop flow",
        result: { mode },
      });
      return 0;
    }
    console.log("scaffold-day auth login");
    if (manual) {
      console.log("  starting manual browser OAuth flow…");
    } else {
      console.log("  starting browser OAuth flow…");
    }
    token = await runOAuthDesktopFlow({
      openBrowser: manual ? () => {} : undefined,
      onAuthUrl: (url) => {
        console.log(manual ? `  open this URL:\n    ${url}` : `  if the browser doesn't open, visit:\n    ${url}`);
      },
    });
  }

  if (isDryRun()) {
    emitDryRun(false, {
      command: "auth login",
      writes: [{ path: ".secrets/google-oauth.json", op: existing ? "update" : "create" }],
      result: {
        account: token.account_email,
        scope: token.scope,
        storage: token.storage,
        has_refresh_token: (token.refresh_token?.length ?? 0) > 0,
      },
    });
    return 0;
  }

  const persisted = await writeGoogleOAuthToken(home, token, {
    preferFile: noKeychain,
  });

  console.log("scaffold-day auth login");
  console.log(`  account: ${persisted.account_email ?? "(unknown)"}`);
  console.log(`  scope:   ${persisted.scope}`);
  console.log(`  storage: ${persisted.storage}`);
  return 0;
}

// ─── auth list ────────────────────────────────────────────────────

async function runList(args: string[]): Promise<number> {
  const json = args.includes("--json");
  for (const a of args) {
    if (a !== "--json") throw usage(`auth list: unexpected argument '${a}'`);
  }
  const home = defaultHomeDir();
  const token = await readGoogleOAuthToken(home);
  if (json) {
    console.log(
      JSON.stringify(
        token
          ? {
              authenticated: true,
              account_email: token.account_email,
              scope: token.scope,
              storage: token.storage,
              has_refresh_token: (token.refresh_token?.length ?? 0) > 0,
            }
          : { authenticated: false },
        null,
        2,
      ),
    );
    return 0;
  }
  if (!token) {
    console.log("scaffold-day auth list");
    console.log("  (no stored auth)");
    return 0;
  }
  console.log("scaffold-day auth list");
  console.log(`  account: ${token.account_email ?? "(unknown)"}`);
  console.log(`  scope:   ${token.scope}`);
  console.log(`  storage: ${token.storage}`);
  return 0;
}

// ─── auth logout ──────────────────────────────────────────────────

async function runLogout(args: string[]): Promise<number> {
  for (const a of args) {
    if (a !== "--json") throw usage(`auth logout: unexpected argument '${a}'`);
  }
  const home = defaultHomeDir();

  if (isDryRun()) {
    const existed = await readGoogleOAuthToken(home);
    emitDryRun(args.includes("--json"), {
      command: "auth logout",
      writes: existed
        ? [{ path: ".secrets/google-oauth.json", op: "delete" }]
        : [],
      result: { logged_out: existed !== null },
    });
    return 0;
  }

  const removed = await deleteGoogleOAuthToken(home);
  if (args.includes("--json")) {
    console.log(JSON.stringify({ logged_out: removed }));
  } else if (removed) {
    console.log("scaffold-day auth logout: token removed");
  } else {
    console.log("scaffold-day auth logout: nothing to remove");
  }
  return 0;
}

// ─── auth revoke ──────────────────────────────────────────────────

async function runRevoke(args: string[]): Promise<number> {
  // v0.1 revoke is the same as logout (deletes the token). The real
  // adapter will additionally call Google's /oauth2/revoke endpoint
  // (B-mode); for mock we just nuke local state.
  const home = defaultHomeDir();

  if (isDryRun()) {
    const existed = await readGoogleOAuthToken(home);
    emitDryRun(args.includes("--json"), {
      command: "auth revoke",
      writes: existed
        ? [{ path: ".secrets/google-oauth.json", op: "delete" }]
        : [],
      note: "B-mode would also POST to https://oauth2.googleapis.com/revoke",
      result: { revoked: existed !== null, server_call: false },
    });
    return 0;
  }

  const removed = await deleteGoogleOAuthToken(home);
  if (args.includes("--json")) {
    console.log(JSON.stringify({ revoked: removed, server_call: false }));
  } else {
    console.log("scaffold-day auth revoke");
    if (removed) {
      console.log("  local token deleted");
    } else {
      console.log("  no token to revoke");
    }
    console.log("  (B-mode will additionally hit the Google /oauth2/revoke endpoint)");
  }
  return 0;
}

export const authCommand: Command = {
  name: "auth",
  summary: "manage the Google Calendar OAuth token (login / list / logout / revoke)",
  help: {
    what: "Manage Google Calendar OAuth credentials. Login uses the browser PKCE flow by default, a manual browser handoff with --manual, or a broker session token piped on stdin.",
    when: "After initial setup, CI/bootstrap auth, or to inspect / clear the stored auth.",
    cost: "Local file I/O (mode 0600). Browser OAuth and broker-token verification make network calls.",
    input: "login [--manual] [--broker-session-token-stdin] [--overwrite] [--no-keychain]\nlist [--json]\nlogout [--json]\nrevoke [--json]",
    return: "Exit 0. DAY_INVALID_INPUT if login conflicts with an existing token (use --overwrite) or if a malformed token file is present.",
    gotcha: "Plain `auth login` opens the browser PKCE flow (S70). `--manual` prints the auth URL instead of opening a browser, then waits for the local callback. For broker auth, pipe the broker session token via `--broker-session-token-stdin`; there is intentionally no `--broker-session-token <value>` flag to avoid shell-history/typing mistakes. Refresh tokens land in the OS Keychain when reachable — `--no-keychain` or `SCAFFOLD_DAY_DISABLE_KEYCHAIN=1` forces file storage. Broker auth is stored as `storage: broker`. `auth list --json` reports which backend is active.",
  },
  run: async (args) => {
    const sub = args[0];
    if (!sub) throw usage("auth: missing subcommand. try `auth list`, `auth login`, `auth login --broker-session-token-stdin`, `auth logout`, `auth revoke`");
    const rest = args.slice(1);
    if (sub === "login") return runLogin(rest);
    if (sub === "list") return runList(rest);
    if (sub === "logout") return runLogout(rest);
    if (sub === "revoke") return runRevoke(rest);
    throw usage(`auth: unknown subcommand '${sub}'`);
  },
};
