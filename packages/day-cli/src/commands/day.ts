import {
  FsDayStore,
  ScaffoldError,
  defaultHomeDir,
} from "@scaffold/day-core";
import type { Command } from "../cli/command";
import {
  buildDayView,
  renderDayView,
  renderDayViewJson,
  renderWeek,
  type WeekDaySummary,
} from "../format/day-view";

const YYYYMM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function usage(message: string): ScaffoldError {
  return new ScaffoldError({
    code: "DAY_USAGE",
    summary: { en: message },
    cause: "See `scaffold-day day --help` for the full input contract.",
    try: ["Run `scaffold-day day --help`."],
  });
}

function shiftDays(date: string, delta: number): string {
  const ms = Date.parse(`${date}T00:00:00Z`);
  const next = new Date(ms + delta * 86_400_000);
  return next.toISOString().slice(0, 10);
}

type CommonFlags = { json: boolean; tz: string | undefined };
function parseCommonFlags(args: string[]): { positional: string[]; flags: CommonFlags } {
  const positional: string[] = [];
  let json = false;
  let tz: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? "";
    if (a === "--json") {
      json = true;
    } else if (a === "--tz") {
      const next = args[i + 1];
      if (!next) throw usage("--tz requires a value (IANA timezone)");
      tz = next;
      i++;
    } else if (a.startsWith("--")) {
      throw usage(`day: unknown option '${a}'`);
    } else {
      positional.push(a);
    }
  }
  return { positional, flags: { json, tz } };
}

async function runDayMonths(): Promise<number> {
  const store = new FsDayStore(defaultHomeDir());
  const months = await store.listMonths();
  if (months.length === 0) {
    console.log("scaffold-day day months");
    console.log("  (no day files yet — add one with `scaffold-day event add ...`)");
    return 0;
  }
  console.log("scaffold-day day months");
  for (const month of months) {
    const manifest = await store.readManifest(month);
    const dayCount = manifest?.days.length ?? 0;
    console.log(`  ${month}  (${dayCount} day${dayCount === 1 ? "" : "s"})`);
  }
  return 0;
}

async function runDayOverview(args: string[]): Promise<number> {
  const month = args[0];
  if (!month) throw usage("day overview: <month> argument is required (e.g. 2026-04)");
  if (!YYYYMM_RE.test(month)) {
    throw new ScaffoldError({
      code: "DAY_INVALID_INPUT",
      summary: { en: `invalid month '${month}'` },
      cause: "Month must match YYYY-MM.",
      try: ["Pass a string like 2026-04."],
      context: { month },
    });
  }
  const store = new FsDayStore(defaultHomeDir());
  const manifest = await store.readManifest(month);
  if (!manifest) {
    console.log(`scaffold-day day overview ${month}`);
    console.log("  (no manifest yet — add an event in this month with `scaffold-day event add ...`)");
    return 0;
  }
  console.log(
    `scaffold-day day overview ${month}  (${manifest.days.length} day${manifest.days.length === 1 ? "" : "s"})`,
  );
  for (const entry of manifest.days) {
    console.log(
      `  ${entry.date}   events: ${String(entry.event_count).padStart(2)}   placements: ${String(entry.placement_count).padStart(2)}   conflicts_open: ${String(entry.conflicts_open_count).padStart(2)}`,
    );
  }
  return 0;
}

async function runDayGet(args: string[]): Promise<number> {
  const { positional, flags } = parseCommonFlags(args);
  const date = positional[0];
  if (!date) throw usage("day get: <date> argument is required (YYYY-MM-DD)");
  if (!ISO_DATE_RE.test(date)) {
    throw new ScaffoldError({
      code: "DAY_INVALID_INPUT",
      summary: { en: `invalid date '${date}'` },
      cause: "Date must match YYYY-MM-DD.",
      try: ["Pass a string like 2026-04-26."],
      context: { date },
    });
  }
  const store = new FsDayStore(defaultHomeDir());
  const day = await store.readDay(date);
  const view = buildDayView(day, flags.tz);
  if (flags.json) {
    console.log(renderDayViewJson(view));
  } else {
    console.log(renderDayView(view));
  }
  return 0;
}

