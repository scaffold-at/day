import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { isScaffoldError } from "../error";
import { ClaudeCliProvider } from "./claude-cli-provider";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "scaffold-day-claude-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writeFakeBinary(name: string, body: string): Promise<string> {
  const target = path.join(dir, name);
  await writeFile(target, body, "utf8");
  await chmod(target, 0o755);
  return target;
}

const VERSION_PROBE = "#!/usr/bin/env sh\nif [ \"$1\" = \"--version\" ]; then echo 'claude-cli 0.0.0'; exit 0; fi\n";

describe("ClaudeCliProvider — availability", () => {
  test("missing binary → available() === false (no throw)", async () => {
    const p = new ClaudeCliProvider({
      // empty PATH + no system fallback hits + non-absolute command name
      command: "claude-not-installed-anywhere-12345",
      searchPath: "/no/such/dir",
    });
    expect(await p.available()).toBe(false);
  });

  test("present binary that responds to --version → available() === true", async () => {
    await writeFakeBinary("claude", `${VERSION_PROBE}exit 1\n`);
    const p = new ClaudeCliProvider({ command: "claude", searchPath: dir });
    expect(await p.available()).toBe(true);
  });

  test("absolute command path bypasses PATH search", async () => {
    const bin = await writeFakeBinary("claude-explicit", VERSION_PROBE);
    const p = new ClaudeCliProvider({ command: bin });
    expect(await p.available()).toBe(true);
  });

  test("non-executable file at the command path → unavailable", async () => {
    const bin = path.join(dir, "claude");
    await writeFile(bin, VERSION_PROBE, "utf8");
    // No chmod → not executable.
    const p = new ClaudeCliProvider({ command: "claude", searchPath: dir });
    expect(await p.available()).toBe(false);
  });

  test("availability is cached after first probe", async () => {
    await writeFakeBinary("claude", VERSION_PROBE);
    const p = new ClaudeCliProvider({ command: "claude", searchPath: dir });
    expect(await p.available()).toBe(true);
    // Remove the binary; cache should keep the answer.
    await rm(dir, { recursive: true, force: true });
    dir = await mkdtemp(path.join(tmpdir(), "scaffold-day-claude-"));
    expect(await p.available()).toBe(true);
  });
});

