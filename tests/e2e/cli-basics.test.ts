import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cleanupHome, makeTmpHome, runCli } from "./_helpers";

let home: string;
beforeAll(async () => {
  home = await makeTmpHome();
});
afterAll(async () => {
  await cleanupHome(home);
});

const REQUIRED_COMMANDS = [
  "today",
  "init",
  "doctor",
  "migrate",
  "day",
  "week",
  "event",
  "mcp",
  "docs",
  "feedback",
  "self-update",
  "rebuild-index",
  "logs",
  "telemetry",
] as const;

const HELP_SECTIONS = ["WHAT", "WHEN", "COST", "INPUT", "RETURN", "GOTCHA"] as const;

describe("CLI basics — version / help / dispatch", () => {
  test("--version exits 0 and prints the version line", async () => {
    const r = await runCli(["--version"], { home });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/scaffold-day v\d+\.\d+\.\d+/);
  });

  test("-v alias works the same", async () => {
    const r = await runCli(["-v"], { home });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/scaffold-day v\d+\.\d+\.\d+/);
  });

  test("no args prints root help and lists every registered command", async () => {
    const r = await runCli([], { home });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("USAGE");
    for (const cmd of REQUIRED_COMMANDS) {
      expect(r.stdout, `command '${cmd}' missing from root help`).toContain(cmd);
    }
  });

  test("--help is identical to no-args (root help)", async () => {
    const r = await runCli(["--help"], { home });
    expect(r.exitCode).toBe(0);
    for (const cmd of REQUIRED_COMMANDS) {
      expect(r.stdout).toContain(cmd);
    }
  });
});

describe("CLI basics — every command exposes the 6-section help", () => {
  for (const cmd of REQUIRED_COMMANDS) {
    test(`${cmd} --help renders WHAT/WHEN/COST/INPUT/RETURN/GOTCHA`, async () => {
      const r = await runCli([cmd, "--help"], { home });
      expect(r.exitCode, `${cmd} --help`).toBe(0);
      for (const section of HELP_SECTIONS) {
        expect(r.stdout, `${cmd} missing ${section}`).toContain(section);
      }
    });
  }
});

describe("CLI basics — error format (DAY_*)", () => {
  test("unknown command → DAY_USAGE exit 2 with cause/try/docs", async () => {
    const r = await runCli(["foo"], { home });
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("DAY_USAGE: unknown command 'foo'");
    expect(r.stderr).toContain("CAUSE");
    expect(r.stderr).toContain("TRY");
    expect(r.stderr).toContain("DOCS");
  });

  test("unknown top-level option → DAY_USAGE exit 2", async () => {
    const r = await runCli(["--bogus"], { home });
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("DAY_USAGE: unknown option '--bogus'");
  });

  test("--json on error emits a single-line structured JSON shape", async () => {
    const r = await runCli(["foo", "--json"], { home });
    expect(r.exitCode).toBe(2);
    const parsed = JSON.parse(r.stderr);
    expect(parsed.error.code).toBe("DAY_USAGE");
    expect(typeof parsed.error.cause).toBe("string");
    expect(Array.isArray(parsed.error.try)).toBe(true);
    expect(parsed.exit_code).toBe(2);
  });

  test("LC_ALL=ko_KR.UTF-8 renders the Korean 1-line summary", async () => {
    const r = await runCli(["foo"], {
      home,
      env: { LC_ALL: "ko_KR.UTF-8" },
    });
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("알 수 없는 명령 'foo'");
  });

  test("NO_COLOR=1 emits zero ANSI escape sequences on error", async () => {
    const r = await runCli(["foo"], { home });
    expect(r.stderr.includes("\x1b[")).toBe(false);
  });
});
