import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { cleanupHome, runCli } from "./_helpers";

let home: string;
beforeEach(async () => {
  // Use a fresh, non-seeded home (init's job is to create it).
  home = await mkdtemp(path.join(tmpdir(), "scaffold-day-init-"));
});
afterEach(async () => {
  await cleanupHome(home);
});

describe("init (S29.5)", () => {
  test("seeds the home layout + schema_version + balanced policy", async () => {
    const r = await runCli(["init"], { home });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(r.stdout).toContain("home initialized");
    expect(r.stdout).toContain("schema_version: 0.1.0");
    expect(r.stdout).toContain("balanced preset");

    // schema-version.json
    const schema = JSON.parse(
      await readFile(path.join(home, ".scaffold-day/schema-version.json"), "utf8"),
    );
    expect(schema.schema_version).toBe("0.1.0");

    // policy seeded
    const policy = await readFile(path.join(home, "policy/current.yaml"), "utf8");
    expect(policy).toContain("Asia/Seoul");

    // dirs created
    for (const d of [
      "days",
      "todos/active/detail",
      "todos/archive",
      "sync",
      "conflicts",
      "logs",
      "policy-snapshots",
    ]) {
      const st = await stat(path.join(home, d));
      expect(st.isDirectory()).toBe(true);
    }

    // .secrets has 0700 mode
    const secretsDir = await stat(path.join(home, ".secrets"));
    expect(secretsDir.mode & 0o777).toBe(0o700);
  });

  test("--no-preset skips policy creation", async () => {
    const r = await runCli(["init", "--no-preset"], { home });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("policy: skipped");
    let policyExists = true;
    try {
      await stat(path.join(home, "policy/current.yaml"));
    } catch {
      policyExists = false;
    }
    expect(policyExists).toBe(false);
  });

  test("re-init without --force → DAY_INVALID_INPUT", async () => {
    await runCli(["init"], { home });
    const r = await runCli(["init"], { home });
    expect(r.exitCode).toBe(65);
    expect(r.stderr).toContain("already initialized");
  });

  test("re-init with --force succeeds", async () => {
    await runCli(["init"], { home });
    const r = await runCli(["init", "--force"], { home });
    expect(r.exitCode).toBe(0);
  });

  test("--json shape carries home + providers_available", async () => {
    const r = await runCli(["init", "--json"], { home });
    expect(r.exitCode).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.home).toBe(home);
    expect(out.preset).toBe("balanced");
    expect(Array.isArray(out.providers_available)).toBe(true);
    // Mock provider always available in test env (SCAFFOLD_DAY_AI_PROVIDERS=mock).
    expect(out.providers_available).toContain("mock");
  });

  test("--preset with unknown name → DAY_INVALID_INPUT", async () => {
    const r = await runCli(["init", "--preset", "wild"], { home });
    expect(r.exitCode).toBe(65);
    expect(r.stderr).toContain("DAY_INVALID_INPUT");
  });
});

