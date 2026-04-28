/**
 * Sleep budget evaluation (PRD v0.2 §S58, design issue #2).
 *
 * The relative time model: instead of pinning sleep to absolute clock
 * times, the user declares how many hours they need ("min_hours") and
 * how many they prefer ("target_hours"). Each candidate slot is then
 * evaluated for the *implied* sleep window between the day's last
 * activity (slot.end / latest event / latest placement) and the next
 * anchor estimate (today's anchor + 24h).
 *
 *   implied < min_hours    → hard violation (reject)
 *   min ≤ implied < target → soft penalty proportional to the gap
 *   implied ≥ target       → ok, no contribution
 *
 * Anchor handling:
 *   - When no anchor is recorded for the slot's date, evaluation is
 *     skipped (`severity: "skip"`); the engine falls back to v0.1
 *     hard rules + soft preferences.
 *   - When a slot is on a *future* day relative to the anchor, the
 *     anchor at slot.date is estimated as anchor + N*24h.
 *
 * Free of any I/O — pure scoring helper.
 */

import type { FixedEvent, Placement } from "../day";
import type { SleepBudget } from "../policy";

export type SleepBudgetSeverity = "ok" | "soft" | "hard" | "skip";

export type SleepBudgetEvaluation = {
  severity: SleepBudgetSeverity;
  /** Hours from the day's last activity to the projected next anchor. */
  implied_sleep_hours: number;
  /** Soft penalty score contribution; ≤ 0 always. 0 when ok / hard / skip. */
  penalty: number;
  /** Why we landed where we did, in one English sentence. */
  reason: string;
};

export type SleepBudgetInput = {
  /**
   * The candidate slot's start/end as ISO 8601 instants. Only `end` is
   * used (the slot's contribution to "last activity"), but accepting
   * the full pair keeps callers future-proof.
   */
  slot: { start: string; end: string };
  /**
   * Anchor for the *slot's* date as ISO 8601 (with TZ) — if the
   * candidate is on date D, this is the anchor for D. Pass `null`
   * when no anchor is known; evaluation will skip.
   */
  anchorOnSlotDate: string | null;
  /**
   * Other commitments on the slot's date so we know the day's *true*
   * last activity (the slot might end at 18:00 but a meeting could
   * run until 19:30).
   */
  events: readonly FixedEvent[];
  placements: readonly Placement[];
  /** Policy field; pass null to skip evaluation. */
  budget: SleepBudget | null;
};

const HOURS = 60 * 60 * 1000;

export function evaluateSleepBudget(
  input: SleepBudgetInput,
): SleepBudgetEvaluation {
  if (!input.budget || !input.anchorOnSlotDate) {
    return {
      severity: "skip",
      implied_sleep_hours: Number.POSITIVE_INFINITY,
      penalty: 0,
      reason: "sleep budget not configured or anchor unknown",
    };
  }

  // Last activity on the slot's date is the latest of: slot end, any
  // event end, any placement end (excluding the slot's own placement
  // since the slot isn't placed yet).
  let lastActivityMs = Date.parse(input.slot.end);
  for (const e of input.events) {
    lastActivityMs = Math.max(lastActivityMs, Date.parse(e.end));
  }
  for (const p of input.placements) {
    lastActivityMs = Math.max(lastActivityMs, Date.parse(p.end));
  }

  // Project the next anchor: same wall-clock instant + 24h.
  const nextAnchorMs = Date.parse(input.anchorOnSlotDate) + 24 * HOURS;

  const sleepMs = nextAnchorMs - lastActivityMs;
  const implied = sleepMs / HOURS;

  if (implied < input.budget.min_hours) {
    return {
      severity: "hard",
      implied_sleep_hours: implied,
      penalty: 0,
      reason: `would leave ${implied.toFixed(1)}h before next anchor — under min ${input.budget.min_hours}h`,
    };
  }
  if (implied < input.budget.target_hours) {
    const shortfall = input.budget.target_hours - implied;
    const penalty = -Math.round(shortfall * input.budget.soft_penalty_per_hour);
    return {
      severity: "soft",
      implied_sleep_hours: implied,
      penalty,
      reason: `${implied.toFixed(1)}h sleep (target ${input.budget.target_hours}h, shortfall ${shortfall.toFixed(1)}h)`,
    };
  }
  return {
    severity: "ok",
    implied_sleep_hours: implied,
    penalty: 0,
    reason: `${implied.toFixed(1)}h sleep meets target`,
  };
}

/**
 * Build an "anchor for date D" projection from a single recorded
 * anchor. If recorded anchor's date matches `date`, returns it; if
 * `date` is later, projects forward by 24h per day. Returns `null`
 * when `recordedAnchor` is null or the date is *before* the recorded
 * one (we have no signal for the past).
 */
export function projectAnchorForDate(args: {
  recordedAnchor: { date: string; anchor: string } | null;
  targetDate: string;
}): string | null {
  if (!args.recordedAnchor) return null;
  const anchorMs = Date.parse(args.recordedAnchor.anchor);
  if (!Number.isFinite(anchorMs)) return null;
  const recordedDate = new Date(`${args.recordedAnchor.date}T00:00:00Z`).getTime();
  const targetDateMs = new Date(`${args.targetDate}T00:00:00Z`).getTime();
  if (targetDateMs < recordedDate) return null;
  const dayDelta = Math.round((targetDateMs - recordedDate) / (24 * HOURS));
  const projectedMs = anchorMs + dayDelta * 24 * HOURS;
  // Preserve the trailing TZ offset from recordedAnchor.anchor by
  // reusing its tail; convert the new instant to the same wall time
  // shift. Simplest: emit with the same offset suffix.
  const tail = args.recordedAnchor.anchor.match(/(Z|[+-]\d{2}:\d{2})$/)?.[0] ?? "Z";
  const projected = new Date(projectedMs);
  // Build the wall-clock string in the offset of `tail`.
  const offsetMin = tail === "Z" ? 0 : parseTzOffset(tail);
  const wallMs = projectedMs + offsetMin * 60 * 1000;
  const w = new Date(wallMs);
  const yyyy = w.getUTCFullYear();
  const mo = String(w.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(w.getUTCDate()).padStart(2, "0");
  const hh = String(w.getUTCHours()).padStart(2, "0");
  const mm = String(w.getUTCMinutes()).padStart(2, "0");
  const ss = String(w.getUTCSeconds()).padStart(2, "0");
  void projected;
  return `${yyyy}-${mo}-${dd}T${hh}:${mm}:${ss}${tail}`;
}

function parseTzOffset(s: string): number {
  // s is "+HH:MM" or "-HH:MM"
  const sign = s.startsWith("-") ? -1 : 1;
  const hh = Number.parseInt(s.slice(1, 3), 10);
  const mm = Number.parseInt(s.slice(4, 6), 10);
  return sign * (hh * 60 + mm);
}
