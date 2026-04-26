import { afterEach, describe, expect, test } from "bun:test";
import { cleanupHome, makeTmpHome, runCli } from "./_helpers";

let home = "";
afterEach(async () => {
  await cleanupHome(home);
  home = "";
});

describe("migrate command", () => {
  test("at the current schema version → noop, exit 0", async () => {
    home = await makeTmpHome({ schemaVersion: "0.1.0" });
    const r = await runCli(["migrate"], { home });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("already at target");
    expect(r.stdout).toContain("0.1.0");
  });

  test("--apply on the current version is also a noop", async () => {
    home = await makeTmpHome({ schemaVersion: "0.1.0" });
    const r = await runCli(["migrate", "--apply"], { home });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("(apply)");
    expect(r.stdout).toContain("already at target");
  });

  test("future schema_version → DAY_SCHEMA_FUTURE_VERSION exit 78", async () => {
    home = await makeTmpHome({ schemaVersion: "9.9.9" });
    const r = await runCli(["migrate"], { home });
    expect(r.exitCode).toBe(78);
    expect(r.stderr).toContain("DAY_SCHEMA_FUTURE_VERSION");
    expect(r.stderr).toContain("9.9.9");
    expect(r.stderr).toContain("0.1.0"); // mentions the binary's expected version
  });

  test("future schema + --json → JSON error shape with exit_code 78", async () => {
    home = await makeTmpHome({ schemaVersion: "9.9.9" });
    const r = await runCli(["migrate", "--json"], { home });
    expect(r.exitCode).toBe(78);
    const parsed = JSON.parse(r.stderr);
    expect(parsed.error.code).toBe("DAY_SCHEMA_FUTURE_VERSION");
    expect(parsed.exit_code).toBe(78);
    expect(parsed.error.context.local).toBe("9.9.9");
    expect(parsed.error.context.expected).toBe("0.1.0");
  });

  test("uninitialized home → DAY_NOT_INITIALIZED exit 78", async () => {
    home = await makeTmpHome({ uninitialized: true });
    const r = await runCli(["migrate"], { home });
    expect(r.exitCode).toBe(78);
    expect(r.stderr).toContain("DAY_NOT_INITIALIZED");
  });

  test("--dry-run + --apply together → DAY_USAGE exit 2", async () => {
    home = await makeTmpHome();
    const r = await runCli(["migrate", "--dry-run", "--apply"], { home });
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("DAY_USAGE");
    expect(r.stderr).toContain("mutually exclusive");
  });
});
