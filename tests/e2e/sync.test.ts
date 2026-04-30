import { afterEach, beforeEach, describe, expect, test } from "bun:test";
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
  });
});
