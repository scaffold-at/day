import type { Policy } from "./policy";

/**
 * The single built-in preset that ships with v0.1 (PRD §10.3).
 *
 * 5 additional presets land in §v0.3+. Until §S14 wires the YAML
 * codec, this object is the canonical Balanced. Once `policy.ts`
 * gains the YAML round-trip, the file under
 * `<home>/policy/current.yaml` becomes the source of truth.
 */
export const BALANCED_PRESET: Policy = {
  schema_version: "0.1.0",
  preset: "balanced",
  context: {
    tz: "Asia/Seoul",
    working_hours: [
      { start: "09:00", end: "18:00", days: ["mon", "tue", "wed", "thu", "fri"] },
    ],
    energy_peaks: [
      { start: "09:00", end: "12:00", days: ["mon", "tue", "wed", "thu", "fri"] },
    ],
    protected_ranges: [
      {
        start: "12:00",
        end: "13:00",
        label: "lunch",
        days: ["mon", "tue", "wed", "thu", "fri"],
      },
      {
        start: "22:00",
        end: "07:00",
        label: "sleep",
        days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
      },
    ],
  },
  hard_rules: [
    { kind: "no_placement_in", start: "22:00", end: "07:00" },
    { kind: "min_buffer_around_meeting_min", minutes: 10 },
  ],
  soft_preferences: [
    {
      kind: "prefer_tag_in_range",
      tag: "#deep-work",
      start: "09:00",
      end: "12:00",
      weight: 20,
    },
    {
      kind: "avoid_tag_after_time",
      tag: "#admin",
      after: "17:00",
      weight: -15,
    },
    { kind: "cluster_same_tag", weight: 8 },
  ],
  reactivity: "balanced",
  importance_weights: {
    urgency: 1.5,
    impact: 2.0,
    effort: 0.8,
    reversibility: 1.0,
    time_sensitivity: 0.0,
    external_dependency: 0.0,
    hard_deadline_bonus: 15,
    soft_deadline_bonus: 8,
    external_dependency_bonus: 5,
  },
  conflict_thresholds: {
    auto_resolve_max_score: 40,
    decisive_gap_score: 20,
  },
  placement_grid_min: 30,
};

export const BUILTIN_PRESETS = {
  balanced: BALANCED_PRESET,
} as const;

export type BuiltinPresetName = keyof typeof BUILTIN_PRESETS;
