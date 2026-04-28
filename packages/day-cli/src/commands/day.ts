import {
  appendPlacementLog,
  compilePolicy,
  FsDayStore,
  generateEntityId,
  readPolicyYaml,
  replanDay,
  ScaffoldError,
  syncConflicts,
  type Conflict,
  defaultHomeDir,
  detectConflicts,
} from "@scaffold/day-core";
import type { Command } from "../cli/command";
import { emitDryRun, isDryRun } from "../cli/runtime";
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
    if (sub === "replan") return runDayReplan(args.slice(1));
    throw usage(`day: unknown subcommand '${sub}'`);
  },
};

async function runDayReplan(args: string[]): Promise<number> {
  let date: string | undefined;
  let scope: "flexible_only" | "all_unlocked" = "flexible_only";
  let json = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? "";
    if (!date && !a.startsWith("--")) { date = a; continue; }
    if (a === "--scope") {
      const v = args[i + 1];
      if (v !== "flexible_only" && v !== "all_unlocked") {
        throw usage("--scope must be flexible_only or all_unlocked");
      }
      scope = v;
      i++;
    } else if (a === "--json") {
      json = true;
    } else throw usage(`day replan: unexpected argument '${a}'`);
  }
  if (!date) throw usage("day replan: <YYYY-MM-DD> argument is required");
  if (!ISO_DATE_RE.test(date)) {
    throw new ScaffoldError({
      code: "DAY_INVALID_INPUT",
      summary: { en: `invalid date '${date}'` },
      cause: "Date must match YYYY-MM-DD.",
      try: ["Pass a string like 2026-04-27."],
    });
  }

  const home = defaultHomeDir();
  const yaml = await readPolicyYaml(home);
  if (!yaml) {
    throw new ScaffoldError({
      code: "DAY_NOT_INITIALIZED",
      summary: { en: "no policy/current.yaml yet" },
      cause: "day replan needs the policy.",
      try: ["Run `scaffold-day policy preset apply balanced`."],
    });
  }
  const policy = compilePolicy(yaml);
  const dayStore = new FsDayStore(home);
  const day = await dayStore.readDay(date);

  const outcome = replanDay(day, policy, scope);

  if (isDryRun()) {
    emitDryRun(json, {
      command: "day replan",
      writes: [
        { path: `days/${date.slice(0, 7)}/${date}.json`, op: "update" },
        { path: "logs/placement.jsonl", op: "update" },
        ...(outcome.dropped.length > 0
          ? ([
              { path: `conflicts/${date.slice(0, 7)}.json`, op: "update" },
              { path: "logs/conflict.jsonl", op: "update" },
            ] as const)
          : []),
      ],
      result: {
        date,
        scope,
        moved: outcome.moved.length,
        dropped: outcome.dropped.length,
        final_placements: outcome.final_placements.length,
        outcome,
      },
    });
    return 0;
  }

  // Apply: write back the new placements, log moves, emit conflicts for drops.
  const at = new Date().toISOString();
  for (const move of outcome.moved) {
    await appendPlacementLog(home, {
      schema_version: "0.1.0",
      at,
      action: "overridden",
      placement_id: move.placement.id,
      todo_id: move.placement.todo_id,
      date,
      start: move.placement.start,
      end: move.placement.end,
      by: "auto",
      policy_hash: move.placement.policy_hash ?? null,
      reason: `replan ${scope}`,
      previous: move.previous,
    });
  }
  for (const drop of outcome.dropped) {
    await appendPlacementLog(home, {
      schema_version: "0.1.0",
      at,
      action: "removed",
      placement_id: drop.id,
      todo_id: drop.todo_id,
      date,
      start: drop.start,
      end: drop.end,
      by: "auto",
      policy_hash: drop.policy_hash ?? null,
      reason: `replan ${scope} dropped`,
      previous: { start: drop.start, end: drop.end },
    });
  }
  day.placements = outcome.final_placements;
  await dayStore.writeDay(day);

  // Synthetic dropped conflicts.
  if (outcome.dropped.length > 0) {
    const dropped: Conflict[] = outcome.dropped.map((p) => ({
      id: generateEntityId("conflict"),
      date,
      kind: "capacity_exceeded" as const,
      detected_at: at,
      detector: "replan",
      party_ids: [p.id],
      detail: `replan(${scope}) could not fit placement ${p.id} (${p.duration_min} min) — original ${p.start}-${p.end}`,
      hard_rule_kind: null,
      status: "open" as const,
      resolved_at: null,
      resolved_by: null,
      resolution: null,
    }));
    const detected = [
      ...detectConflicts({ ...day, placements: outcome.final_placements }, policy, {
        detector: "replan",
      }),
      ...dropped,
    ];
    const { openIdsForDate } = await syncConflicts(home, date, detected);
    day.conflicts_open = openIdsForDate;
    await dayStore.writeDay(day);
  } else {
    const detected = detectConflicts(
      { ...day, placements: outcome.final_placements },
      policy,
      { detector: "replan" },
    );
    const { openIdsForDate } = await syncConflicts(home, date, detected);
    day.conflicts_open = openIdsForDate;
    await dayStore.writeDay(day);
  }

  if (json) {
    console.log(JSON.stringify({
      date,
      scope,
      kept: outcome.kept_in_place.length,
      moved: outcome.moved.length,
      dropped: outcome.dropped.length,
      moves: outcome.moved.map((m) => ({
        id: m.placement.id,
        previous: m.previous,
        next: { start: m.placement.start, end: m.placement.end },
      })),
      dropped_ids: outcome.dropped.map((d) => d.id),
    }, null, 2));
    return 0;
  }
  console.log(`scaffold-day day replan ${date}`);
  console.log(`  scope:     ${scope}`);
  console.log(`  kept:      ${outcome.kept_in_place.length}`);
  console.log(`  moved:     ${outcome.moved.length}`);
  console.log(`  dropped:   ${outcome.dropped.length}`);
  for (const m of outcome.moved) {
    console.log(`    ${m.placement.id}  ${m.previous.start} → ${m.placement.start}`);
  }
  for (const d of outcome.dropped) {
    console.log(`    DROPPED  ${d.id}  (${d.start})`);
  }
  return 0;
}
