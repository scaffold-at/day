import type { Day } from "./day";

export type FreeSlot = {
  start: string;
  end: string;
  duration_min: number;
};

export type ComputeFreeSlotsOptions = {
  /** Open end of the working window (inclusive start, exclusive end). */
  windowStart: string | Date;
  /** Close end of the working window. */
  windowEnd: string | Date;
  /** Additional busy ranges (e.g. lunch / sleep / focus blocks). */
  protectedRanges?: ReadonlyArray<{
    start: string | Date;
    end: string | Date;
    label?: string;
  }>;
  /**
   * Grid resolution in minutes. Free slot start times are anchored at
   * `windowStart + N * gridMin`; slots shorter than `gridMin` are
   * dropped. Defaults to 30 (PRD §10.3 placement_grid_min default).
   */
  gridMin?: number;
  /** Buffer (minutes) added around every busy range before subtraction. */
  bufferMin?: number;
};

const MS_PER_MIN = 60_000;

function toMs(input: string | Date): number {
  if (input instanceof Date) return input.getTime();
  const parsed = Date.parse(input);
  if (!Number.isFinite(parsed)) {
    throw new TypeError(`could not parse datetime: ${String(input)}`);
  }
  return parsed;
}

type IntervalMs = { start: number; end: number };

function mergeBusyMs(busy: IntervalMs[]): IntervalMs[] {
  if (busy.length === 0) return [];
  const sorted = [...busy]
    .filter((b) => b.end > b.start)
    .sort((a, b) => a.start - b.start);
  const merged: IntervalMs[] = [];
  for (const b of sorted) {
    const last = merged.length > 0 ? merged[merged.length - 1] : undefined;
    if (last && b.start <= last.end) {
      last.end = Math.max(last.end, b.end);
    } else {
      merged.push({ start: b.start, end: b.end });
    }
  }
  return merged;
}

/**
 * Pure interval-arithmetic free-slot computation in epoch milliseconds.
 *
 * 1. Add the buffer to every busy range and merge overlaps.
 * 2. Subtract the merged busy ranges from the working window.
 * 3. Snap each remaining interval to the grid anchored at windowStart
 *    (start rounded UP, end rounded DOWN).
 * 4. Drop intervals shorter than gridMin minutes.
 */
export function computeFreeIntervalsMs(
  windowStart: number,
  windowEnd: number,
  busy: ReadonlyArray<IntervalMs>,
  options: { gridMin: number; bufferMin?: number },
): IntervalMs[] {
  if (windowEnd <= windowStart) return [];
  const gridMs = options.gridMin * MS_PER_MIN;
  const bufferMs = (options.bufferMin ?? 0) * MS_PER_MIN;

  const expanded: IntervalMs[] = busy.map((b) => ({
    start: b.start - bufferMs,
    end: b.end + bufferMs,
  }));
  const merged = mergeBusyMs(expanded);

  const free: IntervalMs[] = [];
  let cursor = windowStart;
  for (const b of merged) {
    if (b.end <= cursor) continue;
    if (b.start >= windowEnd) break;
    const segStart = Math.max(cursor, windowStart);
    const segEnd = Math.min(b.start, windowEnd);
    if (segEnd > segStart) free.push({ start: segStart, end: segEnd });
    cursor = Math.max(cursor, b.end);
    if (cursor >= windowEnd) break;
  }
  if (cursor < windowEnd) free.push({ start: cursor, end: windowEnd });

  const snapped: IntervalMs[] = [];
  for (const f of free) {
    const offsetStart = (f.start - windowStart) % gridMs;
    const startSnapped =
      offsetStart === 0 ? f.start : f.start + (gridMs - offsetStart);
    const offsetEnd = (f.end - windowStart) % gridMs;
    const endSnapped = f.end - offsetEnd;
    if (endSnapped - startSnapped >= gridMs) {
      snapped.push({ start: startSnapped, end: endSnapped });
    }
  }
  return snapped;
}

/**
 * Compute free slots for a Day (events + placements + protected
 * ranges become the busy set). Returned timestamps are ISO 8601 in
 * UTC (`Z` suffix); callers may format into the user's TZ for
 * human display.
 */
export function computeFreeSlots(
  day: Day,
  options: ComputeFreeSlotsOptions,
): FreeSlot[] {
  const windowStart = toMs(options.windowStart);
  const windowEnd = toMs(options.windowEnd);
  const gridMin = options.gridMin ?? 30;
  const bufferMin = options.bufferMin ?? 0;

  const busy: IntervalMs[] = [];
  for (const e of day.events) {
    busy.push({ start: toMs(e.start), end: toMs(e.end) });
  }
  for (const p of day.placements) {
    busy.push({ start: toMs(p.start), end: toMs(p.end) });
  }
  for (const r of options.protectedRanges ?? []) {
    busy.push({ start: toMs(r.start), end: toMs(r.end) });
  }

  const intervals = computeFreeIntervalsMs(windowStart, windowEnd, busy, {
    gridMin,
    bufferMin,
  });

  return intervals.map((i) => ({
    start: new Date(i.start).toISOString(),
    end: new Date(i.end).toISOString(),
    duration_min: Math.round((i.end - i.start) / MS_PER_MIN),
  }));
}
