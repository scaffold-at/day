import type { Day, FixedEvent, FreeSlot, Placement } from "@scaffold/day-core";
import { computeFreeSlots } from "@scaffold/day-core";
import { colors } from "../cli/colors";
import { defaultWorkingWindow, type WorkingWindow } from "./working-window";

export type DayView = {
  date: string;
  tz: string;
  events: FixedEvent[];
  placements: Placement[];
  free_slots: FreeSlot[];
  conflicts_open: string[];
  summary: {
    events_count: number;
    placements_count: number;
    free_slots_count: number;
    conflicts_open_count: number;
  };
};

const HHMM_FALLBACK = "—:—";

function formatLocalTime(iso: string, tz: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return HHMM_FALLBACK;
  try {
    const fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    return fmt.format(new Date(ms));
  } catch {
    return HHMM_FALLBACK;
  }
}

function pad(s: string, n: number): string {
  if (s.length >= n) return s;
  return s + " ".repeat(n - s.length);
}

export function buildDayView(day: Day, hintTz?: string): DayView {
  const ww: WorkingWindow = defaultWorkingWindow(day.date, hintTz);
  const free = computeFreeSlots(day, {
    windowStart: ww.windowStart,
    windowEnd: ww.windowEnd,
    protectedRanges: ww.protectedRanges,
    gridMin: 30,
    bufferMin: 0,
  });
  return {
    date: day.date,
    tz: ww.tz,
    events: [...day.events].sort((a, b) => a.start.localeCompare(b.start)),
    placements: [...day.placements].sort((a, b) => a.start.localeCompare(b.start)),
    free_slots: free,
    conflicts_open: [...day.conflicts_open],
    summary: {
      events_count: day.events.length,
      placements_count: day.placements.length,
      free_slots_count: free.length,
      conflicts_open_count: day.conflicts_open.length,
    },
  };
}

export function renderDayViewJson(view: DayView): string {
  return JSON.stringify(view, null, 2);
}

export function renderDayView(view: DayView): string {
  const lines: string[] = [];
  const rule = "─".repeat(46);

  lines.push(colors.cyan(rule));
  lines.push(colors.bold(`${view.date} · ${view.tz}`));
  lines.push(colors.cyan(rule));

  if (view.events.length > 0) {
    lines.push("");
    lines.push(colors.bold("Events"));
    for (const e of view.events) {
      const time = `${formatLocalTime(e.start, view.tz)}-${formatLocalTime(e.end, view.tz)}`;
      const label = colors.cyan("[event]");
      const where = e.location ? colors.dim(` @ ${e.location}`) : "";
      lines.push(`  ${pad(time, 12)} ${label}    ${e.title}${where}`);
    }
  }

  if (view.placements.length > 0) {
    lines.push("");
    lines.push(colors.bold("Placements"));
    for (const p of view.placements) {
      const time = `${formatLocalTime(p.start, view.tz)}-${formatLocalTime(p.end, view.tz)}`;
      const lock = p.locked ? colors.dim(" (locked)") : "";
      const label = colors.emerald("[place]");
      const tags = p.tags.length > 0 ? colors.dim(` ${p.tags.join(" ")}`) : "";
      lines.push(`  ${pad(time, 12)} ${label}    ${p.title}${lock}${tags}`);
    }
  }

  if (view.free_slots.length > 0) {
    lines.push("");
    lines.push(colors.bold("Free"));
    for (const f of view.free_slots) {
      const time = `${formatLocalTime(f.start, view.tz)}-${formatLocalTime(f.end, view.tz)}`;
      const label = colors.amber(`[free ${f.duration_min}m]`);
      lines.push(`  ${pad(time, 12)} ${label}`);
    }
  }

  if (view.conflicts_open.length > 0) {
    lines.push("");
    lines.push(colors.bold("Open conflicts"));
    for (const id of view.conflicts_open) {
      lines.push(`  ${colors.red("[conflict]")} ${id}`);
    }
  }

  lines.push("");
  lines.push(
    colors.dim(
      `Summary: ${view.summary.events_count} event${view.summary.events_count === 1 ? "" : "s"}, ${view.summary.placements_count} placement${view.summary.placements_count === 1 ? "" : "s"}, ${view.summary.free_slots_count} free slot${view.summary.free_slots_count === 1 ? "" : "s"}, ${view.summary.conflicts_open_count} open conflict${view.summary.conflicts_open_count === 1 ? "" : "s"}.`,
    ),
  );

  return lines.join("\n");
}

export type WeekDaySummary = {
  date: string;
  events_count: number;
  placements_count: number;
  free_slots_count: number;
  conflicts_open_count: number;
};

export function renderWeek(
  weekStart: string,
  weekEnd: string,
  tz: string,
  days: WeekDaySummary[],
): string {
  const lines: string[] = [];
  const rule = "─".repeat(46);
  lines.push(colors.cyan(rule));
  lines.push(colors.bold(`${weekStart} → ${weekEnd} · ${tz}`));
  lines.push(colors.cyan(rule));
  lines.push("");
  for (const d of days) {
    const cells = `events: ${String(d.events_count).padStart(2)}   placements: ${String(d.placements_count).padStart(2)}   free: ${String(d.free_slots_count).padStart(2)}   conflicts: ${String(d.conflicts_open_count).padStart(2)}`;
    lines.push(`  ${d.date}   ${cells}`);
  }
  return lines.join("\n");
}
