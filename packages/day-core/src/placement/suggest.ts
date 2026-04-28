import { computeFreeSlots, type Day, type FreeSlot } from "../day";
import type { Policy } from "../policy";
import type { DayOfWeek } from "../policy";
import {
  type CandidateSlot,
  evaluateHardRules,
  type HardRuleViolation,
} from "./hard-rules";
import {
  evaluateSleepBudget,
  projectAnchorForDate,
  type SleepBudgetEvaluation,
} from "./sleep-budget";
import {
  computeReactivityPenalty,
  evaluateSoftPreferencesPolicy,
  type SoftPreferenceContribution,
} from "./soft-preferences";

export type SuggestionInput = {
  todo: {
    id: string;
    tags: readonly string[];
    duration_min: number;
    importance_score: number;
  };
  /** Day files keyed by `YYYY-MM-DD`, in the order they should be considered. */
  daysByDate: ReadonlyMap<string, Day>;
  policy: Policy;
  /** How many top-ranked candidates to keep. */
  max?: number;
  /**
   * Recorded morning anchor for the *earliest* day in `daysByDate`.
   * Used to project a per-day anchor for sleep_budget evaluation
   * (S58). Pass `null` to skip budget evaluation entirely.
   */
  anchor?: { date: string; anchor: string } | null;
};

export type CandidateBreakdown = {
  rank: number;
  date: string;
  start: string;
  end: string;
  duration_min: number;
  score: number;
  importance: number;
  soft_total: number;
  reactivity_penalty: number;
  contributions: SoftPreferenceContribution[];
  rationale: string;
  /** S58: sleep budget evaluation result. `null` when budget skipped. */
  sleep_budget?: SleepBudgetEvaluation | null;
};

export type Suggestion = {
  todo_id: string;
  duration_min: number;
  importance_score: number;
  candidates: CandidateBreakdown[];
  /** Populated when `candidates` is empty; aggregates the reasons. */
  no_fit_reason: string | null;
};

const DOW_NAMES: DayOfWeek[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
// Note: getUTCDay() returns 0=Sun..6=Sat; we use Intl with the policy
// TZ to pick the right calendar day-of-week.

function offsetFor(date: string, tz: string): string {
  try {
    const sample = new Date(`${date}T12:00:00Z`);
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "shortOffset",
      hour: "numeric",
    });
    const part = fmt.formatToParts(sample).find((p) => p.type === "timeZoneName");
    if (!part || part.value === "GMT") return "+00:00";
    const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(part.value);
    if (!m) return "+00:00";
    const sign = m[1] ?? "+";
    const hh = (m[2] ?? "0").padStart(2, "0");
    const mm = (m[3] ?? "00").padStart(2, "0");
    return `${sign}${hh}:${mm}`;
  } catch {
    return "+00:00";
  }
}

function dayOfWeek(date: string, tz: string): DayOfWeek {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "long",
    });
    const name = fmt.format(new Date(`${date}T12:00:00Z`)).toLowerCase();
    if (name.startsWith("sun")) return "sun";
    if (name.startsWith("mon")) return "mon";
    if (name.startsWith("tue")) return "tue";
    if (name.startsWith("wed")) return "wed";
    if (name.startsWith("thu")) return "thu";
    if (name.startsWith("fri")) return "fri";
    return "sat";
  } catch {
    const idx = new Date(`${date}T12:00:00Z`).getUTCDay();
    return DOW_NAMES[idx] ?? "mon";
  }
}

function workingWindow(
  date: string,
  policy: Policy,
): { windowStart: string; windowEnd: string; tzOffset: string } | null {
  const tzOffset = offsetFor(date, policy.context.tz);
  const dow = dayOfWeek(date, policy.context.tz);
  for (const wh of policy.context.working_hours) {
    if (wh.days.includes(dow)) {
      return {
        windowStart: `${date}T${wh.start}:00${tzOffset}`,
        windowEnd: `${date}T${wh.end}:00${tzOffset}`,
        tzOffset,
      };
    }
  }
  return null;
}

function protectedRangesForDate(
  date: string,
  policy: Policy,
  tzOffset: string,
): Array<{ start: string; end: string; label: string }> {
  const dow = dayOfWeek(date, policy.context.tz);
  const out: Array<{ start: string; end: string; label: string }> = [];
  for (const r of policy.context.protected_ranges) {
    if (!r.days.includes(dow)) continue;
    out.push({
      start: `${date}T${r.start}:00${tzOffset}`,
      end: `${date}T${r.end}:00${tzOffset}`,
      label: r.label,
    });
  }
  return out;
}

function generateCandidates(
  freeSlots: FreeSlot[],
  durationMin: number,
  gridMin: number,
): CandidateSlot[] {
  const out: CandidateSlot[] = [];
  const stepMs = gridMin * 60_000;
  const durMs = durationMin * 60_000;
  for (const slot of freeSlots) {
    let cursor = Date.parse(slot.start);
    const end = Date.parse(slot.end);
    while (cursor + durMs <= end) {
      out.push({
        start: new Date(cursor).toISOString(),
        end: new Date(cursor + durMs).toISOString(),
        duration_min: durationMin,
      });
      cursor += stepMs;
    }
  }
  return out;
}

