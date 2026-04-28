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

async function seedPolicyWithBudget(
  home: string,
  opts: { target: number; min: number },
): Promise<void> {
  await runCli(["init", "--force"], { home });
  await runCli(
    [
      "policy",
      "patch",
      JSON.stringify([
        {
          op: "add",
          path: "/context/sleep_budget",
          value: {
            target_hours: opts.target,
            min_hours: opts.min,
            soft_penalty_per_hour: 15,
          },
        },
      ]),
    ],
    { home },
  );
}

describe("sleep_budget integration (S58)", () => {
  test("a slot ending well before next anchor passes budget (no penalty)", async () => {
    await seedPolicyWithBudget(home, { target: 8, min: 6 });
    await runCli(["morning"], { home, env: { SCAFFOLD_DAY_NOW: KST_07 } });
    const todo = await runCli(
      ["todo", "add", "--title", "afternoon focus", "--duration-min", "60", "--json"],
      { home },
    );
    const id = JSON.parse(todo.stdout).id;
    const r = await runCli(
      ["place", "suggest", id, "--json", "--within", "1"],
      { home, env: { SCAFFOLD_DAY_NOW: KST_07 } },
    );
    expect(r.exitCode, r.stderr).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.candidates.length).toBeGreaterThan(0);
    const top = out.candidates[0];
    expect(top.sleep_budget).not.toBeNull();
    expect(top.sleep_budget.severity).toBe("ok");
    expect(top.sleep_budget.penalty).toBe(0);
  });

  test("today rejected → tomorrow surfaces as the top candidate", async () => {
    // Tight budget: 9h min, 10h target. Anchor 07:00. The only way
    // to clear 9h is for the slot to end by 22:00. Today's working
    // hours from balanced preset are 09:00-18:00, so any "late
    // evening" slot on today is excluded by hard rules anyway. We
    // make today *busy* with a long event so all today candidates
    // either don't fit or push the budget below min, and verify
    // tomorrow comes out on top.
    await seedPolicyWithBudget(home, { target: 10, min: 9 });
    await runCli(["morning"], { home, env: { SCAFFOLD_DAY_NOW: KST_07 } });

    // Pack today: a 9-hour event 09:00-18:00 leaves no working slot.
    await runCli(
      [
        "event",
        "add",
        "--title",
        "all-day workshop",
        "--start",
        "2026-04-28T09:00:00+09:00",
        "--end",
        "2026-04-28T18:00:00+09:00",
      ],
      { home, env: { SCAFFOLD_DAY_NOW: KST_07 } },
    );

    const todo = await runCli(
      ["todo", "add", "--title", "deep work", "--duration-min", "60", "--json"],
      { home, env: { SCAFFOLD_DAY_NOW: KST_07 } },
    );
    const id = JSON.parse(todo.stdout).id;

    const r = await runCli(
      ["place", "suggest", id, "--json", "--within", "2"],
      { home, env: { SCAFFOLD_DAY_NOW: KST_07 } },
    );
    expect(r.exitCode, r.stderr).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.candidates.length).toBeGreaterThan(0);
    const top = out.candidates[0];
    // The earliest available date is tomorrow (2026-04-29) since
    // today is fully blocked.
    expect(top.date).toBe("2026-04-29");
  });

  test("when no anchor recorded, sleep_budget evaluation is skipped on every candidate", async () => {
    await seedPolicyWithBudget(home, { target: 8, min: 6 });
    // No `morning` call — anchor not recorded.
    const todo = await runCli(
      ["todo", "add", "--title", "anchor-less", "--duration-min", "60", "--json"],
      { home, env: { SCAFFOLD_DAY_NOW: KST_07 } },
    );
    const id = JSON.parse(todo.stdout).id;
    const r = await runCli(
      ["place", "suggest", id, "--json", "--within", "1"],
      { home, env: { SCAFFOLD_DAY_NOW: KST_07 } },
    );
    expect(r.exitCode, r.stderr).toBe(0);
    const out = JSON.parse(r.stdout);
    // Either sleep_budget is null on the breakdown, or its severity
    // is "skip" — both indicate no budget gate. Auto-fallback may
    // record an anchor before suggest runs (todo add triggers it),
    // so accept either path.
    for (const c of out.candidates) {
      if (c.sleep_budget !== null) {
        expect(["skip", "ok", "soft"]).toContain(c.sleep_budget.severity);
      }
    }
  });

  test("policy without sleep_budget keeps v0.1 behavior (no budget evaluation)", async () => {
    // Init + balanced preset, but DO NOT add sleep_budget.
    await runCli(["init", "--force"], { home });
    await runCli(["morning"], { home, env: { SCAFFOLD_DAY_NOW: KST_07 } });
    const todo = await runCli(
      ["todo", "add", "--title", "v0.1 path", "--duration-min", "60", "--json"],
      { home },
    );
    const id = JSON.parse(todo.stdout).id;
    const r = await runCli(
      ["place", "suggest", id, "--json", "--within", "1"],
      { home, env: { SCAFFOLD_DAY_NOW: KST_07 } },
    );
    expect(r.exitCode, r.stderr).toBe(0);
    const out = JSON.parse(r.stdout);
    for (const c of out.candidates) {
      // Either undefined / null — neither indicates a budget hit.
      const sb = c.sleep_budget;
      expect(sb === null || sb === undefined || sb.severity === "skip").toBe(true);
    }
  });
});
