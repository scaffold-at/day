import type { FixedEvent, Placement } from "../day";
import type { HardRule, Policy } from "../policy";

export type CandidateSlot = {
  start: string;
  end: string;
  duration_min: number;
};

export type HardRuleContext = {
  /** Date the slot belongs to, YYYY-MM-DD. */
  date: string;
  /** Tags carried by the todo we're trying to place. */
  todoTags: readonly string[];
  /** Existing fixed events on the day. */
  events: readonly FixedEvent[];
  /** Existing placements on the day. */
  placements: readonly Placement[];
  /** Resolved working-window TZ offset (e.g. "+09:00"). Anchors HH:MM rule values to the slot's date. */
  tzOffset: string;
};

export type HardRuleViolation = {
  rule: HardRule;
  reason: string;
};

export type HardRuleEvaluation =
  | { ok: true }
  | { ok: false; violations: HardRuleViolation[] };

const MS_PER_MIN = 60_000;

function ms(iso: string): number {
  return Date.parse(iso);
}

function rangeMsForDay(
  date: string,
  hhmmStart: string,
  hhmmEnd: string,
  tz: string,
): Array<{ start: number; end: number }> {
  // A daily HH:MM-HH:MM rule applies once per calendar day. When end
  // > start it's a single contiguous interval; when end <= start the
  // rule wraps past midnight so on any given calendar day it covers
  // two intervals: [00:00, end) (early morning) and [start, 24:00)
  // (late night).
  const startToday = ms(`${date}T${hhmmStart}:00${tz}`);
  const endToday = ms(`${date}T${hhmmEnd}:00${tz}`);
  if (endToday > startToday) {
    return [{ start: startToday, end: endToday }];
  }
  const midnightStart = ms(`${date}T00:00:00${tz}`);
  const midnightEnd = midnightStart + 24 * 60 * MS_PER_MIN;
  return [
    { start: midnightStart, end: endToday },
    { start: startToday, end: midnightEnd },
  ];
}

function intervalsIntersect(
  a: { start: number; end: number },
  b: { start: number; end: number },
): boolean {
  return a.start < b.end && b.start < a.end;
}

function evaluateRule(
  rule: HardRule,
  slot: CandidateSlot,
  ctx: HardRuleContext,
): HardRuleViolation | null {
  const slotMs = { start: ms(slot.start), end: ms(slot.end) };

  switch (rule.kind) {
    case "no_placement_in": {
      const ranges = rangeMsForDay(ctx.date, rule.start, rule.end, ctx.tzOffset);
      for (const r of ranges) {
        if (intervalsIntersect(slotMs, r)) {
          return {
            rule,
            reason: `slot overlaps no_placement_in range ${rule.start}-${rule.end}`,
          };
        }
      }
      return null;
    }
    case "no_overlap_with_tag": {
      for (const e of ctx.events) {
        if (!e.tags.includes(rule.tag)) continue;
        if (intervalsIntersect(slotMs, { start: ms(e.start), end: ms(e.end) })) {
          return { rule, reason: `slot overlaps event tagged ${rule.tag}` };
        }
      }
      for (const p of ctx.placements) {
        if (!p.tags.includes(rule.tag)) continue;
        if (intervalsIntersect(slotMs, { start: ms(p.start), end: ms(p.end) })) {
          return { rule, reason: `slot overlaps placement tagged ${rule.tag}` };
        }
      }
      return null;
    }
    case "min_buffer_around_meeting_min": {
      const bufferMs = rule.minutes * MS_PER_MIN;
      for (const e of ctx.events) {
        const eStart = ms(e.start);
        const eEnd = ms(e.end);
        if (slotMs.end + bufferMs > eStart && slotMs.start < eStart) {
          return {
            rule,
            reason: `slot ends within ${rule.minutes} min of meeting '${e.title}'`,
          };
        }
        if (eEnd + bufferMs > slotMs.start && eEnd < slotMs.end) {
          return {
            rule,
            reason: `slot starts within ${rule.minutes} min of meeting '${e.title}'`,
          };
        }
      }
      return null;
    }
    case "duration_cap_per_day_min": {
      let placed = 0;
      for (const p of ctx.placements) {
        placed += p.duration_min;
      }
      if (placed + slot.duration_min > rule.minutes) {
        return {
          rule,
          reason: `placing this slot would exceed the daily cap of ${rule.minutes} min (already at ${placed} min)`,
        };
      }
      return null;
    }
    case "require_tag_in_range": {
      const ranges = rangeMsForDay(ctx.date, rule.start, rule.end, ctx.tzOffset);
      for (const r of ranges) {
        if (intervalsIntersect(slotMs, r)) {
          if (!ctx.todoTags.includes(rule.tag)) {
            return {
              rule,
              reason: `slot is inside ${rule.start}-${rule.end} which requires the ${rule.tag} tag`,
            };
          }
        }
      }
      return null;
    }
  }
}

/**
 * Evaluate every hard rule against a candidate slot. Returns
 * `{ ok: true }` if the slot survives, or `{ ok: false, violations }`
 * with every rule the slot violates (so AI clients can show all of
 * them at once, not one per fix loop).
 */
export function evaluateHardRules(
  slot: CandidateSlot,
  rules: ReadonlyArray<HardRule>,
  ctx: HardRuleContext,
): HardRuleEvaluation {
  const violations: HardRuleViolation[] = [];
  for (const rule of rules) {
    const v = evaluateRule(rule, slot, ctx);
    if (v) violations.push(v);
  }
  return violations.length === 0 ? { ok: true } : { ok: false, violations };
}

/** Convenience overload that pulls hard_rules out of a Policy. */
export function evaluateHardRulesPolicy(
  slot: CandidateSlot,
  policy: Policy,
  ctx: HardRuleContext,
): HardRuleEvaluation {
  return evaluateHardRules(slot, policy.hard_rules, ctx);
}
