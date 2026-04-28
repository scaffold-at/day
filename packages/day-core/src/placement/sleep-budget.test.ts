import { describe, expect, test } from "bun:test";
import type { SleepBudget } from "../policy";
import {
  evaluateSleepBudget,
  projectAnchorForDate,
} from "./sleep-budget";

const budget: SleepBudget = {
  target_hours: 8,
  min_hours: 6,
  soft_penalty_per_hour: 15,
};

describe("evaluateSleepBudget", () => {
  test("ok when implied sleep ≥ target", () => {
    const r = evaluateSleepBudget({
      slot: { start: "2026-04-28T20:00:00+09:00", end: "2026-04-28T21:00:00+09:00" },
      anchorOnSlotDate: "2026-04-28T07:00:00+09:00",
      events: [],
      placements: [],
      budget,
    });
    expect(r.severity).toBe("ok");
    expect(r.implied_sleep_hours).toBe(10);
    expect(r.penalty).toBe(0);
  });

  test("soft when implied sleep is between min and target", () => {
    // Slot ends 23:30 → next anchor (next day 07:00) is 7.5h away.
    const r = evaluateSleepBudget({
      slot: { start: "2026-04-28T22:30:00+09:00", end: "2026-04-28T23:30:00+09:00" },
      anchorOnSlotDate: "2026-04-28T07:00:00+09:00",
      events: [],
      placements: [],
      budget,
    });
    expect(r.severity).toBe("soft");
    expect(r.implied_sleep_hours).toBeCloseTo(7.5, 5);
    // Shortfall 0.5h × 15 = -8 (rounded).
    expect(r.penalty).toBeLessThan(0);
    expect(r.penalty).toBeGreaterThanOrEqual(-15);
  });

  test("hard reject when implied sleep is below min", () => {
    // Slot ends 02:00 next day → 5h before next anchor 07:00.
    const r = evaluateSleepBudget({
      slot: { start: "2026-04-29T01:00:00+09:00", end: "2026-04-29T02:00:00+09:00" },
      anchorOnSlotDate: "2026-04-28T07:00:00+09:00",
      events: [],
      placements: [],
      budget,
    });
    expect(r.severity).toBe("hard");
    expect(r.penalty).toBe(0);
    expect(r.reason).toContain("under min 6h");
  });

  test("uses the latest event end as 'last activity' (not slot end)", () => {
    // Slot ends 17:00 but a meeting runs until 21:00. Anchor 07:00.
    // Effective last activity = 21:00 → 10h sleep → ok.
    // Without considering events, slot end would have given 14h.
    const r = evaluateSleepBudget({
      slot: { start: "2026-04-28T16:00:00+09:00", end: "2026-04-28T17:00:00+09:00" },
      anchorOnSlotDate: "2026-04-28T07:00:00+09:00",
      events: [
        {
          id: "evt_01abc",
          source: "manual",
          external_id: null,
          title: "long meeting",
          start: "2026-04-28T19:00:00+09:00",
          end: "2026-04-28T21:00:00+09:00",
          all_day: false,
          location: null,
          notes: null,
          recurring: null,
          tags: [],
          synced_at: "2026-04-28T19:00:00+09:00",
        },
      ],
      placements: [],
      budget,
    });
    expect(r.severity).toBe("ok");
    expect(r.implied_sleep_hours).toBe(10);
  });

  test("skips when budget is null", () => {
    const r = evaluateSleepBudget({
      slot: { start: "2026-04-28T22:30:00+09:00", end: "2026-04-28T23:30:00+09:00" },
      anchorOnSlotDate: "2026-04-28T07:00:00+09:00",
      events: [],
      placements: [],
      budget: null,
    });
    expect(r.severity).toBe("skip");
  });

  test("skips when anchor unknown", () => {
    const r = evaluateSleepBudget({
      slot: { start: "2026-04-28T22:30:00+09:00", end: "2026-04-28T23:30:00+09:00" },
      anchorOnSlotDate: null,
      events: [],
      placements: [],
      budget,
    });
    expect(r.severity).toBe("skip");
  });
});

describe("projectAnchorForDate", () => {
  test("returns the recorded anchor when the target date matches", () => {
    const got = projectAnchorForDate({
      recordedAnchor: { date: "2026-04-28", anchor: "2026-04-28T07:00:00+09:00" },
      targetDate: "2026-04-28",
    });
    expect(got).toBe("2026-04-28T07:00:00+09:00");
  });

  test("projects forward 24h per day in the same TZ offset", () => {
    const got = projectAnchorForDate({
      recordedAnchor: { date: "2026-04-28", anchor: "2026-04-28T07:00:00+09:00" },
      targetDate: "2026-04-29",
    });
    expect(got).toBe("2026-04-29T07:00:00+09:00");
  });

  test("returns null when target date is before the recorded one", () => {
    const got = projectAnchorForDate({
      recordedAnchor: { date: "2026-04-28", anchor: "2026-04-28T07:00:00+09:00" },
      targetDate: "2026-04-27",
    });
    expect(got).toBeNull();
  });

  test("returns null when no anchor is provided", () => {
    expect(projectAnchorForDate({ recordedAnchor: null, targetDate: "2026-04-28" })).toBeNull();
  });
});
