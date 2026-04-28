import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanupHome, makeTmpHome, runCli } from "./_helpers";

let home: string;
beforeEach(async () => {
  home = await makeTmpHome();
});
afterEach(async () => {
  await cleanupHome(home);
});

const KST_07_TODAY = "2026-04-28T07:00:00+09:00";

async function seedPolicyWithRecovery(home: string): Promise<void> {
  await runCli(["init", "--force"], { home });
  await runCli(
    [
      "policy",
      "patch",
      JSON.stringify([
        {
          op: "add",
          path: "/context/recovery_block",
          value: {
            late_threshold_minutes_past_working_end: 120,
            morning_block_hours: 2,
            soft_penalty: 30,
          },
        },
      ]),
    ],
    { home },
  );
}

describe("recovery_block integration (S62)", () => {
  test("forced-late event yesterday → today's morning slots get a soft penalty", async () => {
    await seedPolicyWithRecovery(home);
    await runCli(["morning"], { home, env: { SCAFFOLD_DAY_NOW: KST_07_TODAY } });

    // Yesterday evening event ending 21:00 (3h past 18:00 working end).
    await runCli(
      [
        "event",
        "add",
        "--title",
        "late workshop",
        "--start",
        "2026-04-27T19:00:00+09:00",
        "--end",
        "2026-04-27T21:00:00+09:00",
      ],
      { home, env: { SCAFFOLD_DAY_NOW: KST_07_TODAY } },
    );

    const todo = await runCli(
      ["todo", "add", "--title", "morning task", "--duration-min", "60", "--json"],
      { home, env: { SCAFFOLD_DAY_NOW: KST_07_TODAY } },
    );
    const id = JSON.parse(todo.stdout).id;

    const r = await runCli(
      ["place", "suggest", id, "--json", "--within", "1", "--max", "20"],
      { home, env: { SCAFFOLD_DAY_NOW: KST_07_TODAY } },
    );
    expect(r.exitCode, r.stderr).toBe(0);
    const out = JSON.parse(r.stdout);

    // Every candidate should carry recovery_block evaluation; at
    // least one inside the morning window should hit soft penalty.
    expect(out.candidates.length).toBeGreaterThan(0);
    let triggeredCount = 0;
    let softCount = 0;
    for (const c of out.candidates) {
      expect(c.recovery_block).not.toBeNull();
      expect(c.recovery_block.triggered).toBe(true);
      if (c.recovery_block.severity === "soft") {
        expect(c.recovery_block.penalty).toBe(-30);
        softCount++;
      }
      triggeredCount++;
    }
    expect(triggeredCount).toBe(out.candidates.length);
    // At least one slot should fall inside the morning recovery
    // window. When morning slots are themselves blocked by other
    // hard rules, this assertion is the test's signal.
    expect(softCount).toBeGreaterThan(0);
  });

  test("no late event yesterday → no penalty applied", async () => {
    await seedPolicyWithRecovery(home);
    await runCli(["morning"], { home, env: { SCAFFOLD_DAY_NOW: KST_07_TODAY } });

    // Yesterday well within working hours.
    await runCli(
      [
        "event",
        "add",
        "--title",
        "lunch chat",
        "--start",
        "2026-04-27T13:00:00+09:00",
        "--end",
        "2026-04-27T14:00:00+09:00",
      ],
      { home, env: { SCAFFOLD_DAY_NOW: KST_07_TODAY } },
    );

    const todo = await runCli(
      ["todo", "add", "--title", "morning task", "--duration-min", "60", "--json"],
      { home, env: { SCAFFOLD_DAY_NOW: KST_07_TODAY } },
    );
    const id = JSON.parse(todo.stdout).id;

    const r = await runCli(
      ["place", "suggest", id, "--json", "--within", "1", "--max", "10"],
      { home, env: { SCAFFOLD_DAY_NOW: KST_07_TODAY } },
    );
    const out = JSON.parse(r.stdout);
    for (const c of out.candidates) {
      expect(c.recovery_block.triggered).toBe(false);
    }
  });

  test("no recovery_block policy field → engine skips eval", async () => {
    await runCli(["init", "--force"], { home });
    await runCli(["morning"], { home, env: { SCAFFOLD_DAY_NOW: KST_07_TODAY } });
    // Add a late event and confirm the engine still doesn't apply
    // a penalty when the policy has no recovery_block configured.
    await runCli(
      [
        "event",
        "add",
        "--title",
        "late",
        "--start",
        "2026-04-27T19:00:00+09:00",
        "--end",
        "2026-04-27T22:00:00+09:00",
      ],
      { home, env: { SCAFFOLD_DAY_NOW: KST_07_TODAY } },
    );
    const todo = await runCli(
      ["todo", "add", "--title", "morning task", "--duration-min", "60", "--json"],
      { home, env: { SCAFFOLD_DAY_NOW: KST_07_TODAY } },
    );
    const id = JSON.parse(todo.stdout).id;
    const r = await runCli(
      ["place", "suggest", id, "--json", "--within", "1"],
      { home, env: { SCAFFOLD_DAY_NOW: KST_07_TODAY } },
    );
    const out = JSON.parse(r.stdout);
    for (const c of out.candidates) {
      expect(c.recovery_block.severity === "skip" || c.recovery_block === null).toBe(true);
    }
  });
});
