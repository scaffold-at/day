import type { FixedEvent, Placement } from "../day";
import type { Policy, ReactivityLevel, SoftPreference } from "../policy";
import type { CandidateSlot } from "./hard-rules";

export type SoftPreferenceContext = {
  date: string;
  todoTags: readonly string[];
  events: readonly FixedEvent[];
  placements: readonly Placement[];
  tzOffset: string;
};

export type SoftPreferenceContribution = {
  preference: SoftPreference;
  /** Signed weighted contribution (e.g. `+20` for an applied positive prefer, `-15` for a negative avoid). */
  weight: number;
  /** Short note for breakdown / explain output. */
  note: string;
};

export type SoftPreferenceEvaluation = {
  total: number;
  contributions: SoftPreferenceContribution[];
};

const MS_PER_MIN = 60_000;

function ms(iso: string): number {
  return Date.parse(iso);
}

function rangesForDay(
  date: string,
  hhmmStart: string,
  hhmmEnd: string,
  tz: string,
): Array<{ start: number; end: number }> {
  const startMs = ms(`${date}T${hhmmStart}:00${tz}`);
  const endMs = ms(`${date}T${hhmmEnd}:00${tz}`);
  if (endMs > startMs) return [{ start: startMs, end: endMs }];
  const midnightStart = ms(`${date}T00:00:00${tz}`);
  const midnightEnd = midnightStart + 24 * 60 * MS_PER_MIN;
  return [
    { start: midnightStart, end: endMs },
    { start: startMs, end: midnightEnd },
  ];
}

function intersects(
  a: { start: number; end: number },
  b: { start: number; end: number },
): boolean {
  return a.start < b.end && b.start < a.end;
}

function applyPref(
  pref: SoftPreference,
  slot: CandidateSlot,
  ctx: SoftPreferenceContext,
): SoftPreferenceContribution | null {
  const slotMs = { start: ms(slot.start), end: ms(slot.end) };

  switch (pref.kind) {
    case "prefer_tag_in_range": {
      if (!ctx.todoTags.includes(pref.tag)) return null;
      const ranges = rangesForDay(ctx.date, pref.start, pref.end, ctx.tzOffset);
      for (const r of ranges) {
        if (intersects(slotMs, r)) {
          return {
            preference: pref,
            weight: pref.weight,
            note: `${pref.tag} fits ${pref.start}-${pref.end} (+${pref.weight})`,
          };
        }
      }
      return null;
    }
    case "avoid_back_to_back_after_min": {
      const limitMs = pref.minutes * MS_PER_MIN;
      for (const p of ctx.placements) {
        const pEnd = ms(p.end);
        const gap = slotMs.start - pEnd;
        if (gap >= 0 && gap < limitMs) {
          return {
            preference: pref,
            weight: pref.weight,
            note: `back-to-back with placement ending at ${p.end} (within ${pref.minutes} min) (${pref.weight >= 0 ? "+" : ""}${pref.weight})`,
          };
        }
      }
      return null;
    }
    case "cluster_same_tag": {
      for (const p of ctx.placements) {
        if (p.tags.some((t) => ctx.todoTags.includes(t))) {
          // Bonus when there's a tag-sharing placement on the same day.
          return {
            preference: pref,
            weight: pref.weight,
            note: `clusters with existing placement sharing a tag (+${pref.weight})`,
          };
        }
      }
      return null;
    }
    case "avoid_tag_after_time": {
      if (!ctx.todoTags.includes(pref.tag)) return null;
      const cutoffMs = ms(`${ctx.date}T${pref.after}:00${ctx.tzOffset}`);
      if (slotMs.start >= cutoffMs) {
        return {
          preference: pref,
          weight: pref.weight,
          note: `${pref.tag} after ${pref.after} (${pref.weight >= 0 ? "+" : ""}${pref.weight})`,
        };
      }
      return null;
    }
    case "energy_peak_bonus": {
      // Caller passes the energy_peak ranges through context; here we
      // approximate via Policy.context — but to keep this evaluator
      // standalone, the caller injects `events` only. Energy peaks
      // come in via the Policy-aware overload below.
      return null;
    }
  }
}

/**
 * Standalone evaluator. `energy_peak_bonus` is a no-op here because
 * energy peaks live on `Policy.context`; use `evaluateSoftPreferencesPolicy`
 * for that variant or inject explicit ranges.
 */
export function evaluateSoftPreferences(
  slot: CandidateSlot,
  preferences: ReadonlyArray<SoftPreference>,
  ctx: SoftPreferenceContext,
): SoftPreferenceEvaluation {
  const contributions: SoftPreferenceContribution[] = [];
  for (const pref of preferences) {
    const c = applyPref(pref, slot, ctx);
    if (c) contributions.push(c);
  }
  const total = contributions.reduce((sum, c) => sum + c.weight, 0);
  return { total, contributions };
}

/**
 * Policy-aware overload: also resolves `energy_peak_bonus` against
 * `policy.context.energy_peaks`.
 */
export function evaluateSoftPreferencesPolicy(
  slot: CandidateSlot,
  policy: Policy,
  ctx: SoftPreferenceContext,
): SoftPreferenceEvaluation {
  const baseline = evaluateSoftPreferences(slot, policy.soft_preferences, ctx);
  const slotMs = { start: ms(slot.start), end: ms(slot.end) };

  for (const pref of policy.soft_preferences) {
    if (pref.kind !== "energy_peak_bonus") continue;
    for (const peak of policy.context.energy_peaks) {
      const ranges = rangesForDay(ctx.date, peak.start, peak.end, ctx.tzOffset);
      for (const r of ranges) {
        if (intersects(slotMs, r)) {
          baseline.contributions.push({
            preference: pref,
            weight: pref.weight,
            note: `inside energy peak ${peak.start}-${peak.end} (+${pref.weight})`,
          });
          baseline.total += pref.weight;
          break; // count peak bonus at most once per slot
        }
      }
    }
  }

  return baseline;
}

/**
 * Reactivity penalty (PRD §10.1 + §S39).
 *
 * Applied when re-planning shakes up *existing* placements. For a
 * fresh placement (none disturbed), the penalty is 0. The magnitude
 * scales with how many locked placements would need to move to make
 * room — `low` reactivity treats locked moves as expensive (large
 * negative penalty), `high` as cheap.
 */
const REACTIVITY_BASE: Record<ReactivityLevel, number> = {
  low: -25,
  balanced: -10,
  high: -3,
};

export function computeReactivityPenalty(
  slot: CandidateSlot,
  reactivity: ReactivityLevel,
  options: { displacedLockedCount?: number; displacedTotalCount?: number } = {},
): number {
  const lockedDisplaced = options.displacedLockedCount ?? 0;
  const totalDisplaced = options.displacedTotalCount ?? 0;
  if (lockedDisplaced === 0 && totalDisplaced === 0) return 0;
  const base = REACTIVITY_BASE[reactivity];
  // Locked displacements weigh 4x unlocked.
  return base * (4 * lockedDisplaced + (totalDisplaced - lockedDisplaced));
}
