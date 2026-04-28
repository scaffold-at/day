import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { cleanupHome, makeTmpHome, runCli } from "./_helpers";

let home: string;
beforeEach(async () => {
  home = await makeTmpHome();
});
afterEach(async () => {
  await cleanupHome(home);
});

describe("global --dry-run (S83)", () => {
  test("init --dry-run leaves the directory empty (no schema-version.json, no policy)", async () => {
    const fresh = await mkdtemp(path.join(tmpdir(), "scaffold-day-dryrun-init-"));
    try {
      const r = await runCli(["init", "--dry-run", "--json"], { home: fresh });
      expect(r.exitCode, r.stderr).toBe(0);
      const out = JSON.parse(r.stdout);
      expect(out.dry_run).toBe(true);
      expect(out.would.command).toBe("init");
      expect(out.would.writes.length).toBeGreaterThan(0);

      // Disk untouched: only the empty mkdtemp dir remains.
      const entries = await readdir(fresh);
      expect(entries).toEqual([]);
    } finally {
      await cleanupHome(fresh);
    }
  });

  test("todo add --dry-run does not create the index or detail files", async () => {
    const r = await runCli(
      ["todo", "add", "--title", "draft Q2 OKR", "--dry-run", "--json"],
      { home },
    );
    expect(r.exitCode, r.stderr).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.dry_run).toBe(true);
    expect(out.would.command).toBe("todo add");
    expect(out.would.result.title).toBe("draft Q2 OKR");

    let indexExists = true;
    try {
      await stat(path.join(home, "todos/active/index.json"));
    } catch {
      indexExists = false;
    }
    expect(indexExists).toBe(false);

    // The follow-up real list should still report 0 todos.
    const list = await runCli(["todo", "list", "--json"], { home });
    expect(JSON.parse(list.stdout).total).toBe(0);
  });

  test("event add --dry-run does not write the day file", async () => {
    const r = await runCli(
      [
        "event",
        "add",
        "--title",
        "Standup",
        "--start",
        "2026-04-28T10:00:00+09:00",
        "--end",
        "2026-04-28T11:00:00+09:00",
        "--dry-run",
      ],
      { home },
    );
    expect(r.exitCode, r.stderr).toBe(0);
    expect(r.stdout).toContain("[dry-run] event add");
    expect(r.stdout).toContain("days/2026-04/2026-04-28.json");

    let dayFileExists = true;
    try {
      await stat(path.join(home, "days/2026-04/2026-04-28.json"));
    } catch {
      dayFileExists = false;
    }
    expect(dayFileExists).toBe(false);
  });

  test("policy patch --dry-run does not modify policy/current.yaml", async () => {
    // Seed policy first (real init the home).
    await runCli(["init", "--force"], { home });
    const before = await readFile(path.join(home, "policy/current.yaml"), "utf8");

    const r = await runCli(
      [
        "policy",
        "patch",
        '[{"op":"replace","path":"/placement_grid_min","value":15}]',
        "--dry-run",
        "--json",
      ],
      { home },
    );
    expect(r.exitCode, r.stderr).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.dry_run).toBe(true);
    expect(out.would.result.applied).toBe(1);

    const after = await readFile(path.join(home, "policy/current.yaml"), "utf8");
    expect(after).toBe(before);
  });

  test("policy preset apply --dry-run leaves the existing policy alone", async () => {
    await runCli(["init", "--force"], { home });
    const before = await readFile(path.join(home, "policy/current.yaml"), "utf8");

    // Tweak it so we can detect a clobber.
    await runCli(
      [
        "policy",
        "patch",
        '[{"op":"replace","path":"/placement_grid_min","value":42}]',
      ],
      { home },
    );
    const tweaked = await readFile(path.join(home, "policy/current.yaml"), "utf8");
    expect(tweaked).not.toBe(before);

    const r = await runCli(
      ["policy", "preset", "apply", "balanced", "--dry-run"],
      { home },
    );
    expect(r.exitCode, r.stderr).toBe(0);
    expect(r.stdout).toContain("[dry-run] policy preset apply");

    const after = await readFile(path.join(home, "policy/current.yaml"), "utf8");
    expect(after).toBe(tweaked);
  });

  test("auth login --dry-run does not write the secrets file", async () => {
    await runCli(["init"], { home });
    const r = await runCli(
      [
        "auth",
        "login",
        "--access-token",
        "AT-test",
        "--refresh-token",
        "RT-test",
        "--account-email",
        "u@example.com",
        "--dry-run",
      ],
      { home },
    );
    expect(r.exitCode, r.stderr).toBe(0);
    expect(r.stdout).toContain("[dry-run] auth login");
    expect(r.stdout).toContain(".secrets/google-oauth.json");

    let secretsExists = true;
    try {
      await stat(path.join(home, ".secrets/google-oauth.json"));
    } catch {
      secretsExists = false;
    }
    expect(secretsExists).toBe(false);
  });

  test("read-only command + --dry-run is a no-op (no preview, normal output)", async () => {
    await runCli(["init"], { home });
    const r = await runCli(["today", "--dry-run", "--tz", "Asia/Seoul"], { home });
    expect(r.exitCode, r.stderr).toBe(0);
    // Read commands keep their normal banner; no [dry-run] prefix.
    expect(r.stdout).not.toContain("[dry-run]");
    expect(r.stdout).toContain("Asia/Seoul");
  });

  test("--dry-run can be placed before the command name", async () => {
    const r = await runCli(
      ["--dry-run", "todo", "add", "--title", "leading flag"],
      { home },
    );
    expect(r.exitCode, r.stderr).toBe(0);
    expect(r.stdout).toContain("[dry-run] todo add");
  });

  test("migrate --dry-run + --apply still rejects (legacy compat)", async () => {
    const r = await runCli(["migrate", "--dry-run", "--apply"], { home });
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("DAY_USAGE");
    expect(r.stderr).toContain("--dry-run and --apply");
  });

  test("global --dry-run + migrate --apply is the same conflict (new path)", async () => {
    const r = await runCli(["--dry-run", "migrate", "--apply"], { home });
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("DAY_USAGE");
  });
});
