import {
  deleteGoogleOAuthToken,
  type GoogleOAuthToken,
  readGoogleOAuthToken,
  writeGoogleOAuthToken,
} from "@scaffold/day-adapters";
import { defaultHomeDir, ScaffoldError } from "@scaffold/day-core";
import type { Command } from "../cli/command";

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

  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? "";
    if (a === "--access-token") { accessToken = takeValue(args, i, "--access-token"); i++; }
    else if (a === "--refresh-token") { refreshToken = takeValue(args, i, "--refresh-token"); i++; }
    else if (a === "--account-email") { accountEmail = takeValue(args, i, "--account-email"); i++; }
    else if (a === "--scope") { scope = takeValue(args, i, "--scope"); i++; }
    else if (a === "--force") { force = true; }
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

  if (!accessToken || !refreshToken) {
    // v0.1 mock-mode A: live OAuth desktop flow lands in §S27 B-mode.
    // The non-interactive path is the only supported login until then;
    // we make it explicit so tests / scripts can pre-seed tokens
    // without spawning a browser.
    throw new ScaffoldError({
      code: "DAY_USAGE",
      summary: {
        en: "auth login: --access-token and --refresh-token are required (v0.1 mock-mode)",
      },
      cause:
        "The interactive browser OAuth flow lands in §S27 B-mode after PO supplies a Google Cloud OAuth Client ID. v0.1 only ships the explicit-token path.",
      try: [
        "Pass --access-token <AT> --refresh-token <RT> [--account-email <addr>].",
        "See memory:project_test_strategy for the mock-first plan.",
      ],
    });
  }

  const token: GoogleOAuthToken = {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: "Bearer",
    expiry_at: null,
    scope,
    account_email: accountEmail ?? null,
    storage: "file",
  };
  await writeGoogleOAuthToken(home, token);

  console.log("scaffold-day auth login");
  console.log(`  account: ${accountEmail ?? "(unknown)"}`);
  console.log(`  scope:   ${scope}`);
  console.log(`  storage: file`);
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
    input: "login --access-token <AT> --refresh-token <RT> [--account-email <addr>] [--scope <s>] [--force]\nlist [--json]\nlogout [--json]\nrevoke [--json]",
    return: "Exit 0. DAY_INVALID_INPUT if login conflicts with an existing token (use --force) or if a malformed token file is present.",
    gotcha: "v0.1 stores tokens to disk only — keytar lands behind §R1's bun --compile compatibility test. Tracking SLICES.md §S29 + §S27/§S28.",
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
