import { describe, expect, test } from "bun:test";
import type { CognitiveLoad } from "../policy";
import { evaluateCognitiveLoad } from "./cognitive-load";

const linearLoad: CognitiveLoad = {
  decay: "linear",
  full_capacity_window_hours: 4,
  heavy_task_threshold_min: 60,
  linear_penalty_per_hour: 10,
  exponential_base: 2,
};

const expLoad: CognitiveLoad = {
  ...linearLoad,
  decay: "exponential",
};

describe("evaluateCognitiveLoad — linear (default)", () => {
  test("light task always passes (severity ok, no penalty)", () => {
    const r = evaluateCognitiveLoad({
      slot: { start: "2026-04-28T22:00:00+09:00" },
      anchorOnSlotDate: "2026-04-28T07:00:00+09:00",
      effortMin: 30, // < 60 threshold
      cognitiveLoad: linearLoad,
    });
    expect(r.severity).toBe("ok");
    expect(r.is_heavy).toBe(false);
    expect(r.penalty).toBe(0);
  });

  test("heavy task inside the capacity window has no penalty", () => {
    // anchor 07:00, slot 10:00 → elapsed 3h ≤ window 4h.
    const r = evaluateCognitiveLoad({
      slot: { start: "2026-04-28T10:00:00+09:00" },
      anchorOnSlotDate: "2026-04-28T07:00:00+09:00",
      effortMin: 90,
      cognitiveLoad: linearLoad,
    });
    expect(r.severity).toBe("ok");
    expect(r.is_heavy).toBe(true);
    expect(r.penalty).toBe(0);
  });

  test("heavy task 1h past window → -10 penalty", () => {
    // anchor 07:00, slot 12:00 → elapsed 5h, overshoot 1h.
    const r = evaluateCognitiveLoad({
      slot: { start: "2026-04-28T12:00:00+09:00" },
      anchorOnSlotDate: "2026-04-28T07:00:00+09:00",
      effortMin: 90,
      cognitiveLoad: linearLoad,
    });
    expect(r.severity).toBe("soft");
    expect(r.penalty).toBe(-10);
  });

  test("heavy task 6h past window → -60 penalty", () => {
    // anchor 07:00, slot 17:00 → elapsed 10h, overshoot 6h.
    const r = evaluateCognitiveLoad({
      slot: { start: "2026-04-28T17:00:00+09:00" },
      anchorOnSlotDate: "2026-04-28T07:00:00+09:00",
      effortMin: 60,
      cognitiveLoad: linearLoad,
    });
    expect(r.severity).toBe("soft");
    expect(r.penalty).toBe(-60);
  });

  test("decay is monotonic — later slot ranks lower for same heavy task", () => {
    const at10 = evaluateCognitiveLoad({
      slot: { start: "2026-04-28T10:00:00+09:00" },
      anchorOnSlotDate: "2026-04-28T07:00:00+09:00",
      effortMin: 90,
      cognitiveLoad: linearLoad,
    });
    const at17 = evaluateCognitiveLoad({
      slot: { start: "2026-04-28T17:00:00+09:00" },
      anchorOnSlotDate: "2026-04-28T07:00:00+09:00",
      effortMin: 90,
      cognitiveLoad: linearLoad,
    });
    expect(at10.penalty).toBeGreaterThanOrEqual(at17.penalty);
  });
});

describe("evaluateCognitiveLoad — exponential", () => {
  test("ramps faster than linear past the window", () => {
    // overshoot 3h: linear → -30, exp (base 2) → 10 × (2^3 - 1) = -70.
    const lin = evaluateCognitiveLoad({
      slot: { start: "2026-04-28T14:00:00+09:00" },
      anchorOnSlotDate: "2026-04-28T07:00:00+09:00",
      effortMin: 60,
      cognitiveLoad: linearLoad,
    });
    const exp = evaluateCognitiveLoad({
      slot: { start: "2026-04-28T14:00:00+09:00" },
      anchorOnSlotDate: "2026-04-28T07:00:00+09:00",
      effortMin: 60,
      cognitiveLoad: expLoad,
    });
    expect(lin.penalty).toBe(-30);
    expect(exp.penalty).toBe(-70);
    expect(exp.penalty).toBeLessThan(lin.penalty); // more negative
  });

  test("at the window boundary both modes yield 0", () => {
    // overshoot 0 → both produce 0 (continuity).
    const lin = evaluateCognitiveLoad({
      slot: { start: "2026-04-28T11:00:00+09:00" },
      anchorOnSlotDate: "2026-04-28T07:00:00+09:00",
      effortMin: 60,
      cognitiveLoad: linearLoad,
    });
    const exp = evaluateCognitiveLoad({
      slot: { start: "2026-04-28T11:00:00+09:00" },
      anchorOnSlotDate: "2026-04-28T07:00:00+09:00",
      effortMin: 60,
      cognitiveLoad: expLoad,
    });
    expect(lin.penalty).toBe(0);
    expect(exp.penalty).toBe(0);
  });
});

describe("evaluateCognitiveLoad — skip paths", () => {
  test("null policy → severity skip", () => {
    const r = evaluateCognitiveLoad({
      slot: { start: "2026-04-28T17:00:00+09:00" },
      anchorOnSlotDate: "2026-04-28T07:00:00+09:00",
      effortMin: 90,
      cognitiveLoad: null,
    });
    expect(r.severity).toBe("skip");
    expect(r.penalty).toBe(0);
  });

  test("null anchor → severity skip", () => {
    const r = evaluateCognitiveLoad({
      slot: { start: "2026-04-28T17:00:00+09:00" },
      anchorOnSlotDate: null,
      effortMin: 90,
      cognitiveLoad: linearLoad,
    });
    expect(r.severity).toBe("skip");
  });

  test("null effortMin treated as light (ok, no penalty)", () => {
    const r = evaluateCognitiveLoad({
      slot: { start: "2026-04-28T17:00:00+09:00" },
      anchorOnSlotDate: "2026-04-28T07:00:00+09:00",
      effortMin: null,
      cognitiveLoad: linearLoad,
    });
    expect(r.severity).toBe("ok");
    expect(r.is_heavy).toBe(false);
  });
});
