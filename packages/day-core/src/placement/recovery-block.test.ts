import { describe, expect, test } from "bun:test";
import type { FixedEvent } from "../day";
import type { RecoveryBlock } from "../policy";
import { evaluateRecoveryBlock } from "./recovery-block";

const policy: RecoveryBlock = {
  late_threshold_minutes_past_working_end: 120,
  morning_block_hours: 2,
  soft_penalty: 30,
};

const ev = (start: string, end: string): FixedEvent => ({
  id: "evt_01abc",
  source: "manual",
  external_id: null,
  title: "x",
  start,
  end,
  all_day: false,
  location: null,
  notes: null,
  recurring: null,
  tags: [],
  synced_at: end,
});

const yesterdayWorkingEnd = "2026-04-27T18:00:00+09:00";
const todayWorkingStart = "2026-04-28T09:00:00+09:00";

describe("evaluateRecoveryBlock", () => {
  test("no late event → severity ok, no penalty", () => {
    const r = evaluateRecoveryBlock({
      slot: { start: "2026-04-28T09:30:00+09:00" },
      yesterdayEvents: [ev("2026-04-27T16:00:00+09:00", "2026-04-27T17:00:00+09:00")],
      yesterdayWorkingEnd,
      todayWorkingStart,
      policy,
    });
    expect(r.severity).toBe("ok");
    expect(r.triggered).toBe(false);
    expect(r.penalty).toBe(0);
  });

  test("late event 21:00 (3h past 18:00) → block triggered", () => {
    const r = evaluateRecoveryBlock({
      slot: { start: "2026-04-28T09:30:00+09:00" },
      yesterdayEvents: [ev("2026-04-27T19:00:00+09:00", "2026-04-27T21:00:00+09:00")],
      yesterdayWorkingEnd,
      todayWorkingStart,
      policy,
    });
    expect(r.severity).toBe("soft");
    expect(r.triggered).toBe(true);
    expect(r.penalty).toBe(-30);
  });

  test("triggered but slot is OUTSIDE the morning window → no penalty", () => {
    // Block window is 09:00-11:00; slot at 14:00 is outside.
    const r = evaluateRecoveryBlock({
      slot: { start: "2026-04-28T14:00:00+09:00" },
      yesterdayEvents: [ev("2026-04-27T19:00:00+09:00", "2026-04-27T21:00:00+09:00")],
      yesterdayWorkingEnd,
      todayWorkingStart,
      policy,
    });
    expect(r.severity).toBe("ok");
    expect(r.triggered).toBe(true);
    expect(r.penalty).toBe(0);
  });

  test("event ending exactly at threshold (18:00 + 120m = 20:00) is NOT late", () => {
    // Strict greater-than threshold.
    const r = evaluateRecoveryBlock({
      slot: { start: "2026-04-28T09:30:00+09:00" },
      yesterdayEvents: [ev("2026-04-27T19:00:00+09:00", "2026-04-27T20:00:00+09:00")],
      yesterdayWorkingEnd,
      todayWorkingStart,
      policy,
    });
    expect(r.triggered).toBe(false);
  });

  test("policy null → severity skip", () => {
    const r = evaluateRecoveryBlock({
      slot: { start: "2026-04-28T09:30:00+09:00" },
      yesterdayEvents: [ev("2026-04-27T19:00:00+09:00", "2026-04-27T22:00:00+09:00")],
      yesterdayWorkingEnd,
      todayWorkingStart,
      policy: null,
    });
    expect(r.severity).toBe("skip");
  });

  test("missing yesterday working end → severity skip", () => {
    const r = evaluateRecoveryBlock({
      slot: { start: "2026-04-28T09:30:00+09:00" },
      yesterdayEvents: [ev("2026-04-27T19:00:00+09:00", "2026-04-27T22:00:00+09:00")],
      yesterdayWorkingEnd: null,
      todayWorkingStart,
      policy,
    });
    expect(r.severity).toBe("skip");
  });
});
