import { describe, expect, test } from "bun:test";
import { runCli } from "./_helpers";

// self-update operates on the *compiled* binary's process.execPath.
// Under e2e we always invoke via `bun run packages/day-cli/src/index.ts`,
// so process.execPath is the bun runtime — the command should refuse
// most subcommands and only allow `--help` / `--check` shape probes.

describe("self-update (S67) — dev-mode guards", () => {
  test("refuses to install when execPath is the bun runtime", async () => {
    const r = await runCli(["self-update"]);
    expect(r.exitCode).toBe(65);
    expect(r.stderr).toContain("DAY_INVALID_INPUT");
    expect(r.stderr).toContain("compiled binaries only");
  });

  test("--rollback also refuses in dev mode", async () => {
    const r = await runCli(["self-update", "--rollback"]);
    expect(r.exitCode).toBe(65);
    expect(r.stderr).toContain("DAY_INVALID_INPUT");
  });

  test("--check + --rollback are mutually exclusive", async () => {
    const r = await runCli(["self-update", "--check", "--rollback"]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("mutually exclusive");
  });

  test("unexpected argument → DAY_USAGE", async () => {
    const r = await runCli(["self-update", "--bogus"]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("DAY_USAGE");
    expect(r.stderr).toContain("--bogus");
  });

  test("--help renders the 6-section template", async () => {
    const r = await runCli(["self-update", "--help"]);
    expect(r.exitCode).toBe(0);
    for (const section of ["WHAT", "WHEN", "COST", "INPUT", "RETURN", "GOTCHA"]) {
      expect(r.stdout).toContain(section);
    }
  });
});
