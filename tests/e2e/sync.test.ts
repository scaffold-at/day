import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { cleanupHome, makeTmpHome, runCli } from "./_helpers";

let home: string;
beforeEach(async () => {
  home = await makeTmpHome();
});
afterEach(async () => {
  await cleanupHome(home);
});

describe("scaffold-day sync (S71/S72 wire-up)", () => {
  test("without a stored token → DAY_NOT_INITIALIZED exit 78", async () => {
    const r = await runCli(["sync"], { home });
    expect(r.exitCode).toBe(78);
    expect(r.stderr).toContain("DAY_NOT_INITIALIZED");
    expect(r.stderr).toContain("auth login");
  });

  test("--end before --start → DAY_INVALID_INPUT", async () => {
    await runCli(
      [
        "auth",
        "login",
        "--access-token", "AT-test",
        "--refresh-token", "RT-test",
        "--account-email", "u@example.com",
      ],
      { home },
    );
    const r = await runCli(
      [
        "sync",
        "--start", "2026-05-01",
        "--end", "2026-04-30",
      ],
      { home },
    );
    expect(r.exitCode).toBe(65);
    expect(r.stderr).toContain("DAY_INVALID_INPUT");
    expect(r.stderr).toContain("--end must be on or after --start");
  });

  test("unknown flag → DAY_USAGE", async () => {
    const r = await runCli(["sync", "--bogus"], { home });
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("DAY_USAGE");
  });

  test("docs --commands sync surfaces the input contract", async () => {
    const r = await runCli(
      ["docs", "--for-ai", "--commands", "sync"],
      { home },
    );
    expect(r.exitCode, r.stderr).toBe(0);
    expect(r.stdout).toContain("--account");
    expect(r.stdout).toContain("--dry-run");
    expect(r.stdout).toContain("--push");
  });
});

describe("event mutations auto-queue pending pushes (S71 push wire-up)", () => {
  async function login(): Promise<void> {
    const r = await runCli(
      [
        "auth", "login",
        "--access-token", "AT-test",
        "--refresh-token", "RT-test",
        "--account-email", "u@example.com",
      ],
      { home },
    );
    expect(r.exitCode, r.stderr).toBe(0);
  }

  async function readPending(): Promise<unknown[]> {
    try {
      const raw = await readFile(
        path.join(home, "sync", "google-calendar-pending.jsonl"),
        "utf8",
      );
      return raw.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
    } catch {
      return [];
    }
  }

  test("event add (with token) queues a 'create' entry", async () => {
    await login();
    await runCli(["policy", "preset", "apply", "balanced"], { home });
    const r = await runCli(
      [
        "event", "add",
        "--title", "queued",
        "--start", "2026-05-08T10:00:00+09:00",
        "--end", "2026-05-08T11:00:00+09:00",
      ],
      { home },
    );
    expect(r.exitCode, r.stderr).toBe(0);
    const queue = await readPending();
    expect(queue).toHaveLength(1);
    expect((queue[0] as { kind: string }).kind).toBe("create");
  });

  test("event add (no token) does NOT queue", async () => {
    await runCli(["policy", "preset", "apply", "balanced"], { home });
    const r = await runCli(
      [
        "event", "add",
        "--title", "offline",
        "--start", "2026-05-08T10:00:00+09:00",
        "--end", "2026-05-08T11:00:00+09:00",
      ],
      { home },
    );
    expect(r.exitCode, r.stderr).toBe(0);
    const queue = await readPending();
    expect(queue).toHaveLength(0);
  });

  test("event update + delete queue separate entries", async () => {
    await login();
    await runCli(["policy", "preset", "apply", "balanced"], { home });
    const add = await runCli(
      [
        "event", "add",
        "--title", "x",
        "--start", "2026-05-08T10:00:00+09:00",
        "--end", "2026-05-08T11:00:00+09:00",
      ],
      { home },
    );
    const id = /id:\s+(evt_[a-z0-9]{14})/.exec(add.stdout)![1] as string;
    await runCli(
      ["event", "update", id, "--title", "renamed"],
      { home },
    );
    await runCli(["event", "delete", id], { home });
    const queue = await readPending();
    expect(queue).toHaveLength(3);
    const kinds = queue.map((q) => (q as { kind: string }).kind);
    expect(kinds).toEqual(["create", "update", "delete"]);
    // The update entry's patch should contain only the touched field.
    expect((queue[1] as { patch: unknown }).patch).toEqual({ title: "renamed" });
  });
});
