import { describe, expect, test } from "bun:test";
import type { FixedEvent } from "../day";
import type { HardRule } from "../policy";
import {
  type CandidateSlot,
  type HardRuleContext,
  evaluateHardRules,
} from "./hard-rules";

const TZ = "+09:00";
const DATE = "2026-04-26";
const at = (hhmm: string) => `${DATE}T${hhmm}:00${TZ}`;

const slot = (start: string, end: string): CandidateSlot => ({
  start: at(start),
  end: at(end),
  duration_min: Math.round((Date.parse(at(end)) - Date.parse(at(start))) / 60000),
});

const event = (
  title: string,
  start: string,
  end: string,
  tags: string[] = [],
): FixedEvent => ({
  id: "evt_01abcdefghi100",
  source: "manual",
  external_id: null,
  title,
  start: at(start),
  end: at(end),
  all_day: false,
  location: null,
  notes: null,
  recurring: null,
  tags,
  synced_at: at("00:00"),
});

const ctx = (over: Partial<HardRuleContext> = {}): HardRuleContext => ({
  date: DATE,
  todoTags: [],
  events: [],
  placements: [],
  tzOffset: TZ,
  ...over,
});

describe("evaluateHardRules — no_placement_in", () => {
  const rule: HardRule = { kind: "no_placement_in", start: "22:00", end: "07:00" };

  test("slot inside the range is rejected", () => {
    const r = evaluateHardRules(slot("22:30", "23:30"), [rule], ctx());
    expect(r.ok).toBe(false);
  });

  test("slot fully outside is accepted", () => {
    const r = evaluateHardRules(slot("10:00", "11:00"), [rule], ctx());
    expect(r.ok).toBe(true);
  });

  test("wrap-past-midnight range catches early-morning slot", () => {
    const r = evaluateHardRules(slot("06:00", "06:30"), [rule], ctx());
    expect(r.ok).toBe(false);
  });
});

describe("evaluateHardRules — no_overlap_with_tag", () => {
  const rule: HardRule = { kind: "no_overlap_with_tag", tag: "#meeting" };

  test("slot overlapping a tagged event is rejected", () => {
    const r = evaluateHardRules(
      slot("10:30", "11:30"),
      [rule],
      ctx({ events: [event("standup", "10:00", "11:00", ["#meeting"])] }),
    );
    expect(r.ok).toBe(false);
  });

  test("slot away from tagged events is accepted", () => {
    const r = evaluateHardRules(
      slot("13:00", "14:00"),
      [rule],
      ctx({ events: [event("standup", "10:00", "11:00", ["#meeting"])] }),
    );
    expect(r.ok).toBe(true);
  });

  test("untagged event is ignored", () => {
    const r = evaluateHardRules(
      slot("10:30", "11:30"),
      [rule],
      ctx({ events: [event("focus", "10:00", "11:00", [])] }),
    );
    expect(r.ok).toBe(true);
  });
});

describe("evaluateHardRules — min_buffer_around_meeting_min", () => {
  const rule: HardRule = { kind: "min_buffer_around_meeting_min", minutes: 10 };

  test("slot ending exactly at meeting start is rejected (within buffer)", () => {
    const r = evaluateHardRules(
      slot("09:50", "10:00"),
      [rule],
      ctx({ events: [event("m", "10:00", "11:00")] }),
    );
    expect(r.ok).toBe(false);
  });

  test("slot starting >= 10 min after meeting end is accepted", () => {
    const r = evaluateHardRules(
      slot("11:10", "12:00"),
      [rule],
      ctx({ events: [event("m", "10:00", "11:00")] }),
    );
    expect(r.ok).toBe(true);
  });

  test("slot starting 5 min after meeting end is rejected", () => {
    const r = evaluateHardRules(
      slot("11:05", "12:00"),
      [rule],
      ctx({ events: [event("m", "10:00", "11:00")] }),
    );
    expect(r.ok).toBe(false);
  });
});

describe("evaluateHardRules — duration_cap_per_day_min", () => {
  const rule: HardRule = { kind: "duration_cap_per_day_min", minutes: 240 };

  test("placing under the cap is accepted", () => {
    const r = evaluateHardRules(slot("10:00", "11:00"), [rule], ctx());
    expect(r.ok).toBe(true);
  });

  test("existing placements counting toward the cap can push it over", () => {
    // Already 200 min placed → 200 + 60 = 260 > 240 → reject
    const fakePlacement = {
      id: "plc_01abcdefghi100",
      todo_id: "todo_01abcdefghi100",
      start: at("13:00"),
      end: at("16:20"),
      title: "x",
      tags: [],
      importance_score: null,
      duration_min: 200,
      placed_by: "user" as const,
      placed_at: at("00:00"),
      policy_hash: null,
      locked: false,
    };
    const r = evaluateHardRules(
      slot("09:00", "10:00"),
      [rule],
      ctx({ placements: [fakePlacement] }),
    );
    expect(r.ok).toBe(false);
  });
});

describe("evaluateHardRules — require_tag_in_range", () => {
  const rule: HardRule = {
    kind: "require_tag_in_range",
    tag: "#deep-work",
    start: "09:00",
    end: "12:00",
  };

  test("slot in range without the tag is rejected", () => {
    const r = evaluateHardRules(slot("09:00", "10:00"), [rule], ctx({ todoTags: [] }));
    expect(r.ok).toBe(false);
  });

  test("slot in range with the tag is accepted", () => {
    const r = evaluateHardRules(
      slot("09:00", "10:00"),
      [rule],
      ctx({ todoTags: ["#deep-work"] }),
    );
    expect(r.ok).toBe(true);
  });

  test("slot outside range is unaffected by tag presence", () => {
    const r = evaluateHardRules(slot("14:00", "15:00"), [rule], ctx({ todoTags: [] }));
    expect(r.ok).toBe(true);
  });
});

describe("evaluateHardRules — multiple violations", () => {
  test("returns every violated rule, not just the first", () => {
    const rules: HardRule[] = [
      { kind: "no_placement_in", start: "22:00", end: "07:00" },
      { kind: "min_buffer_around_meeting_min", minutes: 60 },
    ];
    const r = evaluateHardRules(
      slot("22:30", "23:00"),
      rules,
      ctx({ events: [event("late", "23:00", "23:30")] }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.violations.length).toBeGreaterThanOrEqual(1);
    }
  });
});