describe("ClaudeCliProvider — scoreImportance", () => {
  test("happy path returns parsed dimensions + computed_by", async () => {
    await writeFakeBinary(
      "claude",
      [
        "#!/usr/bin/env sh",
        'if [ "$1" = "--version" ]; then echo claude; exit 0; fi',
        "cat <<EOF",
        '{"urgency":7,"impact":8,"effort":4,"reversibility":6,"external_dependency":true,"deadline":"hard","reasoning":"OKR-relevant"}',
        "EOF",
      ].join("\n"),
    );
    const p = new ClaudeCliProvider({ command: "claude", searchPath: dir });
    const result = await p.scoreImportance({ title: "Ship S33" });
    expect(result.urgency).toBe(7);
    expect(result.impact).toBe(8);
    expect(result.deadline).toBe("hard");
    expect(result.external_dependency).toBe(true);
    expect(result.reasoning).toBe("OKR-relevant");
    expect(result.computed_by).toBe("claude-cli");
  });

  test("non-JSON stdout → DAY_PROVIDER_UNSUPPORTED", async () => {
    await writeFakeBinary(
      "claude",
      [
        "#!/usr/bin/env sh",
        'if [ "$1" = "--version" ]; then echo claude; exit 0; fi',
        "echo 'not json at all'",
      ].join("\n"),
    );
    const p = new ClaudeCliProvider({ command: "claude", searchPath: dir });
    let caught: unknown;
    try {
      await p.scoreImportance({ title: "x" });
    } catch (err) {
      caught = err;
    }
    expect(isScaffoldError(caught)).toBe(true);
    if (isScaffoldError(caught)) expect(caught.code).toBe("DAY_PROVIDER_UNSUPPORTED");
  });

  test("schema-violating JSON → DAY_PROVIDER_UNSUPPORTED", async () => {
    await writeFakeBinary(
      "claude",
      [
        "#!/usr/bin/env sh",
        'if [ "$1" = "--version" ]; then echo claude; exit 0; fi',
        "cat <<EOF",
        '{"urgency":7,"reasoning":"x"}',
        "EOF",
      ].join("\n"),
    );
    const p = new ClaudeCliProvider({ command: "claude", searchPath: dir });
    let caught: unknown;
    try {
      await p.scoreImportance({ title: "x" });
    } catch (err) {
      caught = err;
    }
    expect(isScaffoldError(caught)).toBe(true);
    if (isScaffoldError(caught)) expect(caught.code).toBe("DAY_PROVIDER_UNSUPPORTED");
  });

  test("auth-error stderr → DAY_PROVIDER_AUTH_EXPIRED", async () => {
    await writeFakeBinary(
      "claude",
      [
        "#!/usr/bin/env sh",
        'if [ "$1" = "--version" ]; then echo claude; exit 0; fi',
        "echo 'Authentication failed: please run claude login' >&2",
        "exit 2",
      ].join("\n"),
    );
    const p = new ClaudeCliProvider({ command: "claude", searchPath: dir });
    let caught: unknown;
    try {
      await p.scoreImportance({ title: "x" });
    } catch (err) {
      caught = err;
    }
    expect(isScaffoldError(caught)).toBe(true);
    if (isScaffoldError(caught)) expect(caught.code).toBe("DAY_PROVIDER_AUTH_EXPIRED");
  });

  test("hung child is killed; throws DAY_PROVIDER_TIMEOUT", async () => {
    await writeFakeBinary(
      "claude",
      [
        "#!/usr/bin/env sh",
        'if [ "$1" = "--version" ]; then echo claude; exit 0; fi',
        "sleep 5",
      ].join("\n"),
    );
    const p = new ClaudeCliProvider({
      command: "claude",
      searchPath: dir,
      timeoutMs: 200,
    });
    let caught: unknown;
    try {
      await p.scoreImportance({ title: "x" });
    } catch (err) {
      caught = err;
    }
    expect(isScaffoldError(caught)).toBe(true);
    if (isScaffoldError(caught)) expect(caught.code).toBe("DAY_PROVIDER_TIMEOUT");
  });

  test("calling scoreImportance when unavailable throws DAY_PROVIDER_UNAVAILABLE", async () => {
    const p = new ClaudeCliProvider({
      command: "claude-missing",
      searchPath: "/no/such/dir",
    });
    let caught: unknown;
    try {
      await p.scoreImportance({ title: "x" });
    } catch (err) {
      caught = err;
    }
    expect(isScaffoldError(caught)).toBe(true);
    if (isScaffoldError(caught)) expect(caught.code).toBe("DAY_PROVIDER_UNAVAILABLE");
  });
});

describe("ClaudeCliProvider — classifyEvent", () => {
  test("happy path returns scores + computed_by", async () => {
    await writeFakeBinary(
      "claude",
      [
        "#!/usr/bin/env sh",
        'if [ "$1" = "--version" ]; then echo claude; exit 0; fi',
        "cat <<EOF",
        '{"scores":{"meeting":0.9,"deep-work":0.1},"reasoning":"team meeting"}',
        "EOF",
      ].join("\n"),
    );
    const p = new ClaudeCliProvider({ command: "claude", searchPath: dir });
    const result = await p.classifyEvent(
      {
        title: "1:1",
        start: "2026-04-26T10:00:00+09:00",
        end: "2026-04-26T11:00:00+09:00",
      },
      ["meeting", "deep-work"],
    );
    expect(result.scores.meeting).toBe(0.9);
    expect(result.computed_by).toBe("claude-cli");
  });
});

describe("ClaudeCliProvider — capabilities", () => {
  test("declares Tier 1, subscription cost, 200K context", () => {
    const p = new ClaudeCliProvider();
    const caps = p.capabilities();
    expect(caps.tier).toBe(1);
    expect(caps.approx_cost_per_call).toBe("subscription");
    expect(caps.approx_context_window).toBe(200_000);
    expect(caps.supports_classification).toBe(true);
    expect(caps.supports_importance).toBe(true);
  });
});
