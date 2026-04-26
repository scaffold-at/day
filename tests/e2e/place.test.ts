import { afterEach, beforeEach, describe, expect, test } from "bun:test";
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
