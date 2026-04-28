import { describe, expect, test } from "bun:test";
import type { SleepBudget } from "../policy";
import type { HeartbeatEntry } from "./anchor";
import { computeRestSuggestion } from "./rest-break";

const budget: SleepBudget = {
  target_hours: 8,
  min_hours: 6,
  soft_penalty_per_hour: 15,
};

const fixture = (date: string, anchor: string): HeartbeatEntry => ({
  schema_version: "0.1.0",
  date,
  anchor,
  source: "explicit",
  recorded_at: anchor,
});

describe("computeRestSuggestion", () => {
  test("8h sleep → no suggestion (≥ min 6h)", () => {
    const r = computeRestSuggestion({
      // yesterday 07:00, today 07:00 → gap 24h, sleep 24-16 = 8h.
      yesterdayAnchor: fixture("2026-04-27", "2026-04-27T07:00:00+09:00"),
      todayAnchor: fixture("2026-04-28", "2026-04-28T07:00:00+09:00"),
      budget,
    });
    expect(r.suggest).toBe(false);
    expect(r.measured_sleep_hours).toBe(8);
    expect(r.break_min).toBe(0);
  });

  test("4h sleep → suggest 20-min rest", () => {
    // yesterday 07:00, today 03:00 next day → gap 20h, sleep 4h.
    const r = computeRestSuggestion({
      yesterdayAnchor: fixture("2026-04-27", "2026-04-27T07:00:00+09:00"),
      todayAnchor: fixture("2026-04-28", "2026-04-28T03:00:00+09:00"),
      budget,
    });
    expect(r.suggest).toBe(true);
    expect(r.measured_sleep_hours).toBe(4);
    expect(r.break_min).toBe(20);
    expect(r.reason).toContain("min 6h");
  });

  test("missing yesterday anchor → no suggestion", () => {
    const r = computeRestSuggestion({
      yesterdayAnchor: null,
      todayAnchor: fixture("2026-04-28", "2026-04-28T07:00:00+09:00"),
      budget,
    });
    expect(r.suggest).toBe(false);
    expect(r.measured_sleep_hours).toBeNull();
  });

  test("missing today anchor → no suggestion", () => {
    const r = computeRestSuggestion({
      yesterdayAnchor: fixture("2026-04-27", "2026-04-27T07:00:00+09:00"),
      todayAnchor: null,
      budget,
    });
    expect(r.suggest).toBe(false);
  });

  test("no budget → no suggestion (back-compat)", () => {
    const r = computeRestSuggestion({
      yesterdayAnchor: fixture("2026-04-27", "2026-04-27T07:00:00+09:00"),
      todayAnchor: fixture("2026-04-28", "2026-04-28T03:00:00+09:00"),
      budget: null,
    });
    expect(r.suggest).toBe(false);
  });

  test("anchors closer than 16h → measured sleep clamps to 0", () => {
    // pull-an-all-nighter case
    const r = computeRestSuggestion({
      yesterdayAnchor: fixture("2026-04-27", "2026-04-27T07:00:00+09:00"),
      todayAnchor: fixture("2026-04-28", "2026-04-27T22:00:00+09:00"),
      budget,
    });
    expect(r.measured_sleep_hours).toBe(0);
    expect(r.suggest).toBe(true);
  });
});
