import { FsDayStore, ScaffoldError, defaultHomeDir } from "@scaffold/day-core";
import type { Command } from "../cli/command";
import {
  buildDayView,
  renderWeek,
  type WeekDaySummary,
} from "../format/day-view";

function shiftDays(date: string, delta: number): string {
  const ms = Date.parse(`${date}T00:00:00Z`);
  const next = new Date(ms + delta * 86_400_000);
  return next.toISOString().slice(0, 10);
}

export const weekCommand: Command = {
  name: "week",
  summary: "show a 7-day overview anchored at today (or --start)",
  help: {
    what: "Print a one-line-per-day summary of the next 7 days starting from today (or --start), with event / placement / free-slot / open-conflict counts.",
    when: "Quick weekly orientation. For one-day detail use `scaffold-day today` or `day get`.",
    cost: "Local: reads up to 7 day files, runs a free-slot computation per day. No network.",
    input: "[--start <YYYY-MM-DD>] to anchor the window. [--json] for structured output. [--tz <iana>].",
    return: "Exit 0. Human format = 7 lines + header. JSON has days[] with the same counts.",
    gotcha: "Working window defaults to 09:00-18:00 system TZ until Policy lands (§S13). Tracking SLICES.md §S12.",
  },
  run: async (args) => {
    let start: string | undefined;
    let tz: string | undefined;
    let json = false;

    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === "--start") {
        const next = args[i + 1];
        if (!next) throw badUsage("--start requires a YYYY-MM-DD value");
        start = next;
        i++;
      } else if (a === "--tz") {
        const next = args[i + 1];
        if (!next) throw badUsage("--tz requires a value");
        tz = next;
        i++;
      } else if (a === "--json") {
        json = true;
      } else {
        throw badUsage(`week: unexpected argument '${a}'`);
      }
    }

    if (!start) {
      const fmt = new Intl.DateTimeFormat("en-CA", {
        timeZone: tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
      start = fmt.format(new Date());
    }

    const store = new FsDayStore(defaultHomeDir());
    const summaries: WeekDaySummary[] = [];
    for (let i = 0; i < 7; i++) {
      const date = shiftDays(start, i);
      const day = await store.readDay(date);
      const view = buildDayView(day, tz);
      summaries.push({
        date,
        events_count: view.summary.events_count,
        placements_count: view.summary.placements_count,
        free_slots_count: view.summary.free_slots_count,
        conflicts_open_count: view.summary.conflicts_open_count,
      });
    }
    const weekEnd = shiftDays(start, 6);
    const resolvedTz =
      tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";

    if (json) {
      console.log(
        JSON.stringify(
          { week_start: start, week_end: weekEnd, tz: resolvedTz, days: summaries },
          null,
          2,
        ),
      );
    } else {
      console.log(renderWeek(start, weekEnd, resolvedTz, summaries));
    }
    return 0;
  },
};

function badUsage(message: string): ScaffoldError {
  return new ScaffoldError({
    code: "DAY_USAGE",
    summary: { en: message },
    cause: "Run `scaffold-day week --help` for the full input contract.",
    try: ["Run `scaffold-day week --help`."],
  });
}
