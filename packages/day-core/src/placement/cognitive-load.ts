/**
 * Cognitive load decay evaluation (PRD v0.2 §S59, design issue #2).
 *
 * Heavy tasks that land deep into the day (many hours after the
 * morning anchor) accumulate a soft score penalty. Light tasks are
 * unaffected. The penalty is *not* a hard reject — the placement
 * engine still allows the slot if nothing earlier fits.
 *
 * Why this slice exists:
 *   v0.1 ranks slots by Importance + Soft Preferences + Reactivity.
 *   It will happily suggest a 2-hour deep-work block at 21:00 even
 *   if the user has been on for 14 hours since their morning. v0.2
 *   adds a temporal decay so "10:00 is better than 17:00" for heavy
 *   work, deterministically.
 *
 * Mode selection:
 *   "linear" (default): -linear_penalty_per_hour × (elapsed - window)
 *                       per hour past the full_capacity_window. Easy
 *                       to reason about; tested as the v0.2 baseline.
 *   "exponential":      -linear_penalty_per_hour × (base^overshoot - 1).
 *                       Ramps faster — opt-in only.
 *
 * Free of any I/O — pure scoring helper.
 */

import type { CognitiveLoad } from "../policy";

export type CognitiveLoadSeverity = "ok" | "soft" | "skip";

export type CognitiveLoadEvaluation = {
  severity: CognitiveLoadSeverity;
  /** Hours from the slot's anchor to the slot's start (≥ 0). */
  elapsed_hours: number;
  /** True iff the candidate todo's effort_min ≥ heavy threshold. */
  is_heavy: boolean;
  /** Score contribution; ≤ 0 always. 0 when ok / skip. */
  penalty: number;
  /** One-line summary of why we landed where we did. */
  reason: string;
};

export type CognitiveLoadInput = {
  slot: { start: string };
  /** Anchor on the slot's date, ISO 8601 with TZ; null → skip. */
  anchorOnSlotDate: string | null;
  /** Effort in minutes. null → treated as light (no penalty). */
  effortMin: number | null;
  /** Policy field; null → skip. */
  cognitiveLoad: CognitiveLoad | null;
};

const HOUR = 60 * 60 * 1000;

export function evaluateCognitiveLoad(
  input: CognitiveLoadInput,
): CognitiveLoadEvaluation {
  if (!input.cognitiveLoad || !input.anchorOnSlotDate) {
    return {
      severity: "skip",
      elapsed_hours: 0,
      is_heavy: false,
      penalty: 0,
      reason: "cognitive_load not configured or anchor unknown",
    };
  }

  const anchorMs = Date.parse(input.anchorOnSlotDate);
  const slotMs = Date.parse(input.slot.start);
  const elapsedHours = Math.max(0, (slotMs - anchorMs) / HOUR);

  const isHeavy =
    input.effortMin !== null &&
    input.effortMin >= input.cognitiveLoad.heavy_task_threshold_min;

  if (!isHeavy) {
    return {
      severity: "ok",
      elapsed_hours: elapsedHours,
      is_heavy: false,
      penalty: 0,
      reason: "light task — no decay applied",
    };
  }

  const overshoot = elapsedHours - input.cognitiveLoad.full_capacity_window_hours;
  if (overshoot <= 0) {
    return {
      severity: "ok",
      elapsed_hours: elapsedHours,
      is_heavy: true,
      penalty: 0,
      reason: `inside ${input.cognitiveLoad.full_capacity_window_hours}h capacity window`,
    };
  }

  let penalty: number;
  if (input.cognitiveLoad.decay === "linear") {
    penalty = -Math.round(overshoot * input.cognitiveLoad.linear_penalty_per_hour);
  } else {
    // exponential: linear_penalty_per_hour × (base^overshoot - 1)
    // The "-1" makes overshoot=0 produce 0 (continuity with linear at the boundary).
    const factor =
      Math.pow(input.cognitiveLoad.exponential_base, overshoot) - 1;
    penalty = -Math.round(input.cognitiveLoad.linear_penalty_per_hour * factor);
  }

  return {
    severity: "soft",
    elapsed_hours: elapsedHours,
    is_heavy: true,
    penalty,
    reason: `heavy task at ${elapsedHours.toFixed(1)}h past anchor (window ${input.cognitiveLoad.full_capacity_window_hours}h, ${input.cognitiveLoad.decay} decay)`,
  };
}
