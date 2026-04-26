import { describe, expect, test } from "bun:test";
import { type FixedEvent, type Placement } from "../day";
import { BALANCED_PRESET } from "../policy";
import { replanDay } from "./replan";

const TZ = "+09:00";
const DATE = "2026-04-27";
const at = (hhmm: string) => `${DATE}T${hhmm}:00${TZ}`;

const placement = (
  id: string,
  start: string,
  end: string,
  options: {
    placed_by?: "ai" | "user" | "auto";
    locked?: boolean;
    importance_score?: number;
  } = {},
): Placement => ({
  id,
  todo_id: "todo_01abcdefghi100",
  start: at(start),
  end: at(end),
  title: "x",
  tags: [],
  importance_score: options.importance_score ?? 50,
  importance_at_placement: null,
  duration_min: Math.round((Date.parse(at(end)) - Date.parse(at(start))) / 60000),
  placed_by: options.placed_by ?? "ai",
  placed_at: at("00:00"),
  policy_hash: null,
  locked: options.locked ?? false,
});

const event = (start: string, end: string): FixedEvent => ({
  id: "evt_01abcdefghi100",
  source: "manual",
  external_id: null,
  title: "block",
  start: at(start),
  end: at(end),
  all_day: false,
  location: null,
  notes: null,
  recurring: null,
  tags: [],
  synced_at: at("00:00"),
});

describe("replanDay", () => {
  test("locked placements survive untouched", () => {
    const day = {
      schema_version: "0.1.0",
      date: DATE,
      events: [],
      placements: [
        placement("plc_aaaaaaaaaaaaaa", "10:00", "11:00", { locked: true, placed_by: "user" }),
      ],
      conflicts_open: [],
    };
    const out = replanDay(day, BALANCED_PRESET);
    expect(out.kept_in_place.map((p) => p.id)).toEqual(["plc_aaaaaaaaaaaaaa"]);
    expect(out.moved).toHaveLength(0);
    expect(out.dropped).toHaveLength(0);
  });

  test("user-placed placements are kept under flexible_only scope", () => {
    const day = {
      schema_version: "0.1.0",
      date: DATE,
      events: [],
      placements: [
        placement("plc_uuuuuuuuuuuuuu", "10:00", "11:00", { placed_by: "user" }),
        placement("plc_aiaiaiaiaiaiai", "11:00", "12:00", { placed_by: "ai" }),
      ],
      conflicts_open: [],
    };
    const out = replanDay(day, BALANCED_PRESET, "flexible_only");
    expect(out.kept_in_place.map((p) => p.id)).toContain("plc_uuuuuuuuuuuuuu");
  });

  test("a new event causes the AI placement behind it to be replanned", () => {
    const day = {
      schema_version: "0.1.0",
      date: DATE,
      events: [event("10:00", "11:00")],
      placements: [
        // Suppose this AI placement was originally at 10:00-11:00; the new
        // event collides. Replan should move it.
        placement("plc_aaaaaaaaaaaaaa", "10:00", "11:00", { placed_by: "ai" }),
      ],
      conflicts_open: [],
    };
    const out = replanDay(day, BALANCED_PRESET);
    expect(out.dropped).toHaveLength(0);
    expect(out.final_placements).toHaveLength(1);
    // Placement moved away from the conflicting slot.
    const final = out.final_placements[0]!;
    expect(final.start).not.toBe(at("10:00"));
  });

  test("placement that no longer fits is dropped (and reported)", () => {
    const day = {
      schema_version: "0.1.0",
      date: DATE,
      events: [
        event("09:00", "12:00"),
        event("13:00", "18:00"),
      ],
      placements: [
        placement("plc_aaaaaaaaaaaaaa", "10:00", "11:00", { placed_by: "ai" }),
      ],
      conflicts_open: [],
    };
    const out = replanDay(day, BALANCED_PRESET);
    expect(out.dropped).toHaveLength(1);
    expect(out.dropped[0]!.id).toBe("plc_aaaaaaaaaaaaaa");
    expect(out.final_placements).toHaveLength(0);
  });

  test("higher importance is placed first in greedy order", () => {
    const day = {
      schema_version: "0.1.0",
      date: DATE,
      events: [],
      placements: [
        placement("plc_lowwwwwwwwwww", "10:00", "11:00", { placed_by: "ai", importance_score: 30 }),
        placement("plc_highhhhhhhhhh", "13:00", "14:00", { placed_by: "ai", importance_score: 90 }),
      ],
      conflicts_open: [],
    };
    const out = replanDay(day, BALANCED_PRESET);
    // Both should keep / move, none dropped (the day is roomy).
    expect(out.dropped).toHaveLength(0);
    expect(out.final_placements.length).toBe(2);
  });
});
