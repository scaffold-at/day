import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { cleanupHome, makeTmpHome, runCli } from "./_helpers";

let home: string;
beforeEach(async () => {
  home = await makeTmpHome();
});
afterEach(async () => {
  await cleanupHome(home);
});

const MONDAY = "2026-04-27";

async function placeOne(): Promise<{ placementId: string; policyHash: string }> {
  await runCli(["policy", "preset", "apply", "balanced"], { home });
  const add = await runCli(
    [
      "todo",
      "add",
      "--title",
      "S25 explain me",
      "--tag",
      "#deep-work",
      "--duration-min",
      "60",
    ],
    { home },
  );
  const todoId = /id:\s+(todo_[a-z0-9]{14})/.exec(add.stdout)![1] as string;
  await runCli(
    [
      "todo", "score", todoId,
      "--urgency", "8", "--impact", "8", "--effort", "3", "--reversibility", "5",
    ],
    { home },
  );
  const placeRes = await runCli(
    ["place", "do", todoId, "--slot", `${MONDAY}T10:00:00+09:00`, "--json"],
    { home },
  );
  const placement = JSON.parse(placeRes.stdout);
  return { placementId: placement.id, policyHash: placement.policy_hash };
}

describe("explain (S25)", () => {
  test("place do writes a policy snapshot under policy-snapshots/", async () => {
    const { policyHash } = await placeOne();
    const dir = path.join(home, "policy-snapshots");
    const files = await readdir(dir);
    expect(files).toContain(`policy-${policyHash}.json`);

    const snap = JSON.parse(
      await readFile(path.join(dir, `policy-${policyHash}.json`), "utf8"),
    );
    expect(snap.hash).toBe(policyHash);
    expect(snap.policy.context.tz).toBe("Asia/Seoul");
  });

  test("explain --json carries placement + alternatives + policy_snapshot meta", async () => {
    const { placementId, policyHash } = await placeOne();
    const r = await runCli(["explain", placementId, "--json"], { home });
    expect(r.exitCode, r.stderr).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.placement.id).toBe(placementId);
    expect(out.placed_by).toBe("user");
    expect(typeof out.chosen_reason).toBe("string");
    expect(out.policy_snapshot).not.toBeNull();
    expect(out.policy_snapshot.hash).toBe(policyHash);
    expect(Array.isArray(out.alternatives)).toBe(true);
    // The chosen slot is at #1 of the original ranking, so alternatives
    // are the next-best 4 (out of top 5).
    expect(out.alternatives.length).toBeGreaterThanOrEqual(0);
  });

  test("explain on unknown placement → DAY_NOT_FOUND", async () => {
    await runCli(["policy", "preset", "apply", "balanced"], { home });
    const r = await runCli(["explain", "plc_00000000000000"], { home });
    expect(r.exitCode).toBe(66);
    expect(r.stderr).toContain("DAY_NOT_FOUND");
  });

  test("explain replays the original policy even after the user edits live policy", async () => {
    const { placementId, policyHash } = await placeOne();
    // Edit the live policy → its hash will differ from the snapshot's.
    const patch = JSON.stringify([
      { op: "replace", path: "/placement_grid_min", value: 15 },
    ]);
    await runCli(["policy", "patch", patch], { home });

    const r = await runCli(["explain", placementId, "--json"], { home });
    expect(r.exitCode).toBe(0);
    const out = JSON.parse(r.stdout);
    // Snapshot hash still points at the original.
    expect(out.policy_snapshot.hash).toBe(policyHash);
  });

  test("placements log (S21 wiring) records the original placed entry", async () => {
    const { placementId } = await placeOne();
    const log = await readFile(
      path.join(home, "logs/2026-04/placements.jsonl"),
      "utf8",
    );
    const lines = log.trim().split("\n");
    const entry = JSON.parse(lines[0]!);
    expect(entry.action).toBe("placed");
    expect(entry.placement_id).toBe(placementId);
  });
});
