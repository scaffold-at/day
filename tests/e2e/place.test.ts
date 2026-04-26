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

async function setup(): Promise<string> {
  await runCli(["policy", "preset", "apply", "balanced"], { home });
  const add = await runCli(
    [
      "todo",
      "add",
      "--title",
      "Write S20",
      "--tag",
      "#deep-work",
      "--duration-min",
      "60",
    ],
    { home },
  );
  expect(add.exitCode).toBe(0);
  const id = /id:\s+(todo_[a-z0-9]{14})/.exec(add.stdout)![1] as string;
  await runCli(
    [
      "todo",
      "score",
      id,
      "--urgency",
      "8",
      "--impact",
      "8",
      "--effort",
      "3",
      "--reversibility",
      "5",
    ],
    { home },
  );
  return id;
}

describe("place suggest", () => {
  test("ranked candidates over a weekday window with breakdown", async () => {
    const id = await setup();
    const r = await runCli(
      [
        "place",
        "suggest",
        id,
        "--date",
        MONDAY,
        "--within",
        "1",
        "--max",
        "5",
        "--json",
      ],
      { home },
    );
    expect(r.exitCode, r.stderr).toBe(0);
    const sug = JSON.parse(r.stdout);
    expect(sug.todo_id).toBe(id);
    expect(sug.duration_min).toBe(60);
    expect(sug.candidates.length).toBeGreaterThan(0);
    expect(sug.candidates.length).toBeLessThanOrEqual(5);
    expect(sug.no_fit_reason).toBeNull();
    // ranks are 1..N
    expect(sug.candidates.map((c: { rank: number }) => c.rank)).toEqual(
      sug.candidates.map((_: unknown, i: number) => i + 1),
    );
    // breakdown present
    const top = sug.candidates[0];
    expect(typeof top.score).toBe("number");
    expect(typeof top.importance).toBe("number");
    expect(typeof top.soft_total).toBe("number");
    expect(Array.isArray(top.contributions)).toBe(true);
  });

  test("packed weekday yields no candidates with a no_fit_reason", async () => {
    const id = await setup();
    // Block the entire working window with one big event.
    await runCli(
      [
        "event",
        "add",
        "--title",
        "all-day workshop",
        "--start",
        `${MONDAY}T09:00:00+09:00`,
        "--end",
        `${MONDAY}T18:00:00+09:00`,
      ],
      { home },
    );
    const r = await runCli(
      ["place", "suggest", id, "--date", MONDAY, "--within", "1", "--json"],
      { home },
    );
    expect(r.exitCode).toBe(0);
    const sug = JSON.parse(r.stdout);
    expect(sug.candidates).toHaveLength(0);
    expect(sug.no_fit_reason).not.toBeNull();
    expect(typeof sug.no_fit_reason).toBe("string");
  });

  test("weekend day produces no candidates (no working hours)", async () => {
    const id = await setup();
    const r = await runCli(
      ["place", "suggest", id, "--date", "2026-04-25", "--within", "1", "--json"], // Saturday
      { home },
    );
    expect(r.exitCode).toBe(0);
    const sug = JSON.parse(r.stdout);
    expect(sug.candidates).toHaveLength(0);
    expect(sug.no_fit_reason).toContain("no working hours");
  });

  test("suggest before policy preset apply → DAY_NOT_INITIALIZED", async () => {
    const add = await runCli(
      ["todo", "add", "--title", "x", "--duration-min", "60"],
      { home },
    );
    const id = /id:\s+(todo_[a-z0-9]{14})/.exec(add.stdout)![1] as string;
    const r = await runCli(["place", "suggest", id], { home });
    expect(r.exitCode).toBe(78);
    expect(r.stderr).toContain("DAY_NOT_INITIALIZED");
  });

  test("suggest on unknown todo → DAY_NOT_FOUND", async () => {
    await runCli(["policy", "preset", "apply", "balanced"], { home });
    const r = await runCli(["place", "suggest", "todo_00000000000000"], { home });
    expect(r.exitCode).toBe(66);
    expect(r.stderr).toContain("DAY_NOT_FOUND");
  });

  test("todo without duration_min → DAY_INVALID_INPUT", async () => {
    await runCli(["policy", "preset", "apply", "balanced"], { home });
    const add = await runCli(["todo", "add", "--title", "no-duration"], { home });
    const id = /id:\s+(todo_[a-z0-9]{14})/.exec(add.stdout)![1] as string;
    const r = await runCli(["place", "suggest", id], { home });
    expect(r.exitCode).toBe(65);
    expect(r.stderr).toContain("DAY_INVALID_INPUT");
    expect(r.stderr).toContain("duration_min");
  });

  test("--max caps the candidate list", async () => {
    const id = await setup();
    const r = await runCli(
      ["place", "suggest", id, "--date", MONDAY, "--within", "1", "--max", "2", "--json"],
      { home },
    );
    const sug = JSON.parse(r.stdout);
    expect(sug.candidates.length).toBeLessThanOrEqual(2);
  });

  test("human output renders rank lines + score", async () => {
    const id = await setup();
    const r = await runCli(
      ["place", "suggest", id, "--date", MONDAY, "--within", "1", "--max", "3"],
      { home },
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("place suggest");
    expect(r.stdout).toMatch(/\[1\] \d{4}-\d{2}-\d{2}/);
    expect(r.stdout).toMatch(/score:\s+\d+\.\d+/);
  });
});

describe("place do (S21)", () => {
  test("commits a placement with inline snapshot + writes a log entry first", async () => {
    const id = await setup();
    const r = await runCli(
      [
        "place",
        "do",
        id,
        "--slot",
        `${MONDAY}T10:00:00+09:00`,
        "--lock",
        "--json",
      ],
      { home },
    );
    expect(r.exitCode, r.stderr).toBe(0);
    const placement = JSON.parse(r.stdout);
    expect(placement.id).toMatch(/^plc_[a-z0-9]{14}$/);
    expect(placement.todo_id).toBe(id);
    expect(placement.title).toBe("Write S20");
    expect(placement.tags).toContain("#deep-work");
    expect(placement.duration_min).toBe(60);
    expect(placement.locked).toBe(true);
    expect(placement.policy_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(placement.importance_at_placement).not.toBeNull();
    expect(placement.importance_at_placement.score).toBeGreaterThan(0);

    // Day file was updated.
    const day = JSON.parse(
      await readFile(path.join(home, "days/2026-04/2026-04-27.json"), "utf8"),
    );
    expect(day.placements).toHaveLength(1);
    expect(day.placements[0].id).toBe(placement.id);

    // Placement log was appended (before the day file, by spec).
    const log = await readFile(
      path.join(home, "logs/2026-04/placements.jsonl"),
      "utf8",
    );
    const lines = log.trim().split("\n");
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]!);
    expect(entry.action).toBe("placed");
    expect(entry.placement_id).toBe(placement.id);
    expect(entry.todo_id).toBe(id);
    expect(entry.policy_hash).toBe(placement.policy_hash);
  });

  test("inline snapshot freezes title at placement time (later todo update doesn't change it)", async () => {
    const id = await setup();
    await runCli(
      ["place", "do", id, "--slot", `${MONDAY}T10:00:00+09:00`],
      { home },
    );

    await runCli(
      ["todo", "update", id, "--title", "renamed after placement"],
      { home },
    );

    const day = JSON.parse(
      await readFile(path.join(home, "days/2026-04/2026-04-27.json"), "utf8"),
    );
    expect(day.placements[0].title).toBe("Write S20"); // frozen
  });

  test("slot violating a hard rule → DAY_INVALID_INPUT (no placement, no log)", async () => {
    const id = await setup();
    // Schedule into the no_placement_in (22:00-07:00) range.
    const r = await runCli(
      ["place", "do", id, "--slot", `${MONDAY}T23:00:00+09:00`],
      { home },
    );
    expect(r.exitCode).toBe(65);
    expect(r.stderr).toContain("DAY_INVALID_INPUT");
    expect(r.stderr).toContain("no_placement_in");

    // No log entry, no day file mutation.
    let logExists = false;
    try {
      await readFile(path.join(home, "logs/2026-04/placements.jsonl"), "utf8");
      logExists = true;
    } catch {}
    expect(logExists).toBe(false);
  });

  test("slot overlapping an existing event → DAY_INVALID_INPUT", async () => {
    const id = await setup();
    await runCli(
      [
        "event",
        "add",
        "--title",
        "block",
        "--start",
        `${MONDAY}T10:00:00+09:00`,
        "--end",
        `${MONDAY}T11:00:00+09:00`,
      ],
      { home },
    );
    const r = await runCli(
      ["place", "do", id, "--slot", `${MONDAY}T10:30:00+09:00`],
      { home },
    );
    expect(r.exitCode).toBe(65);
    expect(r.stderr).toContain("DAY_INVALID_INPUT");
  });

  test("place do without --slot → DAY_USAGE", async () => {
    const id = await setup();
    const r = await runCli(["place", "do", id], { home });
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("DAY_USAGE");
    expect(r.stderr).toContain("--slot");
  });

  test("override moves a placement same-day and logs before/after", async () => {
    const id = await setup();
    const placeRes = await runCli(
      ["place", "do", id, "--slot", `${MONDAY}T10:00:00+09:00`, "--json"],
      { home },
    );
    const placement = JSON.parse(placeRes.stdout);

    const ovr = await runCli(
      [
        "place",
        "override",
        placement.id,
        "--new-slot",
        `${MONDAY}T15:00:00+09:00`,
        "--reason",
        "moved to afternoon",
        "--json",
      ],
      { home },
    );
    expect(ovr.exitCode, ovr.stderr).toBe(0);
    const result = JSON.parse(ovr.stdout);
    expect(result.placement.start).toBe(`${MONDAY}T15:00:00+09:00`);
    expect(result.previous.start).toBe(`${MONDAY}T10:00:00+09:00`);
    expect(result.reason).toBe("moved to afternoon");

    const day = JSON.parse(
      await readFile(path.join(home, "days/2026-04/2026-04-27.json"), "utf8"),
    );
    expect(day.placements).toHaveLength(1);
    expect(day.placements[0].start).toBe(`${MONDAY}T15:00:00+09:00`);

    const log = await readFile(
      path.join(home, "logs/2026-04/placements.jsonl"),
      "utf8",
    );
    const lines = log.trim().split("\n");
    const overrideEntry = JSON.parse(lines[lines.length - 1]!);
    expect(overrideEntry.action).toBe("overridden");
    expect(overrideEntry.previous.start).toBe(`${MONDAY}T10:00:00+09:00`);
    expect(overrideEntry.start).toBe(`${MONDAY}T15:00:00+09:00`);
    expect(overrideEntry.reason).toBe("moved to afternoon");
  });

  test("override on unknown placement → DAY_NOT_FOUND", async () => {
    await runCli(["policy", "preset", "apply", "balanced"], { home });
    const r = await runCli(
      [
        "place",
        "override",
        "plc_00000000000000",
        "--new-slot",
        `${MONDAY}T10:00:00+09:00`,
      ],
      { home },
    );
    expect(r.exitCode).toBe(66);
    expect(r.stderr).toContain("DAY_NOT_FOUND");
  });

  test("override into an overlapping slot → DAY_INVALID_INPUT", async () => {
    const id = await setup();
    await runCli(
      ["place", "do", id, "--slot", `${MONDAY}T10:00:00+09:00`],
      { home },
    );
    // Create a blocker event at 14:00.
    await runCli(
      [
        "event",
        "add",
        "--title",
        "blocker",
        "--start",
        `${MONDAY}T14:00:00+09:00`,
        "--end",
        `${MONDAY}T15:00:00+09:00`,
      ],
      { home },
    );
    // Get the placement id.
    const day = JSON.parse(
      await readFile(path.join(home, "days/2026-04/2026-04-27.json"), "utf8"),
    );
    const placementId = day.placements[0].id;
    const r = await runCli(
      [
        "place",
        "override",
        placementId,
        "--new-slot",
        `${MONDAY}T14:00:00+09:00`,
      ],
      { home },
    );
    expect(r.exitCode).toBe(65);
    expect(r.stderr).toContain("DAY_INVALID_INPUT");
  });

  test("two placements same day appear in the day file's placements[]", async () => {
    const id = await setup();
    await runCli(
      ["place", "do", id, "--slot", `${MONDAY}T10:00:00+09:00`],
      { home },
    );
    // second todo
    const second = await runCli(
      [
        "todo", "add", "--title", "Second", "--duration-min", "30",
      ],
      { home },
    );
    const id2 = /id:\s+(todo_[a-z0-9]{14})/.exec(second.stdout)![1] as string;
    await runCli(
      ["todo", "score", id2, "--urgency", "5", "--impact", "5", "--effort", "5", "--reversibility", "5"],
      { home },
    );
    await runCli(
      ["place", "do", id2, "--slot", `${MONDAY}T14:00:00+09:00`],
      { home },
    );

    const day = JSON.parse(
      await readFile(path.join(home, "days/2026-04/2026-04-27.json"), "utf8"),
    );
    expect(day.placements).toHaveLength(2);
  });
});
