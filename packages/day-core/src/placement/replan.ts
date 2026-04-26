import { type Day, type Placement } from "../day";
import { type Policy } from "../policy";
import { suggestPlacements } from "./suggest";

export type ReplanScope = "flexible_only" | "all_unlocked";

export type ReplanOutcome = {
  /** Placements that survived in their original slot (locked or out of scope). */
  kept_in_place: Placement[];
  /** Placements that moved to a new slot. */
  moved: Array<{ placement: Placement; previous: { start: string; end: string } }>;
  /** Placements that no longer fit. They are removed from the day; the
   * caller should emit conflicts for them. */
  dropped: Placement[];
  /** Final placements list to write back to the Day. */
  final_placements: Placement[];
};

function isMovable(p: Placement, scope: ReplanScope): boolean {
  if (p.locked) return false;
  if (scope === "flexible_only") return p.placed_by !== "user";
  return true; // all_unlocked
}

/**
 * Pure replan. Given a Day + Policy + scope, decide which placements
 * stay, which move, and which drop. The caller writes the result back
 * to disk and emits conflicts for the dropped set (§S23/§S24).
 *
 * Greedy algorithm:
 *   1. Partition placements into kept (locked / out of scope) and pool
 *      (movable).
 *   2. Sort pool by importance desc (most important goes first).
 *   3. Start from `kept` as the day's busy set; for each pool item run
 *      suggestPlacements against the in-progress day. Take the top
 *      candidate; if none, drop. Append the chosen placement so the
 *      next iteration sees it as busy.
 */
export function replanDay(
  day: Day,
  policy: Policy,
  scope: ReplanScope = "flexible_only",
): ReplanOutcome {
  const kept: Placement[] = [];
  const pool: Placement[] = [];
  for (const p of day.placements) {
    if (isMovable(p, scope)) pool.push(p);
    else kept.push(p);
  }

  pool.sort((a, b) => {
    const aS = a.importance_at_placement?.score ?? a.importance_score ?? 0;
    const bS = b.importance_at_placement?.score ?? b.importance_score ?? 0;
    return bS - aS;
  });

  const finalPlacements: Placement[] = [...kept];
  const moved: ReplanOutcome["moved"] = [];
  const dropped: Placement[] = [];

  for (const p of pool) {
    const previous = { start: p.start, end: p.end };
    // Build a Day snapshot with the placements committed so far.
    const dayState: Day = { ...day, placements: [...finalPlacements] };
    const suggestion = suggestPlacements({
      todo: {
        id: p.todo_id,
        tags: p.tags,
        duration_min: p.duration_min,
        importance_score: p.importance_at_placement?.score ?? p.importance_score ?? 0,
      },
      daysByDate: new Map([[day.date, dayState]]),
      policy,
      max: 1,
    });
    const top = suggestion.candidates[0];
    if (!top) {
      dropped.push(p);
      continue;
    }
    const movedPlacement: Placement = {
      ...p,
      start: top.start,
      end: top.end,
    };
    finalPlacements.push(movedPlacement);
    if (movedPlacement.start !== previous.start || movedPlacement.end !== previous.end) {
      moved.push({ placement: movedPlacement, previous });
    }
  }

  // Sort final by start time for friendlier output.
  finalPlacements.sort((a, b) => a.start.localeCompare(b.start));

  return {
    kept_in_place: kept,
    moved,
    dropped,
    final_placements: finalPlacements,
  };
}
