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
    const policy = await readFile(
      path.join(home, "policy/current.yaml"),
      "utf8",
    );
    expect(policy).toContain("Asia/Seoul");

    // dirs created
    for (const d of ["days", "todos/active/detail", "todos/archive", "sync", "conflicts", "logs", "policy-snapshots"]) {
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

  test("auth login non-interactive writes a 0600 token file", async () => {
    const r = await runCli(
      [
        "auth",
        "login",
        "--access-token", "AT-test",
        "--refresh-token", "RT-test",
        "--account-email", "u@example.com",
      ],
      { home },
    );
    expect(r.exitCode, r.stderr).toBe(0);
    expect(r.stdout).toContain("u@example.com");

    const token = JSON.parse(
      await readFile(path.join(home, ".secrets/google-oauth.json"), "utf8"),
    );
    expect(token.access_token).toBe("AT-test");
    expect(token.refresh_token).toBe("RT-test");
    expect(token.account_email).toBe("u@example.com");

    const st = await stat(path.join(home, ".secrets/google-oauth.json"));
    expect(st.mode & 0o777).toBe(0o600);
  });

  test("auth list before login → (no stored auth)", async () => {
    const r = await runCli(["auth", "list"], { home });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("no stored auth");
  });

  test("auth list --json after login carries account + scope", async () => {
    await runCli(
      [
        "auth", "login",
        "--access-token", "AT", "--refresh-token", "RT", "--account-email", "x@y.com",
      ],
      { home },
    );
    const r = await runCli(["auth", "list", "--json"], { home });
    const out = JSON.parse(r.stdout);
    expect(out.authenticated).toBe(true);
    expect(out.account_email).toBe("x@y.com");
    expect(out.has_refresh_token).toBe(true);
    expect(out.storage).toBe("file");
  });

  test("auth login twice without --force → DAY_INVALID_INPUT", async () => {
    await runCli(
      ["auth", "login", "--access-token", "AT", "--refresh-token", "RT"],
      { home },
    );
    const r = await runCli(
      ["auth", "login", "--access-token", "AT2", "--refresh-token", "RT2"],
      { home },
    );
    expect(r.exitCode).toBe(65);
    expect(r.stderr).toContain("already authenticated");
  });

  test("auth login --force overwrites", async () => {
    await runCli(
      ["auth", "login", "--access-token", "AT", "--refresh-token", "RT"],
      { home },
    );
    const r = await runCli(
      [
        "auth", "login", "--force",
        "--access-token", "AT2", "--refresh-token", "RT2", "--account-email", "new@y.com",
      ],
      { home },
    );
    expect(r.exitCode).toBe(0);
    const list = JSON.parse(
      (await runCli(["auth", "list", "--json"], { home })).stdout,
    );
    expect(list.account_email).toBe("new@y.com");
  });

  test("auth logout removes the token file", async () => {
    await runCli(
      ["auth", "login", "--access-token", "AT", "--refresh-token", "RT"],
      { home },
    );
    const r = await runCli(["auth", "logout"], { home });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("token removed");
    const list = JSON.parse(
      (await runCli(["auth", "list", "--json"], { home })).stdout,
    );
    expect(list.authenticated).toBe(false);
  });

  test("auth revoke deletes local token + notes B-mode server call", async () => {
    await runCli(
      ["auth", "login", "--access-token", "AT", "--refresh-token", "RT"],
      { home },
    );
    const r = await runCli(["auth", "revoke"], { home });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("local token deleted");
    expect(r.stdout).toContain("/oauth2/revoke");
  });

  test("auth login --non-interactive without tokens → DAY_USAGE (S70 browser flow disabled)", async () => {
    const r = await runCli(["auth", "login", "--non-interactive"], { home });
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("DAY_USAGE");
    expect(r.stderr).toContain("--access-token");
  });
});