function summarizeViolations(violations: HardRuleViolation[]): string {
  return violations.map((v) => `${v.rule.kind}: ${v.reason}`).join("; ");
}

/**
 * Place-suggest orchestrator (PRD §10.2 + §S20).
 *
 *   for each provided day:
 *     resolve working_window (skip days without one)
 *     compute free slots (events + placements + protected_ranges as busy)
 *     enumerate candidate slots that fit todo.duration_min
 *     filter by Hard rules
 *     score = importance + soft.total + reactivity_penalty (0 for fresh)
 *   rank desc, take top `max` (default 5)
 *   if zero survive, populate no_fit_reason with the most common reason
 */
export function suggestPlacements(input: SuggestionInput): Suggestion {
  const max = input.max ?? 5;
  const ranked: CandidateBreakdown[] = [];
  const rejectionReasons: string[] = [];

  for (const [date, day] of input.daysByDate) {
    const ww = workingWindow(date, input.policy);
    if (!ww) {
      rejectionReasons.push(`${date}: no working hours configured for this weekday`);
      continue;
    }
    const protectedRanges = protectedRangesForDate(date, input.policy, ww.tzOffset);

    const free = computeFreeSlots(day, {
      windowStart: ww.windowStart,
      windowEnd: ww.windowEnd,
      protectedRanges,
      gridMin: input.policy.placement_grid_min,
      bufferMin: 0,
    });

    const candidates = generateCandidates(
      free,
      input.todo.duration_min,
      input.policy.placement_grid_min,
    );
    if (candidates.length === 0) {
      rejectionReasons.push(`${date}: no free interval long enough for ${input.todo.duration_min} min`);
      continue;
    }

    for (const cand of candidates) {
      const hard = evaluateHardRules(cand, input.policy.hard_rules, {
        date,
        todoTags: input.todo.tags,
        events: day.events,
        placements: day.placements,
        tzOffset: ww.tzOffset,
      });
      if (!hard.ok) {
        rejectionReasons.push(`${date} ${cand.start}: ${summarizeViolations(hard.violations)}`);
        continue;
      }

      // S58 sleep budget: hard violations reject; soft applies a
      // negative score contribution; ok / skip are pass-through.
      const budget = input.policy.context.sleep_budget ?? null;
      const anchorOnSlotDate = projectAnchorForDate({
        recordedAnchor: input.anchor ?? null,
        targetDate: date,
      });
      const sleep = evaluateSleepBudget({
        slot: { start: cand.start, end: cand.end },
        anchorOnSlotDate,
        events: day.events,
        placements: day.placements,
        budget,
      });
      if (sleep.severity === "hard") {
        rejectionReasons.push(`${date} ${cand.start}: sleep_budget ${sleep.reason}`);
        continue;
      }

      const soft = evaluateSoftPreferencesPolicy(cand, input.policy, {
        date,
        todoTags: input.todo.tags,
        events: day.events,
        placements: day.placements,
        tzOffset: ww.tzOffset,
      });
      const reactivity = computeReactivityPenalty(cand, input.policy.reactivity);
      const score =
        input.todo.importance_score +
        soft.total +
        reactivity +
        sleep.penalty;

      const sleepNote =
        sleep.severity === "soft"
          ? ` + sleep_budget(${sleep.penalty})`
          : "";
      const baseRationale =
        soft.contributions.length === 0
          ? `Importance ${input.todo.importance_score.toFixed(1)} carries the slot.`
          : `Importance ${input.todo.importance_score.toFixed(1)} + ${soft.contributions
              .map((c) => `${c.preference.kind}(${c.weight >= 0 ? "+" : ""}${c.weight})`)
              .join(", ")}`;

      ranked.push({
        rank: 0, // assigned after sort
        date,
        start: cand.start,
        end: cand.end,
        duration_min: cand.duration_min,
        score,
        importance: input.todo.importance_score,
        soft_total: soft.total,
        reactivity_penalty: reactivity,
        contributions: soft.contributions,
        rationale: `${baseRationale}${sleepNote}`,
        sleep_budget: budget && anchorOnSlotDate ? sleep : null,
      });
    }
  }

  ranked.sort((a, b) => b.score - a.score);
  const top = ranked.slice(0, max).map((c, i) => ({ ...c, rank: i + 1 }));

  let noFit: string | null = null;
  if (top.length === 0) {
    if (rejectionReasons.length === 0) {
      noFit = "No working days were provided.";
    } else {
      // Pick the 3 most informative reasons.
      noFit = rejectionReasons.slice(0, 3).join(" | ");
    }
  }

  return {
    todo_id: input.todo.id,
    duration_min: input.todo.duration_min,
    importance_score: input.todo.importance_score,
    candidates: top,
    no_fit_reason: noFit,
  };
}
