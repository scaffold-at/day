import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
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

async function setupAndPlace(): Promise<string> {
  await runCli(["policy", "preset", "apply", "balanced"], { home });
  const add = await runCli(
    [
      "todo", "add",
      "--title", "S39 me",
      "--tag", "#deep-work",
      "--duration-min", "60",
    ],
    { home },
  );
  const id = /id:\s+(todo_[a-z0-9]{14})/.exec(add.stdout)![1] as string;
  await runCli(
    ["todo", "score", id, "--urgency", "8", "--impact", "8", "--effort", "3", "--reversibility", "5"],
    { home },
  );
  // Place at 10:00.
  await runCli(["place", "do", id, "--slot", `${MONDAY}T10:00:00+09:00`], { home });
  return id;
}

describe("day replan (S39)", () => {
  test("AI placement collides with new event → replan moves it", async () => {
    await setupAndPlace();
    // The placement was created via --by user (default), so flexible_only
    // would skip it. Mutate the day file to flip placed_by → "ai" so
    // replan considers it movable.
    const dayPath = path.join(home, "days/2026-04/2026-04-27.json");
    const day = JSON.parse(await readFile(dayPath, "utf8"));
    day.placements[0].placed_by = "ai";
    await writeFile(dayPath, `${JSON.stringify(day, null, 2)}\n`, "utf8");
    // Now add a colliding event at 10:00.
    await runCli(
      [
        "event", "add",
        "--title", "new meeting",
        "--start", `${MONDAY}T10:00:00+09:00`,
        "--end", `${MONDAY}T11:00:00+09:00`,
      ],
      { home },
    );
    const r = await runCli(["day", "replan", MONDAY, "--json"], { home });
    expect(r.exitCode, r.stderr).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.moved).toBe(1);
    expect(out.dropped).toBe(0);
    // New start differs from the original 10:00 slot.
    expect(out.moves[0].next.start).not.toBe(`${MONDAY}T10:00:00+09:00`);
  });

  test("locked placements are NEVER moved (all_unlocked scope respects locked)", async () => {
    await setupAndPlace();
    // Lock + flip to AI so replan would otherwise touch it.
    const dayPath = path.join(home, "days/2026-04/2026-04-27.json");
    const day = JSON.parse(await readFile(dayPath, "utf8"));
    day.placements[0].locked = true;
    day.placements[0].placed_by = "ai";
    await writeFile(dayPath, `${JSON.stringify(day, null, 2)}\n`, "utf8");
    // Add a colliding event.
    await runCli(
      [
        "event", "add",
        "--title", "collide",
        "--start", `${MONDAY}T10:00:00+09:00`,
        "--end", `${MONDAY}T11:00:00+09:00`,
      ],
      { home },
    );
    const r = await runCli(
      ["day", "replan", MONDAY, "--scope", "all_unlocked", "--json"],
      { home },
    );
    expect(r.exitCode).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.kept).toBe(1);
    expect(out.moved).toBe(0);
  });

  test("placement that no longer fits ends up in dropped + emits a conflict", async () => {
    await setupAndPlace();
    // Flip to AI.
    const dayPath = path.join(home, "days/2026-04/2026-04-27.json");
    const day = JSON.parse(await readFile(dayPath, "utf8"));
    day.placements[0].placed_by = "ai";
    await writeFile(dayPath, `${JSON.stringify(day, null, 2)}\n`, "utf8");
    // Block out the entire working window.
    await runCli(
      [
        "event", "add",
        "--title", "all-day",
        "--start", `${MONDAY}T09:00:00+09:00`,
        "--end", `${MONDAY}T18:00:00+09:00`,
      ],
      { home },
    );
    const r = await runCli(["day", "replan", MONDAY, "--json"], { home });
    expect(r.exitCode).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.dropped).toBe(1);
    expect(out.dropped_ids).toHaveLength(1);

    // A conflict was synced to the partition.
    const partition = JSON.parse(
      await readFile(path.join(home, "conflicts/2026-04.json"), "utf8"),
    );
    expect(partition.conflicts.length).toBeGreaterThanOrEqual(1);
  });

  test("replan before policy preset apply → DAY_NOT_INITIALIZED", async () => {
    const r = await runCli(["day", "replan", MONDAY], { home });
    expect(r.exitCode).toBe(78);
    expect(r.stderr).toContain("DAY_NOT_INITIALIZED");
  });

  test("bad date → DAY_INVALID_INPUT", async () => {
    await runCli(["policy", "preset", "apply", "balanced"], { home });
    const r = await runCli(["day", "replan", "tomorrow"], { home });
    expect(r.exitCode).toBe(65);
    expect(r.stderr).toContain("DAY_INVALID_INPUT");
  });
});