async function runDayRange(args: string[]): Promise<number> {
  const { positional, flags } = parseCommonFlags(args);
  const start = positional[0];
  const end = positional[1];
  if (!start || !end) throw usage("day range: <start> <end> arguments are required (YYYY-MM-DD each)");
  if (!ISO_DATE_RE.test(start) || !ISO_DATE_RE.test(end)) {
    throw new ScaffoldError({
      code: "DAY_INVALID_INPUT",
      summary: { en: "day range: <start> and <end> must be YYYY-MM-DD" },
      cause: "Both arguments must look like 2026-04-26.",
      try: ["Use ISO calendar dates."],
      context: { start, end },
    });
  }
  if (Date.parse(`${end}T00:00:00Z`) < Date.parse(`${start}T00:00:00Z`)) {
    throw new ScaffoldError({
      code: "DAY_INVALID_INPUT",
      summary: { en: "day range: <end> must be on or after <start>" },
      cause: `start: ${start}\nend:   ${end}`,
      try: ["Swap the arguments."],
      context: { start, end },
    });
  }

  const store = new FsDayStore(defaultHomeDir());
  const summaries: WeekDaySummary[] = [];
  let cursor = start;
  let safety = 0;
  while (cursor <= end && safety < 366) {
    const day = await store.readDay(cursor);
    const view = buildDayView(day, flags.tz);
    summaries.push({
      date: cursor,
      events_count: view.summary.events_count,
      placements_count: view.summary.placements_count,
      free_slots_count: view.summary.free_slots_count,
      conflicts_open_count: view.summary.conflicts_open_count,
    });
    cursor = shiftDays(cursor, 1);
    safety++;
  }

  const tz = flags.tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
  if (flags.json) {
    console.log(
      JSON.stringify(
        { range_start: start, range_end: end, tz, days: summaries },
        null,
        2,
      ),
    );
  } else {
    console.log(renderWeek(start, end, tz, summaries));
  }
  return 0;
}

export const dayCommand: Command = {
  name: "day",
  summary: "explore day partitions (months / overview / get / range)",
  help: {
    what: "Read-only navigation over the days/ tree. Sub-commands: `months` (list partitions), `overview <YYYY-MM>` (per-day counts), `get <YYYY-MM-DD>` (full view), `range <start> <end>` (compact list).",
    when: "When you want a quick AI-friendly summary or a one-day detail view.",
    cost: "Local file I/O. `get` and per-day computation in `range` recompute free slots each call.",
    input: "months\noverview <YYYY-MM>\nget <YYYY-MM-DD> [--json] [--tz <iana>]\nrange <start> <end> [--json] [--tz <iana>]",
    return: "Exit 0 on success. DAY_USAGE on missing args. DAY_INVALID_INPUT on bad date / month strings. `--json` returns the structured DayView (or range summary).",
    gotcha: "Manifests are auto-rewritten on every Day write. Working window defaults to 09:00-18:00 system TZ; lunch 12:00-13:00 protected (until Policy lands per §S13). Tracking SLICES.md §S10 (manifest), §S12 (views).",
  },
  run: async (args) => {
    const sub = args[0];
    if (sub === undefined || sub === "") {
      throw usage("day: missing subcommand. try `day months`, `day overview <YYYY-MM>`, `day get <YYYY-MM-DD>`, or `day range <start> <end>`");
    }
    if (sub === "months") return runDayMonths();
    if (sub === "overview") return runDayOverview(args.slice(1));
    if (sub === "get") return runDayGet(args.slice(1));
    if (sub === "range") return runDayRange(args.slice(1));
    throw usage(`day: unknown subcommand '${sub}'`);
  },
};
