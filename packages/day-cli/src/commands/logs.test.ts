import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { followTick } from "./logs";

let home: string;
let logSpy: string[];
let originalLog: typeof console.log;

beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), "scaffold-day-logs-follow-"));
  logSpy = [];
  originalLog = console.log;
  console.log = (...args: unknown[]) => {
    logSpy.push(args.map((a) => String(a)).join(" "));
  };
});
afterEach(async () => {
  console.log = originalLog;
  await rm(home, { recursive: true, force: true });
});

async function appendPlacement(monthDir: string, entry: Record<string, unknown>): Promise<void> {
  const dir = path.join(home, "logs", monthDir);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, "placements.jsonl");
  // Append-style write
  await writeFile(file, `${JSON.stringify(entry)}\n`, { flag: "a" });
}

const samplePlacement = (overrides: Partial<Record<string, unknown>> = {}) => ({
  schema_version: "0.1.0",
  at: "2026-05-08T10:00:00.000Z",
  action: "placed",
  placement_id: "plc_01abcdefghi100",
  todo_id: "todo_01abcdefghi100",
  date: "2026-05-08",
  start: "2026-05-08T10:00:00+09:00",
  end: "2026-05-08T11:00:00+09:00",
  by: "user",
  policy_hash: "0".repeat(64),
  reason: null,
  previous: null,
  ...overrides,
});

describe("followTick (logs --follow polling primitive)", () => {
  test("emits new entries past lastAt, then advances lastAt by +1ms", async () => {
    await appendPlacement("2026-05", samplePlacement({ at: "2026-05-08T10:00:00.000Z" }));
    const state = { lastAt: "2026-05-08T09:00:00.000Z" };
    await followTick(home, state, { json: true });
    expect(logSpy).toHaveLength(1);
    // lastAt should be max(at) + 1ms = 10:00:00.001Z
    expect(state.lastAt).toBe("2026-05-08T10:00:00.001Z");
  });

  test("does not re-emit entries on a second tick with no new data", async () => {
    await appendPlacement("2026-05", samplePlacement({ at: "2026-05-08T10:00:00.000Z" }));
    const state = { lastAt: "2026-05-08T09:00:00.000Z" };
    await followTick(home, state, { json: true });
    expect(logSpy).toHaveLength(1);
    await followTick(home, state, { json: true });
    expect(logSpy).toHaveLength(1); // unchanged
  });

  test("picks up new entries appended between ticks", async () => {
    await appendPlacement("2026-05", samplePlacement({ at: "2026-05-08T10:00:00.000Z" }));
    const state = { lastAt: "2026-05-08T09:00:00.000Z" };
    await followTick(home, state, { json: true });
    expect(logSpy).toHaveLength(1);

    await appendPlacement(
      "2026-05",
      samplePlacement({
        at: "2026-05-08T10:01:00.000Z",
        placement_id: "plc_01abcdefghi200",
      }),
    );
    await followTick(home, state, { json: true });
    expect(logSpy).toHaveLength(2);
    expect(logSpy[1]!).toContain("plc_01abcdefghi200");
  });

  test("kind filter narrows the emitted stream", async () => {
    await appendPlacement("2026-05", samplePlacement({ at: "2026-05-08T10:00:00.000Z" }));
    const state = { lastAt: "2026-05-08T09:00:00.000Z" };
    // No placements expected when filter is heartbeat-only.
    await followTick(home, state, { json: true, kinds: ["heartbeat"] });
    expect(logSpy).toHaveLength(0);
  });

  test("multiple entries at the same instant: lastAt bumps past them all", async () => {
    await appendPlacement(
      "2026-05",
      samplePlacement({
        at: "2026-05-08T10:00:00.000Z",
        placement_id: "plc_01abcdefghi300",
      }),
    );
    await appendPlacement(
      "2026-05",
      samplePlacement({
        at: "2026-05-08T10:00:00.000Z",
        placement_id: "plc_01abcdefghi400",
      }),
    );
    const state = { lastAt: "2026-05-08T09:00:00.000Z" };
    await followTick(home, state, { json: true });
    expect(logSpy).toHaveLength(2);
    expect(state.lastAt).toBe("2026-05-08T10:00:00.001Z");
    // Next tick must NOT re-emit the same instant.
    await followTick(home, state, { json: true });
    expect(logSpy).toHaveLength(2);
  });
});