describe("auth (S29)", () => {
  beforeEach(async () => {
    await runCli(["init"], { home });
  });

  async function runBrokerLogin(overwrite = false) {
    const seen: { authorization?: string; body?: unknown }[] = [];
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        seen.push({
          authorization: req.headers.get("authorization") ?? undefined,
          body: await req.json().catch(() => undefined),
        });
        return Response.json({
          ok: true,
          account_email: overwrite ? "broker-overwrite@example.com" : "broker@example.com",
          access_token: overwrite ? "AT-broker-overwrite" : "AT-broker",
          expires_in: 3600,
          token_type: "Bearer",
          scope: "https://www.googleapis.com/auth/calendar openid email",
        });
      },
    });
    try {
      const r = await runCli(
        ["auth", "login", "--broker-session-token-stdin", ...(overwrite ? ["--overwrite"] : [])],
        {
          home,
          stdin: overwrite ? "sday_overwrite\n" : "sday_from_stdin\n",
          env: { SCAFFOLD_DAY_AUTH_BROKER_URL: `http://127.0.0.1:${server.port}` },
        },
      );
      return { r, seen };
    } finally {
      server.stop(true);
    }
  }

  test("auth login --broker-session-token-stdin writes a 0600 broker token file", async () => {
    const { r, seen } = await runBrokerLogin();
    expect(r.exitCode, r.stderr).toBe(0);
    expect(r.stdout).toContain("broker@example.com");
    expect(r.stdout).toContain("broker");
    expect(seen[0]?.authorization).toBe("Bearer sday_from_stdin");

    const token = JSON.parse(await readFile(path.join(home, ".secrets/google-oauth.json"), "utf8"));
    expect(token.access_token).toBe("AT-broker");
    expect(token.broker_session_token).toBe("sday_from_stdin");
    expect(token.account_email).toBe("broker@example.com");
    expect(token.storage).toBe("broker");
    expect(token.refresh_token).toBeUndefined();

    const st = await stat(path.join(home, ".secrets/google-oauth.json"));
    expect(st.mode & 0o777).toBe(0o600);
  });

  test("auth list before login → (no stored auth)", async () => {
    const r = await runCli(["auth", "list"], { home });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("no stored auth");
  });

  test("auth list --json after broker login carries account + storage", async () => {
    await runBrokerLogin();
    const r = await runCli(["auth", "list", "--json"], { home });
    const out = JSON.parse(r.stdout);
    expect(out.authenticated).toBe(true);
    expect(out.account_email).toBe("broker@example.com");
    expect(out.has_refresh_token).toBe(false);
    expect(out.storage).toBe("broker");
  });

  test("auth login twice without --overwrite → DAY_INVALID_INPUT", async () => {
    await runBrokerLogin();
    const { r } = await runBrokerLogin();
    expect(r.exitCode).toBe(65);
    expect(r.stderr).toContain("already authenticated");
  });

  test("auth login --overwrite overwrites", async () => {
    await runBrokerLogin();
    const { r } = await runBrokerLogin(true);
    expect(r.exitCode).toBe(0);
    const list = JSON.parse((await runCli(["auth", "list", "--json"], { home })).stdout);
    expect(list.account_email).toBe("broker-overwrite@example.com");
  });

  test("auth logout removes the token file", async () => {
    await runBrokerLogin();
    const r = await runCli(["auth", "logout"], { home });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("token removed");
    const list = JSON.parse((await runCli(["auth", "list", "--json"], { home })).stdout);
    expect(list.authenticated).toBe(false);
  });

  test("auth revoke deletes local token + notes B-mode server call", async () => {
    await runBrokerLogin();
    const r = await runCli(["auth", "revoke"], { home });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("local token deleted");
    expect(r.stdout).toContain("/oauth2/revoke");
  });

  test("auth login rejects direct broker session token arguments", async () => {
    const r = await runCli(["auth", "login", "--broker-session-token", "sday_secret"], { home });
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("unexpected argument '--broker-session-token'");
  });

  test("auth login rejects removed login options", async () => {
    for (const flag of [
      "--non-interactive",
      "--force",
      "--access-token",
      "--refresh-token",
      "--account-email",
      "--scope",
    ]) {
      const r = await runCli(["auth", "login", flag, "x"], { home });
      expect(r.exitCode).toBe(2);
      expect(r.stderr).toContain(`unexpected argument '${flag}'`);
    }
  });

  test("auth login dry-run documents hosted broker browser flow", async () => {
    const r = await runCli(["--dry-run", "auth", "login"], { home });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(r.stdout).toContain("hosted broker auth URL");
    expect(r.stdout).toContain("broker-browser");
  });

  test("auth login --manual dry-run documents manual hosted broker flow", async () => {
    const r = await runCli(["--dry-run", "auth", "login", "--manual"], { home });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(r.stdout).toContain("hosted broker auth URL");
    expect(r.stdout).toContain("broker-manual");
  });
});
