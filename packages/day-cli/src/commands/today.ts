import {
  FsDayStore,
  ScaffoldError,
  compilePolicy,
  computeRestSuggestion,
  defaultHomeDir,
  readAnchorForDate,
  readPolicyYaml,
  todayInTz,
} from "@scaffold/day-core";
import type { Command } from "../cli/command";
import {
  buildDayView,
  renderDayView,
  renderDayViewJson,
  type DayViewAnchor,
} from "../format/day-view";

function todayDate(tz?: string): string {
  // ISO calendar date in the user's TZ. Honors SCAFFOLD_DAY_NOW
  // through core's todayInTz so tests can pin "today".
  return todayInTz(
    tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
}

/** Shift a YYYY-MM-DD date by `delta` days (negative = past). */
function shiftDate(date: string, delta: number): string {
  const ms = Date.parse(`${date}T00:00:00Z`);
  return new Date(ms + delta * 86_400_000).toISOString().slice(0, 10);
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
    const home = defaultHomeDir();
    const store = new FsDayStore(home);
    const day = await store.readDay(date);
    const heartbeat = await readAnchorForDate(home, date);
    const anchor: DayViewAnchor = heartbeat
      ? { anchor: heartbeat.anchor, source: heartbeat.source }
      : null;

    // S61 rest-break: compare yesterday's anchor to today's against
    // sleep_budget. Volatile — recomputed every call.
    let rest = null;
    try {
      const yamlText = await readPolicyYaml(home);
      const budget = yamlText
        ? compilePolicy(yamlText).context.sleep_budget ?? null
        : null;
      const yesterday = shiftDate(date, -1);
      const yesterdayHb = await readAnchorForDate(home, yesterday);
      rest = computeRestSuggestion({
        todayAnchor: heartbeat,
        yesterdayAnchor: yesterdayHb,
        budget,
      });
    } catch {
      // home not initialized or policy malformed — skip suggestion
    }

    const view = buildDayView(day, tz, anchor, rest);
    if (json) {
      console.log(renderDayViewJson(view));
    } else {
      console.log(renderDayView(view));
    }
    return 0;
  },
};
