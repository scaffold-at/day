import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanupHome, makeTmpHome, runCli } from "./_helpers";

let home: string;
beforeEach(async () => {
  home = await makeTmpHome();
});
afterEach(async () => {
  await cleanupHome(home);
});

const KST_07 = "2026-04-28T07:00:00+09:00";

async function seedPolicyWithCognitiveLoad(home: string): Promise<void> {
  await runCli(["init", "--force"], { home });
  await runCli(
    [
      "policy",
      "patch",
      JSON.stringify([
        {
          op: "add",
          path: "/context/cognitive_load",
          value: {
            decay: "linear",
            full_capacity_window_hours: 4,
            heavy_task_threshold_min: 60,
            linear_penalty_per_hour: 10,
            exponential_base: 2,
          },
        },
      ]),
    ],
    { home },
  );
}

describe("cognitive_load integration (S59)", () => {
  test("heavy task ranks earlier slots higher than later ones", async () => {
    await seedPolicyWithCognitiveLoad(home);
    await runCli(["morning"], { home, env: { SCAFFOLD_DAY_NOW: KST_07 } });

    // 90-minute heavy todo.
    const todo = await runCli(
      [
        "todo",
        "add",
        "--title",
        "deep-work block",
        "--duration-min",
        "90",
        "--json",
      ],
      { home, env: { SCAFFOLD_DAY_NOW: KST_07 } },
    );
    const id = JSON.parse(todo.stdout).id;

    const r = await runCli(
      ["place", "suggest", id, "--json", "--within", "1", "--max", "10"],
      { home, env: { SCAFFOLD_DAY_NOW: KST_07 } },
    );
    expect(r.exitCode, r.stderr).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.candidates.length).toBeGreaterThan(2);

    // Top slot's score should be ≥ last slot's score.
    const top = out.candidates[0];
    const last = out.candidates[out.candidates.length - 1];
    expect(top.score).toBeGreaterThanOrEqual(last.score);

    // Past-window slots are tagged with cognitive_load severity soft.
    const lateAfternoon = out.candidates.find((c: { start: string }) => {
      const hour = Number(c.start.slice(11, 13));
      return hour >= 14;
    });
    if (lateAfternoon && lateAfternoon.cognitive_load) {
      expect(["soft", "ok"]).toContain(lateAfternoon.cognitive_load.severity);
      if (lateAfternoon.cognitive_load.severity === "soft") {
        expect(lateAfternoon.cognitive_load.penalty).toBeLessThan(0);
        expect(lateAfternoon.cognitive_load.is_heavy).toBe(true);
      }
    }
  });

  test("light task is unaffected by cognitive_load (no penalty at any slot)", async () => {
    await seedPolicyWithCognitiveLoad(home);
    await runCli(["morning"], { home, env: { SCAFFOLD_DAY_NOW: KST_07 } });

    // 30-minute light todo.
    const todo = await runCli(
      [
        "todo",
        "add",
        "--title",
        "quick admin",
        "--duration-min",
        "30",
        "--json",
      ],
      { home, env: { SCAFFOLD_DAY_NOW: KST_07 } },
    );
    const id = JSON.parse(todo.stdout).id;

    const r = await runCli(
      ["place", "suggest", id, "--json", "--within", "1", "--max", "10"],
      { home, env: { SCAFFOLD_DAY_NOW: KST_07 } },
    );
    expect(r.exitCode, r.stderr).toBe(0);
    const out = JSON.parse(r.stdout);
    for (const c of out.candidates) {
      if (c.cognitive_load) {
        expect(c.cognitive_load.is_heavy).toBe(false);
        expect(c.cognitive_load.penalty).toBe(0);
      }
    }
  });

  test("policy without cognitive_load → no eval (back-compat)", async () => {
    await runCli(["init", "--force"], { home });
    await runCli(["morning"], { home, env: { SCAFFOLD_DAY_NOW: KST_07 } });
    const todo = await runCli(
      [
        "todo",
        "add",
        "--title",
        "no-cog policy",
        "--duration-min",
        "120",
        "--json",
      ],
      { home, env: { SCAFFOLD_DAY_NOW: KST_07 } },
    );
    const id = JSON.parse(todo.stdout).id;
    const r = await runCli(
      ["place", "suggest", id, "--json", "--within", "1"],
      { home, env: { SCAFFOLD_DAY_NOW: KST_07 } },
    );
    const out = JSON.parse(r.stdout);
    for (const c of out.candidates) {
      const cl = c.cognitive_load;
      expect(cl === null || cl === undefined || cl.severity === "skip").toBe(true);
    }
  });

  test("rationale string surfaces cognitive_load contribution when soft", async () => {
    await seedPolicyWithCognitiveLoad(home);
    await runCli(["morning"], { home, env: { SCAFFOLD_DAY_NOW: KST_07 } });
    const todo = await runCli(
      ["todo", "add", "--title", "heavy late", "--duration-min", "90", "--json"],
      { home, env: { SCAFFOLD_DAY_NOW: KST_07 } },
    );
    const id = JSON.parse(todo.stdout).id;
    const r = await runCli(
      ["place", "suggest", id, "--json", "--within", "1", "--max", "20"],
      { home, env: { SCAFFOLD_DAY_NOW: KST_07 } },
    );
    const out = JSON.parse(r.stdout);
    const soft = out.candidates.find(
      (c: { cognitive_load: { severity: string } | null }) =>
        c.cognitive_load !== null && c.cognitive_load.severity === "soft",
    );
    expect(soft).toBeDefined();
    expect(soft.rationale).toContain("cognitive_load");
  });
});
