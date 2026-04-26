import { describe, expect, test } from "bun:test";
import { BALANCED_PRESET } from "../policy";
import type { Placement } from "../day";
import type { SoftPreference } from "../policy";
import {
  computeReactivityPenalty,
  evaluateSoftPreferences,
  evaluateSoftPreferencesPolicy,
  type SoftPreferenceContext,
} from "./soft-preferences";

const TZ = "+09:00";
const DATE = "2026-04-26";
const at = (hhmm: string) => `${DATE}T${hhmm}:00${TZ}`;

const slot = (start: string, end: string) => ({
  start: at(start),
  end: at(end),
  duration_min: Math.round((Date.parse(at(end)) - Date.parse(at(start))) / 60000),
});

const placement = (start: string, end: string, tags: string[] = []): Placement => ({
  id: "plc_01abcdefghi100",
  todo_id: "todo_01abcdefghi100",
  start: at(start),
  end: at(end),
  title: "x",
  tags,
  importance_score: 50,
  importance_at_placement: null,
  duration_min: 30,
  placed_by: "user",
  placed_at: at("00:00"),
  policy_hash: null,
  locked: false,
});

const ctx = (over: Partial<SoftPreferenceContext> = {}): SoftPreferenceContext => ({
  date: DATE,
  todoTags: [],
  events: [],
  placements: [],
  tzOffset: TZ,
  ...over,
});

describe("evaluateSoftPreferences — prefer_tag_in_range", () => {
  const pref: SoftPreference = {
    kind: "prefer_tag_in_range",
    tag: "#deep-work",
    start: "09:00",
    end: "12:00",
    weight: 20,
  };

  test("deep-work tag in 09-12 → +20", () => {
    const r = evaluateSoftPreferences(slot("10:00", "11:00"), [pref], ctx({ todoTags: ["#deep-work"] }));
    expect(r.total).toBe(20);
    expect(r.contributions).toHaveLength(1);
  });

  test("no tag → no bonus", () => {
    const r = evaluateSoftPreferences(slot("10:00", "11:00"), [pref], ctx({ todoTags: [] }));
    expect(r.total).toBe(0);
  });

  test("tag but slot outside range → no bonus", () => {
    const r = evaluateSoftPreferences(slot("13:00", "14:00"), [pref], ctx({ todoTags: ["#deep-work"] }));
    expect(r.total).toBe(0);
  });
});

describe("evaluateSoftPreferences — cluster_same_tag", () => {
  const pref: SoftPreference = { kind: "cluster_same_tag", weight: 8 };

  test("shared tag with existing placement → +8", () => {
    const r = evaluateSoftPreferences(
      slot("13:00", "14:00"),
      [pref],
      ctx({ todoTags: ["#admin"], placements: [placement("11:00", "11:30", ["#admin"])] }),
    );
    expect(r.total).toBe(8);
  });

  test("no shared tag → no bonus", () => {
    const r = evaluateSoftPreferences(
      slot("13:00", "14:00"),
      [pref],
      ctx({ todoTags: ["#admin"], placements: [placement("11:00", "11:30", ["#deep-work"])] }),
    );
    expect(r.total).toBe(0);
  });
});

describe("evaluateSoftPreferences — avoid_tag_after_time", () => {
  const pref: SoftPreference = { kind: "avoid_tag_after_time", tag: "#admin", after: "17:00", weight: -15 };

  test("admin slot at 17:30 → -15", () => {
    const r = evaluateSoftPreferences(slot("17:30", "18:00"), [pref], ctx({ todoTags: ["#admin"] }));
    expect(r.total).toBe(-15);
  });

  test("admin slot at 11:00 → 0", () => {
    const r = evaluateSoftPreferences(slot("11:00", "12:00"), [pref], ctx({ todoTags: ["#admin"] }));
    expect(r.total).toBe(0);
  });
});

describe("evaluateSoftPreferences — avoid_back_to_back_after_min", () => {
  const pref: SoftPreference = { kind: "avoid_back_to_back_after_min", minutes: 30, weight: -10 };

  test("slot starts within 30 min after a placement → -10", () => {
    const r = evaluateSoftPreferences(
      slot("11:15", "12:00"),
      [pref],
      ctx({ placements: [placement("10:30", "11:00")] }),
    );
    expect(r.total).toBe(-10);
  });

  test("slot starts >= 30 min after → 0", () => {
    const r = evaluateSoftPreferences(
      slot("11:30", "12:00"),
      [pref],
      ctx({ placements: [placement("10:30", "11:00")] }),
    );
    expect(r.total).toBe(0);
  });
});

describe("evaluateSoftPreferencesPolicy — energy_peak_bonus", () => {
  test("slot inside energy peak adds the bonus once", () => {
    const policy = {
      ...BALANCED_PRESET,
      soft_preferences: [
        ...BALANCED_PRESET.soft_preferences,
        { kind: "energy_peak_bonus" as const, weight: 12 },
      ],
    };
    const r = evaluateSoftPreferencesPolicy(slot("09:30", "10:30"), policy, ctx());
    const peak = r.contributions.find((c) => c.preference.kind === "energy_peak_bonus");
    expect(peak).toBeDefined();
    expect(peak!.weight).toBe(12);
  });

  test("slot outside energy peak gets no bonus", () => {
    const policy = {
      ...BALANCED_PRESET,
      soft_preferences: [
        { kind: "energy_peak_bonus" as const, weight: 12 },
      ],
    };
    const r = evaluateSoftPreferencesPolicy(slot("14:00", "15:00"), policy, ctx());
    expect(r.total).toBe(0);
  });
});

describe("computeReactivityPenalty", () => {
  test("zero displacement → 0 across all reactivity levels", () => {
    expect(computeReactivityPenalty(slot("09:00", "10:00"), "low")).toBe(0);
    expect(computeReactivityPenalty(slot("09:00", "10:00"), "balanced")).toBe(0);
    expect(computeReactivityPenalty(slot("09:00", "10:00"), "high")).toBe(0);
  });

  test("low reactivity is more penalty-heavy than high", () => {
    const opts = { displacedLockedCount: 1, displacedTotalCount: 2 };
    const low = computeReactivityPenalty(slot("09:00", "10:00"), "low", opts);
    const balanced = computeReactivityPenalty(slot("09:00", "10:00"), "balanced", opts);
    const high = computeReactivityPenalty(slot("09:00", "10:00"), "high", opts);
    expect(low).toBeLessThan(balanced); // more negative
    expect(balanced).toBeLessThan(high);
  });

  test("locked displacements weigh more than unlocked", () => {
    const oneLocked = computeReactivityPenalty(slot("09:00", "10:00"), "balanced", {
      displacedLockedCount: 1,
      displacedTotalCount: 1,
    });
    const oneUnlocked = computeReactivityPenalty(slot("09:00", "10:00"), "balanced", {
      displacedLockedCount: 0,
      displacedTotalCount: 1,
    });
    expect(oneLocked).toBeLessThan(oneUnlocked); // locked produces a more negative penalty
  });
});
