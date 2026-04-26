import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cleanupHome, makeTmpHome, runCli } from "./_helpers";

let home: string;
beforeAll(async () => {
  home = await makeTmpHome();
});
afterAll(async () => {
  await cleanupHome(home);
});

describe("docs --for-ai (S53.5)", () => {
  test("requires --for-ai (the only mode in v0.1)", async () => {
    const r = await runCli(["docs"], { home });
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("DAY_USAGE");
    expect(r.stderr).toContain("--for-ai");
  });

  test("default markdown contains identity, JTBD, CLI, MCP sections", async () => {
    const r = await runCli(["docs", "--for-ai"], { home });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(r.stdout).toContain("scaffold-day v");
    expect(r.stdout).toContain("for AI");
    expect(r.stdout).toContain("**Identity.**");
    expect(r.stdout).toContain("## JTBD → call flow");
    expect(r.stdout).toContain("## CLI commands");
    expect(r.stdout).toContain("## MCP tools");
    // a real CLI command should show up
    expect(r.stdout).toContain("`scaffold-day today`");
    // 6-section help is rendered
    expect(r.stdout).toContain("**WHAT.**");
    expect(r.stdout).toContain("**GOTCHA.**");
  });

  test("--format json emits a parseable bundle with cli + mcp arrays", async () => {
    const r = await runCli(["docs", "--for-ai", "--format", "json"], { home });
    expect(r.exitCode, r.stderr).toBe(0);
    const bundle = JSON.parse(r.stdout);
    expect(typeof bundle.scaffold_day.version).toBe("string");
    expect(typeof bundle.scaffold_day.home).toBe("string");
    expect(Array.isArray(bundle.cli)).toBe(true);
    expect(Array.isArray(bundle.mcp)).toBe(true);
    expect(Array.isArray(bundle.jtbd)).toBe(true);
    expect(bundle.cli.length).toBeGreaterThan(5);
    expect(bundle.mcp.length).toBeGreaterThan(5);

    const today = bundle.cli.find((c: { name: string }) => c.name === "today");
    expect(today).toBeDefined();
    expect(typeof today.summary).toBe("string");
    expect(typeof today.help.what).toBe("string");
    expect(typeof today.help.gotcha).toBe("string");

    for (const tool of bundle.mcp) {
      expect(typeof tool.name).toBe("string");
      expect(typeof tool.description).toBe("string");
      expect(typeof tool.tokens_est).toBe("number");
      expect(tool.inputSchema).toBeDefined();
    }
  });

  test("--format yaml emits a minimal yaml block", async () => {
    const r = await runCli(["docs", "--for-ai", "--format", "yaml"], { home });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(r.stdout).toContain("scaffold_day:");
    expect(r.stdout).toContain("version:");
    expect(r.stdout).toContain("cli:");
    expect(r.stdout).toContain("mcp:");
  });

  test("--cli-only suppresses the mcp section", async () => {
    const r = await runCli(["docs", "--for-ai", "--cli-only", "--format", "json"], { home });
    expect(r.exitCode, r.stderr).toBe(0);
    const bundle = JSON.parse(r.stdout);
    expect(bundle.cli.length).toBeGreaterThan(0);
    expect(bundle.mcp).toEqual([]);
  });

  test("--mcp-only suppresses the cli section", async () => {
    const r = await runCli(["docs", "--for-ai", "--mcp-only", "--format", "json"], { home });
    expect(r.exitCode, r.stderr).toBe(0);
    const bundle = JSON.parse(r.stdout);
    expect(bundle.cli).toEqual([]);
    expect(bundle.mcp.length).toBeGreaterThan(0);
  });

  test("--commands narrows the cli list to the named slivers", async () => {
    const r = await runCli(
      ["docs", "--for-ai", "--commands", "today,init", "--format", "json"],
      { home },
    );
    expect(r.exitCode, r.stderr).toBe(0);
    const bundle = JSON.parse(r.stdout);
    const names = bundle.cli.map((c: { name: string }) => c.name).sort();
    expect(names).toEqual(["init", "today"]);
  });

  test("--format with unknown value → DAY_INVALID_INPUT", async () => {
    const r = await runCli(["docs", "--for-ai", "--format", "toml"], { home });
    expect(r.exitCode).toBe(65);
    expect(r.stderr).toContain("DAY_INVALID_INPUT");
  });

  test("unexpected argument → DAY_USAGE", async () => {
    const r = await runCli(["docs", "--for-ai", "--bogus"], { home });
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("DAY_USAGE");
  });
});
