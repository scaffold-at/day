import { FsDayStore, ScaffoldError, defaultHomeDir } from "@scaffold/day-core";
import type { Command } from "../cli/command";
import {
  buildDayView,
  renderDayView,
  renderDayViewJson,
} from "../format/day-view";

function todayDate(tz?: string): string {
  // ISO calendar date in the user's TZ.
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date());
}

export const todayCommand: Command = {
  name: "today",
  summary: "show today's events / placements / free slots in 40 lines or fewer",
  help: {
    what: "Render today's day file with events, placements, free slots (computed every call), and any open conflicts. Same data as `scaffold-day day get $(date +%Y-%m-%d)` but with a friendlier header.",
    when: "Whenever you want a quick snapshot of the day. AI clients should prefer the `--json` form for token efficiency.",
    cost: "Local read of one Day file plus a free-slot computation. No network.",
    input: "[--json] for structured output. [--tz <iana>] to override the resolved timezone.",
    return: "Exit 0. Human format ≤40 lines (PRD §6.3). JSON includes the freshly computed free_slots[] each time.",
    gotcha: "Working window defaults to 09:00-18:00 in the user's system TZ until Policy lands (§S13). Lunch 12:00-13:00 is protected. Tracking SLICES.md §S12.",
  },
  run: async (args) => {
    const json = args.includes("--json");
    let tz: string | undefined;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--tz") {
        const next = args[i + 1];
        if (!next) {
          throw new ScaffoldError({
            code: "DAY_USAGE",
            summary: { en: "--tz requires a value (e.g. Asia/Seoul)" },
            cause: "An IANA timezone name is required after --tz.",
            try: ["Pass --tz Asia/Seoul or --tz UTC."],
          });
        }
        tz = next;
        i++;
      } else if (args[i] === "--json") {
        // already captured
      } else {
        throw new ScaffoldError({
          code: "DAY_USAGE",
          summary: { en: `today: unexpected argument '${args[i]}'` },
          cause: "Run `scaffold-day today --help` for the full input contract.",
          try: ["Drop the unknown argument or use --json / --tz <iana>."],
        });
      }
    }

    const date = todayDate(tz);
    const store = new FsDayStore(defaultHomeDir());
    const day = await store.readDay(date);
    const view = buildDayView(day, tz);
    if (json) {
      console.log(renderDayViewJson(view));
    } else {
      console.log(renderDayView(view));
    }
    return 0;
  },
};
