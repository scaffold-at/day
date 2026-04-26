import { describe, expect, test } from "bun:test";
import { BALANCED_PRESET } from "./balanced-preset";
import {
  computeImportanceScore,
  type ImportanceDimensions,
  ImportanceDimensionsSchema,
  makeTaskImportance,
  TaskImportanceSchema,
} from "./importance";

const W = BALANCED_PRESET.importance_weights;

const dims = (over: Partial<ImportanceDimensions> = {}): ImportanceDimensions => ({
  urgency: 5,
  impact: 5,
  effort: 5,
  reversibility: 5,
  external_dependency: false,
  deadline: "none",
  ...over,
});

// 30-entry goldfile — each tuple is [dimensions, expected score under
// the Balanced preset weights]. Expected values are computed from the
// PRD §10.2 formula by hand and pinned here as a regression net.
type Gold = readonly [Partial<ImportanceDimensions>, number];
const GOLDFILE: ReadonlyArray<Gold> = [
  // baseline neutral
  [{}, 34.905660377358494],
  // pure low / pure high
  [{ urgency: 0, impact: 0, effort: 0, reversibility: 0 }, 18.86792452830189],
  [{ urgency: 10, impact: 10, effort: 10, reversibility: 10 }, 50.943396226415096],
  // urgency sweeps
  [{ urgency: 0 }, 20.754716981132077],
  [{ urgency: 5 }, 34.905660377358494],
  [{ urgency: 10 }, 49.05660377358491],
  // impact sweeps
  [{ impact: 0 }, 16.037735849056602],
  [{ impact: 5 }, 34.905660377358494],
  [{ impact: 10 }, 53.77358490566038],
  // effort: higher effort lowers the score
  [{ effort: 0 }, 42.45283018867924],
  [{ effort: 10 }, 27.358490566037737],
  // reversibility: low reversibility raises score (riskier → more important)
  [{ reversibility: 0 }, 44.339622641509436],
  [{ reversibility: 10 }, 25.471698113207548],
  // hard deadline adds 15
  [{ deadline: "hard" }, 49.905660377358494],
  [{ deadline: "soft" }, 42.905660377358494],
  [{ deadline: "none" }, 34.905660377358494],
  // external dependency adds 5
  [{ external_dependency: true }, 39.905660377358494],
  [{ external_dependency: true, deadline: "hard" }, 54.905660377358494],
  // urgent + critical with hard deadline + external dependency
  [
    { urgency: 10, impact: 10, effort: 0, reversibility: 0, deadline: "hard", external_dependency: true },
    100,
  ],
  // very low priority — small effort, easy to undo, no urgency
  [{ urgency: 0, impact: 0, effort: 10, reversibility: 10 }, 0],
  // mixed scenarios
  [{ urgency: 7, impact: 8, effort: 4, reversibility: 6, deadline: "soft" }, 59.509433962264154],
  [{ urgency: 3, impact: 9, effort: 6, reversibility: 8, deadline: "hard" }, 52.16981132075472],
  [{ urgency: 8, impact: 4, effort: 7, reversibility: 5, external_dependency: true }, 41.60377358490566],
  [{ urgency: 6, impact: 6, effort: 6, reversibility: 6 }, 38.113207547169814],
  [{ urgency: 4, impact: 4, effort: 4, reversibility: 4 }, 31.69811320754717],
  [{ urgency: 9, impact: 9, effort: 1, reversibility: 1 }, 74.90566037735849],
  [{ urgency: 1, impact: 1, effort: 9, reversibility: 9 }, 0],
  [{ urgency: 2, impact: 7, effort: 3, reversibility: 4 }, 38.86792452830189],
  [{ urgency: 5, impact: 5, effort: 5, reversibility: 5, time_sensitivity: 7 }, 34.905660377358494],
  [{ urgency: 5, impact: 5, effort: 5, reversibility: 5, deadline: "hard", external_dependency: true }, 54.905660377358494],
];

describe("ImportanceDimensionsSchema", () => {
  test("baseline accepts valid input", () => {
    expect(ImportanceDimensionsSchema.safeParse(dims()).success).toBe(true);
  });

  test("rejects out-of-range dimension", () => {
    expect(ImportanceDimensionsSchema.safeParse(dims({ urgency: 11 })).success).toBe(false);
    expect(ImportanceDimensionsSchema.safeParse(dims({ urgency: -1 })).success).toBe(false);
  });

  test("rejects unknown deadline kind", () => {
    expect(
      ImportanceDimensionsSchema.safeParse({ ...dims(), deadline: "later" }).success,
    ).toBe(false);
  });
});

describe("computeImportanceScore — goldfile (30 cases)", () => {
  test.each(GOLDFILE)("input #%# → expected score", (input, expected) => {
    const score = computeImportanceScore(dims(input), W);
    expect(score).toBeCloseTo(expected, 6);
  });
});

