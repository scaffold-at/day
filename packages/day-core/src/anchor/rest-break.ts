/**
 * Rest-break suggestion (PRD v0.2 §S61, design issue #2).
 *
 * If the user slept less than `sleep_budget.min_hours` last night —
 * computed from yesterday's anchor → today's anchor as a 24h-shifted
 * pair — emit a soft suggestion to insert a short rest break into
 * today.
 *
 * Computation is *volatile* (no on-disk record). Every call to today
 * / get_rest_suggestions recomputes against the latest heartbeat
 * data and policy, so the suggestion reflects current state. v0.2
 * intentionally does not track dismiss state — a future slice can
 * layer it on if dogfooding shows the suggestion is noisy.
 *
 * Defaults (capture-by-comment so the next dogfood pass can tune):
 *   default_break_minutes = 20            — short enough to slot into
 *                                            most lunch / mid-day gaps
 *   suggested_window = "afternoon"        — UX-side hint only
 *   only_when_below_min = true            — ≥ min implies enough rest
 *
 * Pure helper; no I/O.
 */

import type { SleepBudget } from "../policy";
import type { HeartbeatEntry } from "./anchor";

export type RestSuggestionInput = {
  /** Today's anchor (any source). null → can't compute */
  todayAnchor: HeartbeatEntry | null;
  /** Yesterday's anchor (any source). null → can't compute */
  yesterdayAnchor: HeartbeatEntry | null;
  budget: SleepBudget | null;
};

export type RestSuggestion = {
  /** True only when measured sleep < `budget.min_hours`. */
  suggest: boolean;
  /** Measured sleep in hours, or null when unable to compute. */
  measured_sleep_hours: number | null;
  /** Minutes the suggested break would be (default 20). 0 when no suggestion. */
  break_min: number;
  /** Why we did or did not suggest, in one sentence. */
  reason: string;
};

const DEFAULT_BREAK_MIN = 20;

export function computeRestSuggestion(
  input: RestSuggestionInput,
): RestSuggestion {
  if (!input.budget) {
    return {
      suggest: false,
      measured_sleep_hours: null,
      break_min: 0,
      reason: "sleep_budget not configured",
    };
  }
  if (!input.todayAnchor || !input.yesterdayAnchor) {
    return {
      suggest: false,
      measured_sleep_hours: null,
      break_min: 0,
      reason: "need both yesterday + today anchors to measure sleep",
    };
  }

  const todayMs = Date.parse(input.todayAnchor.anchor);
  const yesterdayMs = Date.parse(input.yesterdayAnchor.anchor);
  if (!Number.isFinite(todayMs) || !Number.isFinite(yesterdayMs)) {
    return {
      suggest: false,
      measured_sleep_hours: null,
      break_min: 0,
      reason: "anchor instants malformed",
    };
  }

  // The two anchors mark "started today" instants. The sleep window
  // between them is approximated as the gap minus a typical
  // wake-active block. We approximate sleep = (today anchor) -
  // (yesterday anchor) - 16h (typical awake stretch). Negative or
  // tiny values mean either yesterday's anchor is the wrong one or
  // the user pulled an all-nighter; cap at 0 and let it surface.
  const TYPICAL_AWAKE_HOURS = 16;
  const gapHours = (todayMs - yesterdayMs) / (60 * 60 * 1000);
  const measuredSleep = Math.max(0, gapHours - TYPICAL_AWAKE_HOURS);

  if (measuredSleep >= input.budget.min_hours) {
    return {
      suggest: false,
      measured_sleep_hours: measuredSleep,
      break_min: 0,
      reason: `slept ~${measuredSleep.toFixed(1)}h ≥ min ${input.budget.min_hours}h`,
    };
  }

  return {
    suggest: true,
    measured_sleep_hours: measuredSleep,
    break_min: DEFAULT_BREAK_MIN,
    reason: `slept ~${measuredSleep.toFixed(1)}h < min ${input.budget.min_hours}h — suggesting ${DEFAULT_BREAK_MIN}-min rest`,
  };
}
