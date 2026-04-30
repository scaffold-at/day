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

function usage(message: string): ScaffoldError {
  return new ScaffoldError({
    code: "DAY_USAGE",
    summary: { en: message },
    cause: "See `scaffold-day auth --help` for the full input contract.",
    try: ["Run `scaffold-day auth --help`."],
  });
}

function takeValue(args: string[], i: number, flag: string): string {
  const v = args[i + 1];
  if (v === undefined || v.startsWith("--")) {
    throw usage(`auth: ${flag} requires a value`);
  }
  return v;
}

// ─── auth login ───────────────────────────────────────────────────

async function runLogin(args: string[]): Promise<number> {
  let accessToken: string | undefined;
  let refreshToken: string | undefined;
  let accountEmail: string | undefined;
  let scope = "https://www.googleapis.com/auth/calendar";
  let force = false;
  let nonInteractive = false;
  let noKeychain = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? "";
    if (a === "--access-token") { accessToken = takeValue(args, i, "--access-token"); i++; }
    else if (a === "--refresh-token") { refreshToken = takeValue(args, i, "--refresh-token"); i++; }
    else if (a === "--account-email") { accountEmail = takeValue(args, i, "--account-email"); i++; }
    else if (a === "--scope") { scope = takeValue(args, i, "--scope"); i++; }
    else if (a === "--force") { force = true; }
    else if (a === "--non-interactive") { nonInteractive = true; }
    else if (a === "--no-keychain") { noKeychain = true; }
    else throw usage(`auth login: unexpected argument '${a}'`);
  }

  const home = defaultHomeDir();
  const existing = await readGoogleOAuthToken(home);
  if (existing && !force) {
    throw new ScaffoldError({
      code: "DAY_INVALID_INPUT",
      summary: { en: "auth login: already authenticated" },
      cause: `Token for ${existing.account_email ?? "unknown account"} is already stored.`,
      try: [
        "Re-run with --force to overwrite.",
        "Or `scaffold-day auth logout` first.",
      ],
    });
  }

  // S70: when neither token is provided, run the live PKCE desktop
  // flow (browser handoff). --non-interactive forces an error
  // instead, useful for CI / scripts that must not spawn a browser.
  let token: GoogleOAuthToken;
  if (accessToken && refreshToken) {
    token = {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: "Bearer",
      expiry_at: null,
      scope,
      account_email: accountEmail ?? null,
      storage: "file",
    };
  } else if (nonInteractive) {
    throw new ScaffoldError({
      code: "DAY_USAGE",
      summary: { en: "auth login: --access-token + --refresh-token required when --non-interactive" },
      cause: "Browser OAuth flow is the default; --non-interactive disables it.",
      try: ["Drop --non-interactive, or pass both tokens explicitly."],
    });
  } else {
    if (isDryRun()) {
      emitDryRun(false, {
        command: "auth login",
        writes: [{ path: ".secrets/google-oauth.json", op: existing ? "update" : "create" }],
        note: "would open the browser for OAuth desktop flow",
        result: { mode: "browser", scope },
      });
      return 0;
    }
    console.log("scaffold-day auth login");
    console.log("  starting browser OAuth flow…");
    token = await runOAuthDesktopFlow({
      scopes: [scope, "openid", "email"],
      onAuthUrl: (url) => {
        console.log(`  if the browser doesn't open, visit:\n    ${url}`);
      },
    });
    if (accountEmail) token.account_email = accountEmail;
  }

  if (isDryRun()) {
    emitDryRun(false, {
      command: "auth login",
      writes: [{ path: ".secrets/google-oauth.json", op: existing ? "update" : "create" }],
      result: {
        account: token.account_email,
        scope: token.scope,
        storage: "file",
        has_refresh_token: token.refresh_token.length > 0,
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
              has_refresh_token: token.refresh_token.length > 0,
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
    what: "v0.1 mock-mode helper around <home>/.secrets/google-oauth.json. Login is non-interactive (pass tokens as flags); the live browser OAuth flow lands in §S27 B-mode.",
    when: "After supplying tokens manually for testing, or to inspect / clear the stored auth.",
    cost: "Local file I/O only (mode 0600). No network in v0.1.",
    input: "login [--access-token <AT> --refresh-token <RT>] [--account-email <addr>] [--scope <s>] [--force] [--non-interactive] [--no-keychain]\nlist [--json]\nlogout [--json]\nrevoke [--json]",
    return: "Exit 0. DAY_INVALID_INPUT if login conflicts with an existing token (use --force) or if a malformed token file is present.",
    gotcha: "Without `--access-token`/`--refresh-token` the browser PKCE flow runs (S70). Refresh tokens land in the OS Keychain (macOS `security`, Linux `secret-tool`) when reachable — `--no-keychain` or `SCAFFOLD_DAY_DISABLE_KEYCHAIN=1` forces file storage. `auth list --json` reports which backend is active. Tracking SLICES.md §S70 / §S73.",
  },
  run: async (args) => {
    const sub = args[0];
    if (!sub) throw usage("auth: missing subcommand. try `auth list`, `auth login --access-token ... --refresh-token ...`, `auth logout`, `auth revoke`");
    const rest = args.slice(1);
    if (sub === "login") return runLogin(rest);
    if (sub === "list") return runList(rest);
    if (sub === "logout") return runLogout(rest);
    if (sub === "revoke") return runRevoke(rest);
    throw usage(`auth: unknown subcommand '${sub}'`);
  },
};
