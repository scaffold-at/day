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
const KST_07_YESTERDAY = "2026-04-27T07:00:00+09:00";
const KST_03_OVERNIGHT = "2026-04-28T03:00:00+09:00";

async function seedPolicyWithBudget(home: string): Promise<void> {
  await runCli(["init", "--force"], { home });
  await runCli(
    [
      "policy",
      "patch",
      JSON.stringify([
        {
          op: "add",
          path: "/context/sleep_budget",
          value: { target_hours: 8, min_hours: 6, soft_penalty_per_hour: 15 },
        },
      ]),
    ],
    { home },
  );
}

describe("rest_suggestion (S61)", () => {
  test("8h sleep → today shows no rest break", async () => {
    await seedPolicyWithBudget(home);
    await runCli(["morning"], { home, env: { SCAFFOLD_DAY_NOW: KST_07_YESTERDAY } });
    await runCli(["morning"], { home, env: { SCAFFOLD_DAY_NOW: KST_07 } });

    const r = await runCli(["today", "--tz", "Asia/Seoul"], {
      home,
      env: { SCAFFOLD_DAY_NOW: KST_07 },
    });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(r.stdout).not.toContain("Rest break suggested");
  });

  test("4h sleep → today shows the suggestion", async () => {
    await seedPolicyWithBudget(home);
    await runCli(["morning"], { home, env: { SCAFFOLD_DAY_NOW: KST_07_YESTERDAY } });
    // "Today" anchor at 03:00 → only 4h gap above the typical 16h awake.
    await runCli(["morning"], { home, env: { SCAFFOLD_DAY_NOW: KST_03_OVERNIGHT } });

    const r = await runCli(["today", "--tz", "Asia/Seoul"], {
      home,
      env: { SCAFFOLD_DAY_NOW: KST_03_OVERNIGHT },
    });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(r.stdout).toContain("Rest break suggested");
    expect(r.stdout).toContain("20 min");
    expect(r.stdout).toContain("4.0h");
  });

  test("today --json carries rest_suggestion", async () => {
    await seedPolicyWithBudget(home);
    await runCli(["morning"], { home, env: { SCAFFOLD_DAY_NOW: KST_07_YESTERDAY } });
    await runCli(["morning"], { home, env: { SCAFFOLD_DAY_NOW: KST_03_OVERNIGHT } });

    const r = await runCli(["today", "--json", "--tz", "Asia/Seoul"], {
      home,
      env: { SCAFFOLD_DAY_NOW: KST_03_OVERNIGHT },
    });
    expect(r.exitCode).toBe(0);
    const view = JSON.parse(r.stdout);
    expect(view.rest_suggestion).not.toBeNull();
    expect(view.rest_suggestion.suggest).toBe(true);
    expect(view.rest_suggestion.break_min).toBe(20);
    expect(view.rest_suggestion.measured_sleep_hours).toBe(4);
  });

  test("missing yesterday anchor → no suggestion", async () => {
    await seedPolicyWithBudget(home);
    // Only today anchor recorded.
    await runCli(["morning"], { home, env: { SCAFFOLD_DAY_NOW: KST_07 } });
    const r = await runCli(["today", "--json", "--tz", "Asia/Seoul"], {
      home,
      env: { SCAFFOLD_DAY_NOW: KST_07 },
    });
    const view = JSON.parse(r.stdout);
    expect(view.rest_suggestion.suggest).toBe(false);
    expect(view.rest_suggestion.measured_sleep_hours).toBeNull();
  });

  test("policy without sleep_budget → suggestion never fires", async () => {
    await runCli(["init", "--force"], { home });
    await runCli(["morning"], { home, env: { SCAFFOLD_DAY_NOW: KST_07_YESTERDAY } });
    await runCli(["morning"], { home, env: { SCAFFOLD_DAY_NOW: KST_03_OVERNIGHT } });

    const r = await runCli(["today", "--json", "--tz", "Asia/Seoul"], {
      home,
      env: { SCAFFOLD_DAY_NOW: KST_03_OVERNIGHT },
    });
    const view = JSON.parse(r.stdout);
    expect(view.rest_suggestion.suggest).toBe(false);
  });
});
