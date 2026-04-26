import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
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

async function setupTodoAndScore(title: string): Promise<string> {
  const add = await runCli(
    [
      "todo", "add",
      "--title", title,
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
  return id;
}

async function seedPolicy(): Promise<void> {
  const r = await runCli(["policy", "preset", "apply", "balanced"], { home });
  expect(r.exitCode).toBe(0);
}

describe("conflict detect / list / resolve", () => {
  test("conflict list on empty home prints a friendly note", async () => {
    await seedPolicy();
    const r = await runCli(["conflict", "list"], { home });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("no conflicts match");
  });

  test("manually colliding placements detected on `conflict detect`", async () => {
    await seedPolicy();
    const a = await setupTodoAndScore("A");
    const b = await setupTodoAndScore("B");
    // Place both at 10:00.
    await runCli(["place", "do", a, "--slot", `${MONDAY}T10:00:00+09:00`], { home });

    // Place B at 10:30 — overlaps A. `place do` itself blocks via overlap
    // check, so we sidestep it by directly editing the day file… or just
    // place B at 11:30 (no overlap), then manually shift A via override
    // to overlap. Easier: use `place override` to move B onto A.
    await runCli(["place", "do", b, "--slot", `${MONDAY}T11:30:00+09:00`], { home });

    const dayPath = path.join(home, "days/2026-04/2026-04-27.json");
    // Manually edit the day file to create overlap.
    const day = JSON.parse(await readFile(dayPath, "utf8"));
    // Shift the first placement to overlap the second.
    day.placements[1].start = `${MONDAY}T10:30:00+09:00`;
    day.placements[1].end = `${MONDAY}T11:30:00+09:00`;
    const { writeFile } = await import("node:fs/promises");
    await writeFile(dayPath, `${JSON.stringify(day, null, 2)}\n`, "utf8");

    const det = await runCli(["conflict", "detect", MONDAY, "--json"], { home });
    expect(det.exitCode, det.stderr).toBe(0);
    const detJson = JSON.parse(det.stdout);
    expect(detJson.open).toBeGreaterThanOrEqual(1);

    // List should now show the conflict.
    const list = await runCli(["conflict", "list", "--json"], { home });
    const items = JSON.parse(list.stdout).items;
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items[0].kind).toBe("overlap");

    // Resolve as ignored.
    const conflictId = items[0].id;
    const res = await runCli(
      ["conflict", "resolve", conflictId, "--status", "ignored", "--reason", "fine for now"],
      { home },
    );
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("ignored");

    // Conflict log was appended.
    const log = await readFile(path.join(home, "logs/2026-04/conflicts.jsonl"), "utf8");
    const lines = log.trim().split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(2); // detected + ignored
    const lastEntry = JSON.parse(lines[lines.length - 1]!);
    expect(lastEntry.action).toBe("ignored");
    expect(lastEntry.conflict_id).toBe(conflictId);

    // List with default --status open should now be empty.
    const listOpen = await runCli(["conflict", "list", "--json"], { home });
    const openItems = JSON.parse(listOpen.stdout).items;
    expect(openItems).toHaveLength(0);

    // List --status all should still find it.
    const listAll = await runCli(["conflict", "list", "--status", "all", "--json"], { home });
    const all = JSON.parse(listAll.stdout).items;
    expect(all.length).toBeGreaterThanOrEqual(1);
    expect(all[0].status).toBe("ignored");
  });

  test("resolve unknown id → DAY_NOT_FOUND", async () => {
    await seedPolicy();
    const r = await runCli(
      ["conflict", "resolve", "cfl_00000000000000", "--status", "ignored"],
      { home },
    );
    expect(r.exitCode).toBe(66);
    expect(r.stderr).toContain("DAY_NOT_FOUND");
  });

  test("detect before policy preset apply → DAY_NOT_INITIALIZED", async () => {
    const r = await runCli(["conflict", "detect", MONDAY], { home });
    expect(r.exitCode).toBe(78);
    expect(r.stderr).toContain("DAY_NOT_INITIALIZED");
  });

  test("resolve --status with bad value → DAY_USAGE", async () => {
    await seedPolicy();
    const r = await runCli(
      ["conflict", "resolve", "cfl_00000000000000", "--status", "wild"],
      { home },
    );
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("DAY_USAGE");
  });
});
