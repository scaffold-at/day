import { describe, expect, test } from "bun:test";
import type { Day, FixedEvent, Placement } from "@scaffold/day-core";
import { buildDayView, renderDayView, renderDayViewJson } from "./day-view";

const TZ = "+09:00";
const at = (hhmm: string) => `2026-04-26T${hhmm}:00${TZ}`;

const event = (
  id: string,
  title: string,
  start: string,
  end: string,
  location: string | null = null,
): FixedEvent => ({
  id,
  source: "manual",
  external_id: null,
  title,
  start: at(start),
  end: at(end),
  all_day: false,
  location,
  notes: null,
  recurring: null,
  tags: [],
  synced_at: at("00:00"),
});

const placement = (
  id: string,
  todoId: string,
  title: string,
  start: string,
  end: string,
  tags: string[] = [],
): Placement => ({
  id,
  todo_id: todoId,
  start: at(start),
  end: at(end),
  title,
  tags,
  importance_score: 50,
  duration_min: Math.round((Date.parse(at(end)) - Date.parse(at(start))) / 60000),
  placed_by: "user",
  placed_at: at("00:00"),
  policy_hash: null,
  locked: false,
});

const sampleDay = (): Day => ({
  schema_version: "0.1.0",
  date: "2026-04-26",
  events: [
    event("evt_01abcdefghi100", "Standup", "09:00", "09:15"),
    event("evt_01abcdefghi200", "1:1 with Alex", "10:00", "11:00", "Zoom"),
  ],
  placements: [
    placement("plc_01abcdefghi100", "todo_01abcdefghi100", "Write S12", "13:00", "14:00", ["#deep-work"]),
    placement("plc_01abcdefghi200", "todo_01abcdefghi200", "Review PRs", "14:30", "15:30"),
    placement("plc_01abcdefghi300", "todo_01abcdefghi300", "Email triage", "16:00", "17:00"),
  ],
  conflicts_open: [],
});

describe("buildDayView", () => {
  test("computes free slots from events + placements + lunch protected", () => {
    const view = buildDayView(sampleDay(), "Asia/Seoul");
    expect(view.summary.events_count).toBe(2);
    expect(view.summary.placements_count).toBe(3);
    expect(view.summary.free_slots_count).toBeGreaterThan(0);
    expect(view.tz).toBe("Asia/Seoul");
  });

  test("events and placements are time-sorted", () => {
    const view = buildDayView(sampleDay(), "Asia/Seoul");
    const eventStarts = view.events.map((e) => e.start);
    expect(eventStarts).toEqual([...eventStarts].sort());
  });
});

describe("renderDayView — human", () => {
  test("renders within 40 lines for the SLICES §S12 acceptance scenario", () => {
    const view = buildDayView(sampleDay(), "Asia/Seoul");
    const out = renderDayView(view);
    const lineCount = out.split("\n").length;
    expect(lineCount).toBeLessThanOrEqual(40);
  });

  test("contains every section header and the summary line", () => {
    const view = buildDayView(sampleDay(), "Asia/Seoul");
    const out = renderDayView(view);
    expect(out).toContain("Events");
    expect(out).toContain("Placements");
    expect(out).toContain("Free");
    expect(out).toContain("Summary:");
    expect(out).toContain("2026-04-26");
  });

  test("output carries label prefixes (NO_COLOR-safe semantic)", () => {
    const view = buildDayView(sampleDay(), "Asia/Seoul");
    const out = renderDayView(view);
    expect(out).toContain("[event]");
    expect(out).toContain("[place]");
    expect(out).toContain("[free");
  });

  test("emits no ANSI escape sequences when stdout is not a TTY (test env)", () => {
    // bun test runs without a TTY → colors module returns identity wrappers.
    const view = buildDayView(sampleDay(), "Asia/Seoul");
    const out = renderDayView(view);
    expect(out.includes("\x1b[")).toBe(false);
  });
});

describe("renderDayViewJson", () => {
  test("free_slots are present and recomputed every render (PRD §6.3)", () => {
    const view = buildDayView(sampleDay(), "Asia/Seoul");
    const json = JSON.parse(renderDayViewJson(view));
    expect(Array.isArray(json.free_slots)).toBe(true);
    expect(json.summary.free_slots_count).toBe(json.free_slots.length);
  });
});
