import { describe, expect, test } from "bun:test";
import type { Day } from "./day";
import type { FixedEvent } from "./event";
import type { Placement } from "./placement";
import { computeFreeIntervalsMs, computeFreeSlots } from "./free-slots";

const TZ = "+09:00";
const at = (hhmm: string) => `2026-04-26T${hhmm}:00${TZ}`;
const ms = (hhmm: string) => Date.parse(at(hhmm));

const event = (start: string, end: string, idSuffix = "abcdefghi123"): FixedEvent => ({
  id: `evt_01${idSuffix}`,
  source: "manual",
  external_id: null,
  title: "x",
  start: at(start),
  end: at(end),
  all_day: false,
  location: null,
  notes: null,
  recurring: null,
  tags: [],
  synced_at: at("00:00"),
});

const placement = (start: string, end: string): Placement => ({
  id: "plc_01abcdefghi123",
  todo_id: "todo_01abcdefghi123",
  start: at(start),
  end: at(end),
  title: "p",
  tags: [],
  importance_score: 50,
  duration_min: Math.round((Date.parse(at(end)) - Date.parse(at(start))) / 60000),
  placed_by: "user",
  placed_at: at("00:00"),
  policy_hash: null,
  locked: false,
});

const emptyDay = (): Day => ({
  schema_version: "0.1.0",
  date: "2026-04-26",
  events: [],
  placements: [],
  conflicts_open: [],
});

describe("computeFreeIntervalsMs — pure", () => {
  test("empty busy → single window-spanning slot", () => {
    const slots = computeFreeIntervalsMs(ms("09:00"), ms("18:00"), [], { gridMin: 30 });
    expect(slots).toEqual([{ start: ms("09:00"), end: ms("18:00") }]);
  });

  test("single meeting splits the window into two slots", () => {
    const slots = computeFreeIntervalsMs(
      ms("09:00"),
      ms("18:00"),
      [{ start: ms("10:00"), end: ms("11:00") }],
      { gridMin: 30 },
    );
    expect(slots).toEqual([
      { start: ms("09:00"), end: ms("10:00") },
      { start: ms("11:00"), end: ms("18:00") },
    ]);
  });

  test("buffer eats small gap and snaps to grid", () => {
    const slots = computeFreeIntervalsMs(
      ms("09:00"),
      ms("18:00"),
      [{ start: ms("10:00"), end: ms("11:00") }],
      { gridMin: 30, bufferMin: 10 },
    );
    expect(slots).toEqual([
      { start: ms("09:00"), end: ms("09:30") },
      { start: ms("11:30"), end: ms("18:00") },
    ]);
  });

  test("non-aligned meeting forces start/end to grid", () => {
    const slots = computeFreeIntervalsMs(
      ms("09:00"),
      ms("18:00"),
      [{ start: ms("09:15"), end: ms("09:45") }],
      { gridMin: 30 },
    );
    // Pre-meeting interval (09:00-09:15) is shorter than 30 min → dropped.
    // Post-meeting interval (09:45-18:00) has start snapped UP to 10:00.
    expect(slots).toEqual([{ start: ms("10:00"), end: ms("18:00") }]);
  });

  test("overlapping busy intervals merge", () => {
    const slots = computeFreeIntervalsMs(
      ms("09:00"),
      ms("18:00"),
      [
        { start: ms("10:00"), end: ms("11:30") },
        { start: ms("11:00"), end: ms("12:00") },
      ],
      { gridMin: 30 },
    );
    expect(slots).toEqual([
      { start: ms("09:00"), end: ms("10:00") },
      { start: ms("12:00"), end: ms("18:00") },
    ]);
  });

  test("busy fully covers window → no slots", () => {
    const slots = computeFreeIntervalsMs(
      ms("09:00"),
      ms("18:00"),
      [{ start: ms("08:00"), end: ms("19:00") }],
      { gridMin: 30 },
    );
    expect(slots).toEqual([]);
  });

  test("inverted window → no slots", () => {
    const slots = computeFreeIntervalsMs(
      ms("18:00"),
      ms("09:00"),
      [],
      { gridMin: 30 },
    );
    expect(slots).toEqual([]);
  });
});

describe("computeFreeSlots — Day-level glue (3 acceptance scenarios)", () => {
  test("scenario 1 — meeting + protected lunch", () => {
    const day = emptyDay();
    day.events.push(event("10:00", "11:00", "00abcdefghi100"));
    const slots = computeFreeSlots(day, {
      windowStart: at("09:00"),
      windowEnd: at("18:00"),
      protectedRanges: [{ start: at("12:00"), end: at("13:00"), label: "lunch" }],
      gridMin: 30,
    });
    expect(slots.map((s) => `${s.start}→${s.end}`)).toEqual([
      `${new Date(ms("09:00")).toISOString()}→${new Date(ms("10:00")).toISOString()}`,
      `${new Date(ms("11:00")).toISOString()}→${new Date(ms("12:00")).toISOString()}`,
      `${new Date(ms("13:00")).toISOString()}→${new Date(ms("18:00")).toISOString()}`,
    ]);
    expect(slots[0]?.duration_min).toBe(60);
    expect(slots[2]?.duration_min).toBe(60 * 5);
  });

  test("scenario 2 — meeting + existing placement + buffer", () => {
    const day = emptyDay();
    day.events.push(event("10:00", "11:00", "00abcdefghi200"));
    day.placements.push(placement("14:00", "15:30"));
    const slots = computeFreeSlots(day, {
      windowStart: at("09:00"),
      windowEnd: at("18:00"),
      gridMin: 30,
      bufferMin: 10,
    });
    expect(slots.map((s) => s.duration_min)).toEqual([
      30, // 09:00-09:30 (buffered to 09:50 before meeting → snapped end to 09:30)
      120, // 11:10-13:50 (buffered around) → snapped to 11:30-13:30
      120, // 15:40-18:00 (after placement+buffer) → snapped start UP to 16:00
    ]);
  });

  test("scenario 3 — empty day yields the whole window", () => {
    const day = emptyDay();
    const slots = computeFreeSlots(day, {
      windowStart: at("09:00"),
      windowEnd: at("18:00"),
      gridMin: 30,
    });
    expect(slots).toEqual([
      {
        start: new Date(ms("09:00")).toISOString(),
        end: new Date(ms("18:00")).toISOString(),
        duration_min: 60 * 9,
      },
    ]);
  });
});
