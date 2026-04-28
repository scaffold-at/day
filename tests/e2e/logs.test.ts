import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanupHome, makeTmpHome, runCli } from "./_helpers";

let home: string;
beforeEach(async () => {
  home = await makeTmpHome();
});
afterEach(async () => {
  await cleanupHome(home);
});

const KST_NOW = "2026-04-29T08:00:00+09:00";

async function seedActivity(home: string): Promise<{ todoId: string; placementId: string }> {
  await runCli(["init", "--force"], { home });
  await runCli(["morning"], { home, env: { SCAFFOLD_DAY_NOW: KST_NOW } });

  const todo = await runCli(
    ["todo", "add", "--title", "draft Q2 OKR", "--duration-min", "60", "--json"],
    { home, env: { SCAFFOLD_DAY_NOW: KST_NOW } },
  );
  const todoId = JSON.parse(todo.stdout).id;

  // Pin the slot to a KST-shaped ISO so hard-rule evaluation reads
  // hours in the policy timezone (the engine looks at the trailing
  // offset; UTC `Z` slots can land inside the 22:00-07:00 sleep
  // protected_range when interpreted in policy-local hours).
  const placed = await runCli(
    ["place", "do", todoId, "--slot", "2026-04-29T10:00:00+09:00", "--json"],
    { home, env: { SCAFFOLD_DAY_NOW: KST_NOW } },
  );
  const placementId = JSON.parse(placed.stdout).id;
  return { todoId, placementId };
}

describe("logs (S63)", () => {
  test("default returns recent placement + heartbeat entries", async () => {
    await seedActivity(home);
    const r = await runCli(["logs", "--json"], { home, env: { SCAFFOLD_DAY_NOW: KST_NOW } });
    expect(r.exitCode, r.stderr).toBe(0);
    const lines = r.stdout
      .split("\n")
      .filter((l) => l)
      .map((l) => JSON.parse(l));
    const kinds = new Set(lines.map((l) => l.kind));
    expect(kinds.has("heartbeat")).toBe(true);
    expect(kinds.has("placement")).toBe(true);
  });

  test("--kind heartbeat narrows the stream", async () => {
    await seedActivity(home);
    const r = await runCli(["logs", "--kind", "heartbeat", "--json"], {
      home,
      env: { SCAFFOLD_DAY_NOW: KST_NOW },
    });
    const lines = r.stdout.split("\n").filter((l) => l).map((l) => JSON.parse(l));
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(l.kind).toBe("heartbeat");
  });

  test("--since 7d filters by relative duration", async () => {
    await seedActivity(home);
    const r = await runCli(["logs", "--since", "7d", "--json"], {
      home,
      env: { SCAFFOLD_DAY_NOW: KST_NOW },
    });
    expect(r.exitCode).toBe(0);
    // No assertion on count — just ensure it doesn't reject the duration.
  });

  test("--since with bad duration → DAY_INVALID_INPUT", async () => {
    await runCli(["init"], { home });
    const r = await runCli(["logs", "--since", "bogus"], {
      home,
      env: { SCAFFOLD_DAY_NOW: KST_NOW },
    });
    expect(r.exitCode).toBe(65);
    expect(r.stderr).toContain("DAY_INVALID_INPUT");
  });

  test("--kind unknown → DAY_INVALID_INPUT", async () => {
    await runCli(["init"], { home });
    const r = await runCli(["logs", "--kind", "weather"], {
      home,
      env: { SCAFFOLD_DAY_NOW: KST_NOW },
    });
    expect(r.exitCode).toBe(65);
    expect(r.stderr).toContain("DAY_INVALID_INPUT");
  });

  test("--follow throws DAY_USAGE (placeholder for v0.2.x)", async () => {
    await runCli(["init"], { home });
    const r = await runCli(["logs", "--follow"], {
      home,
      env: { SCAFFOLD_DAY_NOW: KST_NOW },
    });
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("DAY_USAGE");
    expect(r.stderr).toContain("--follow");
  });

  test("empty placement log → 'no entries' notice (exit 0)", async () => {
    // Pre-init home with no placement / conflict activity. CLI
    // dispatch auto-fallbacks a heartbeat for the day, but filtering
    // to `--kind placement` keeps the slice empty.
    const r = await runCli(["logs", "--kind", "placement"], {
      home,
      env: { SCAFFOLD_DAY_NOW: KST_NOW },
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("no entries");
  });

  test("human format includes 'place' and 'anchor' tags", async () => {
    await seedActivity(home);
    const r = await runCli(["logs"], { home, env: { SCAFFOLD_DAY_NOW: KST_NOW } });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("anchor");
    expect(r.stdout).toContain("place");
  });
});
