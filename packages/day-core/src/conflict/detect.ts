import { type Day } from "../day";
import { generateEntityId } from "../ids/entity-id";
import { evaluateHardRules } from "../placement/hard-rules";
import { type Policy } from "../policy";
import { type Conflict } from "./conflict";

const MS_PER_MIN = 60_000;

function ms(iso: string): number {
  return Date.parse(iso);
}

function offsetFromIso(iso: string): string {
  if (iso.endsWith("Z")) return "+00:00";
  const m = /([+-]\d{2}):?(\d{2})$/.exec(iso);
  if (!m) return "+00:00";
  return `${m[1]}:${m[2]}`;
}

function intersects(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * Detect conflicts on a single Day under a Policy (PRD §10.4 + SLICES §S23).
 *
 *   overlap              — two placements overlap, or a placement
 *                          overlaps a fixed event.
 *   hard_rule_violation  — an existing placement now violates a hard
 *                          rule (e.g. user changed policy after placing).
 *   buffer_breach        — a placement violates the
 *                          min_buffer_around_meeting_min rule (kept as
 *                          a separate kind from hard_rule_violation
 *                          per PRD ergonomics).
 *   capacity_exceeded    — total placed minutes for the day breaches
 *                          duration_cap_per_day_min.
 *
 * v0.1 detects only; auto-resolve lands in v0.2.
 */
export function detectConflicts(
  day: Day,
  policy: Policy,
  options: { detector?: string } = {},
): Conflict[] {
  const detector = options.detector ?? "system";
  const detectedAt = new Date().toISOString();
  const conflicts: Conflict[] = [];

  // ── overlap (placement ↔ placement and placement ↔ event) ──────
  for (let i = 0; i < day.placements.length; i++) {
    const a = day.placements[i]!;
    const aMs = { start: ms(a.start), end: ms(a.end) };

    for (let j = i + 1; j < day.placements.length; j++) {
      const b = day.placements[j]!;
      if (intersects(aMs, { start: ms(b.start), end: ms(b.end) })) {
        conflicts.push({
          id: generateEntityId("conflict"),
          date: day.date,
          kind: "overlap",
          detected_at: detectedAt,
          detector,
          party_ids: [a.id, b.id],
          detail: `placements ${a.id} and ${b.id} overlap`,
          hard_rule_kind: null,
          status: "open",
          resolved_at: null,
          resolved_by: null,
          resolution: null,
        });
      }
    }

    for (const e of day.events) {
      const eMs = { start: ms(e.start), end: ms(e.end) };
      if (intersects(aMs, eMs)) {
        conflicts.push({
          id: generateEntityId("conflict"),
          date: day.date,
          kind: "overlap",
          detected_at: detectedAt,
          detector,
          party_ids: [a.id, e.id],
          detail: `placement ${a.id} overlaps event '${e.title}'`,
          hard_rule_kind: null,
          status: "open",
          resolved_at: null,
          resolved_by: null,
          resolution: null,
        });
      }
    }
  }

  // ── hard_rule_violation + buffer_breach ────────────────────────
  for (const p of day.placements) {
    const tzOffset = offsetFromIso(p.start);
    const hardCheck = evaluateHardRules(
      { start: p.start, end: p.end, duration_min: p.duration_min },
      policy.hard_rules,
      {
        date: day.date,
        todoTags: p.tags,
        events: day.events,
        // Pass other placements as context (not the one we're checking).
        placements: day.placements.filter((o) => o.id !== p.id),
        tzOffset,
      },
    );
    if (!hardCheck.ok) {
      for (const v of hardCheck.violations) {
        const isBuffer = v.rule.kind === "min_buffer_around_meeting_min";
        conflicts.push({
          id: generateEntityId("conflict"),
          date: day.date,
          kind: isBuffer ? "buffer_breach" : "hard_rule_violation",
          detected_at: detectedAt,
          detector,
          party_ids: [p.id],
          detail: v.reason,
          hard_rule_kind: v.rule.kind,
          status: "open",
          resolved_at: null,
          resolved_by: null,
          resolution: null,
        });
      }
    }
  }

  // ── capacity_exceeded ──────────────────────────────────────────
  const cap = policy.hard_rules.find((r) => r.kind === "duration_cap_per_day_min");
  if (cap && cap.kind === "duration_cap_per_day_min") {
    const total = day.placements.reduce((sum, p) => sum + p.duration_min, 0);
    if (total > cap.minutes) {
      conflicts.push({
        id: generateEntityId("conflict"),
        date: day.date,
        kind: "capacity_exceeded",
        detected_at: detectedAt,
        detector,
        party_ids: day.placements.map((p) => p.id),
        detail: `placed ${total} min > daily cap ${cap.minutes} min`,
        hard_rule_kind: "duration_cap_per_day_min",
        status: "open",
        resolved_at: null,
        resolved_by: null,
        resolution: null,
      });
    }
  }

  return conflicts;
  // Note on `MS_PER_MIN`: imported indirectly through ms(); kept top-level for future extension.
  void MS_PER_MIN;
}
