import { describe, expect, test } from "bun:test";
import {
  BALANCED_PRESET,
  ContextSchema,
  HardRuleSchema,
  ImportanceWeightsSchema,
  PolicySchema,
  policyHash,
  SoftPreferenceSchema,
} from "./index";

describe("Balanced preset", () => {
  test("parses cleanly through PolicySchema", () => {
    const result = PolicySchema.safeParse(BALANCED_PRESET);
    if (!result.success) console.error(result.error.issues);
    expect(result.success).toBe(true);
  });

  test("captures the PRD §10.3 documented values", () => {
    expect(BALANCED_PRESET.context.tz).toBe("Asia/Seoul");
    expect(BALANCED_PRESET.placement_grid_min).toBe(30);
    expect(BALANCED_PRESET.reactivity).toBe("balanced");
    expect(BALANCED_PRESET.importance_weights.urgency).toBe(1.5);
    expect(BALANCED_PRESET.importance_weights.impact).toBe(2.0);
    expect(BALANCED_PRESET.conflict_thresholds.auto_resolve_max_score).toBe(40);
  });

  test("serialization round-trip is stable (parse → stringify equals input)", () => {
    const parsed = PolicySchema.parse(BALANCED_PRESET);
    expect(JSON.parse(JSON.stringify(parsed))).toEqual(parsed);
  });
});

describe("PolicySchema defaults", () => {
  test("missing optional fields fill from schema defaults", () => {
    const minimal = {
      context: { tz: "UTC" },
    };
    const parsed = PolicySchema.parse(minimal);
    expect(parsed.schema_version).toBe("0.1.0");
    expect(parsed.reactivity).toBe("balanced");
    expect(parsed.placement_grid_min).toBe(30);
    expect(parsed.hard_rules).toEqual([]);
    expect(parsed.soft_preferences).toEqual([]);
    expect(parsed.importance_weights.urgency).toBe(1.5);
    expect(parsed.conflict_thresholds.decisive_gap_score).toBe(20);
  });

  test("missing context is rejected", () => {
    expect(PolicySchema.safeParse({}).success).toBe(false);
  });

  test("unknown top-level keys are rejected (strict mode)", () => {
    expect(
      PolicySchema.safeParse({ context: { tz: "UTC" }, mystery: 1 }).success,
    ).toBe(false);
  });
});

describe("HardRule discriminated union — 5 variants", () => {
  test.each([
    { kind: "no_placement_in", start: "22:00", end: "07:00" },
    { kind: "no_overlap_with_tag", tag: "#meeting" },
    { kind: "min_buffer_around_meeting_min", minutes: 10 },
    { kind: "duration_cap_per_day_min", minutes: 240 },
    { kind: "require_tag_in_range", tag: "#deep-work", start: "09:00", end: "12:00" },
  ])("accepts %s", (rule) => {
    expect(HardRuleSchema.safeParse(rule).success).toBe(true);
  });

  test("rejects unknown kind", () => {
    expect(HardRuleSchema.safeParse({ kind: "no_eating" }).success).toBe(false);
  });

  test("rejects misshapen min_buffer (string instead of number)", () => {
    expect(
      HardRuleSchema.safeParse({
        kind: "min_buffer_around_meeting_min",
        minutes: "ten",
      }).success,
    ).toBe(false);
  });
});

describe("SoftPreference discriminated union — 5 variants", () => {
  test.each([
    { kind: "prefer_tag_in_range", tag: "#deep-work", start: "09:00", end: "12:00", weight: 20 },
    { kind: "avoid_back_to_back_after_min", minutes: 60, weight: -10 },
    { kind: "cluster_same_tag", weight: 8 },
    { kind: "avoid_tag_after_time", tag: "#admin", after: "17:00", weight: -15 },
    { kind: "energy_peak_bonus", weight: 12 },
  ])("accepts %s", (pref) => {
    expect(SoftPreferenceSchema.safeParse(pref).success).toBe(true);
  });
});

describe("ContextSchema", () => {
  test("working_hours / energy_peaks / protected_ranges default to []", () => {
    const c = ContextSchema.parse({ tz: "UTC" });
    expect(c.working_hours).toEqual([]);
    expect(c.energy_peaks).toEqual([]);
    expect(c.protected_ranges).toEqual([]);
  });

  test("days defaults to all 7 when omitted on a TimeRange", () => {
    const c = ContextSchema.parse({
      tz: "UTC",
      working_hours: [{ start: "09:00", end: "18:00" }],
    });
    expect(c.working_hours[0]?.days).toHaveLength(7);
  });
});

describe("ImportanceWeightsSchema", () => {
  test("partial input fills in PRD-default weights", () => {
    const w = ImportanceWeightsSchema.parse({ urgency: 2.5 });
    expect(w.urgency).toBe(2.5);
    expect(w.impact).toBe(2.0);
    expect(w.hard_deadline_bonus).toBe(15);
  });
});

describe("policyHash", () => {
  test("is deterministic and 64 hex chars (SHA-256)", async () => {
    const a = await policyHash(BALANCED_PRESET);
    const b = await policyHash(BALANCED_PRESET);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  test("differs when policy values change", async () => {
    const a = await policyHash(BALANCED_PRESET);
    const tweaked = {
      ...BALANCED_PRESET,
      placement_grid_min: 15,
    };
    const b = await policyHash(tweaked);
    expect(a).not.toBe(b);
  });
});