describe("computeImportanceScore — properties", () => {
  test("always within [0, 100]", () => {
    for (let u = 0; u <= 10; u++) {
      for (let i = 0; i <= 10; i++) {
        for (let e = 0; e <= 10; e++) {
          for (let r = 0; r <= 10; r++) {
            const score = computeImportanceScore(
              dims({ urgency: u, impact: i, effort: e, reversibility: r }),
              W,
            );
            expect(score).toBeGreaterThanOrEqual(0);
            expect(score).toBeLessThanOrEqual(100);
          }
        }
      }
    }
  });

  test("urgency↑ → score non-decreasing (impact/effort/rev fixed)", () => {
    let prev = -Infinity;
    for (let u = 0; u <= 10; u++) {
      const score = computeImportanceScore(dims({ urgency: u }), W);
      expect(score).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = score;
    }
  });

  test("impact↑ → score non-decreasing", () => {
    let prev = -Infinity;
    for (let i = 0; i <= 10; i++) {
      const score = computeImportanceScore(dims({ impact: i }), W);
      expect(score).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = score;
    }
  });

  test("effort↑ → score non-increasing (high effort lowers importance)", () => {
    let prev = +Infinity;
    for (let e = 0; e <= 10; e++) {
      const score = computeImportanceScore(dims({ effort: e }), W);
      expect(score).toBeLessThanOrEqual(prev + 1e-9);
      prev = score;
    }
  });

  test("reversibility↑ → score non-increasing (easy-to-undo lowers importance)", () => {
    let prev = +Infinity;
    for (let r = 0; r <= 10; r++) {
      const score = computeImportanceScore(dims({ reversibility: r }), W);
      expect(score).toBeLessThanOrEqual(prev + 1e-9);
      prev = score;
    }
  });

  test("deadline 'hard' >= 'soft' >= 'none' for the same dimensions", () => {
    const none = computeImportanceScore(dims({ deadline: "none" }), W);
    const soft = computeImportanceScore(dims({ deadline: "soft" }), W);
    const hard = computeImportanceScore(dims({ deadline: "hard" }), W);
    expect(soft).toBeGreaterThanOrEqual(none);
    expect(hard).toBeGreaterThanOrEqual(soft);
  });

  test("external_dependency=true ≥ external_dependency=false", () => {
    const off = computeImportanceScore(dims({ external_dependency: false }), W);
    const on = computeImportanceScore(dims({ external_dependency: true }), W);
    expect(on).toBeGreaterThanOrEqual(off);
  });

  test("identical inputs always yield identical outputs (determinism)", () => {
    const a = computeImportanceScore(dims({ urgency: 7, impact: 8, effort: 4, reversibility: 6, deadline: "soft" }), W);
    const b = computeImportanceScore(dims({ urgency: 7, impact: 8, effort: 4, reversibility: 6, deadline: "soft" }), W);
    expect(a).toBe(b);
  });

  test("zero-sum weights collapses safely to 0 (no NaN / no throw)", () => {
    const zeroW = { ...W, urgency: 0, impact: 0, effort: 0, reversibility: 0 };
    const score = computeImportanceScore(dims(), zeroW);
    expect(Number.isFinite(score)).toBe(true);
    expect(score).toBe(0);
  });
});

describe("makeTaskImportance + TaskImportanceSchema", () => {
  test("round-trips through the schema with a 64-char SHA-256 policy_hash", async () => {
    const ti = await makeTaskImportance(
      dims({ urgency: 7, impact: 8 }),
      BALANCED_PRESET,
      { reasoning: "Quarterly OKR-relevant.", computedBy: "user" },
    );
    expect(ti.policy_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(ti.score).toBeGreaterThan(0);
    expect(ti.score).toBeLessThanOrEqual(100);
    expect(TaskImportanceSchema.safeParse(ti).success).toBe(true);
  });

  test("same input + same policy → same score AND same policy_hash", async () => {
    const a = await makeTaskImportance(
      dims({ urgency: 5 }),
      BALANCED_PRESET,
      { reasoning: "x", computedBy: "user", computedAt: "2026-04-26T10:00:00Z" },
    );
    const b = await makeTaskImportance(
      dims({ urgency: 5 }),
      BALANCED_PRESET,
      { reasoning: "x", computedBy: "user", computedAt: "2026-04-26T10:00:00Z" },
    );
    expect(a.score).toBe(b.score);
    expect(a.policy_hash).toBe(b.policy_hash);
  });

  test("different policy → different policy_hash (even if score might match)", async () => {
    const a = await makeTaskImportance(
      dims({ urgency: 5 }),
      BALANCED_PRESET,
      { reasoning: "x", computedBy: "user" },
    );
    const tweaked = { ...BALANCED_PRESET, placement_grid_min: 15 };
    const b = await makeTaskImportance(
      dims({ urgency: 5 }),
      tweaked,
      { reasoning: "x", computedBy: "user" },
    );
    expect(a.policy_hash).not.toBe(b.policy_hash);
  });

  test("computed_by accepts 'user', 'ai', and a ModelId", async () => {
    const u = await makeTaskImportance(
      dims(),
      BALANCED_PRESET,
      { reasoning: "x", computedBy: "user" },
    );
    expect(u.computed_by).toBe("user");
    const ai = await makeTaskImportance(
      dims(),
      BALANCED_PRESET,
      { reasoning: "x", computedBy: "ai" },
    );
    expect(ai.computed_by).toBe("ai");
    const model = await makeTaskImportance(
      dims(),
      BALANCED_PRESET,
      { reasoning: "x", computedBy: "claude-sonnet-4-5" },
    );
    expect(model.computed_by).toBe("claude-sonnet-4-5");
  });
});
