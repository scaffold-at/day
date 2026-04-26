import {
  FsDayStore,
  ScaffoldError,
  defaultHomeDir,
} from "@scaffold/day-core";
import type { Command } from "../cli/command";

const YYYYMM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function usage(message: string): ScaffoldError {
  return new ScaffoldError({
    code: "DAY_USAGE",
    summary: { en: message },
    cause: "See `scaffold-day day --help` for the full input contract.",
    try: ["Run `scaffold-day day --help`."],
  });
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
  if (!month) {
    throw usage("day overview: <month> argument is required (e.g. 2026-04)");
  }
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
  console.log(`scaffold-day day overview ${month}  (${manifest.days.length} day${manifest.days.length === 1 ? "" : "s"})`);
  for (const entry of manifest.days) {
    console.log(
      `  ${entry.date}   events: ${String(entry.event_count).padStart(2)}   placements: ${String(entry.placement_count).padStart(2)}   conflicts_open: ${String(entry.conflicts_open_count).padStart(2)}`,
    );
  }
  return 0;
}

export const dayCommand: Command = {
  name: "day",
  summary: "explore day partitions (months / overview, plus get/range/today/week later)",
  help: {
    what: "Read-only navigation over the days/ tree. v0.1 ships `day months` (list partitions) and `day overview <month>` (per-day counts). `day get` / `day range` and the human-friendly `today` / `week` views land in §S12.",
    when: "When you want a quick, AI-friendly summary of which days have data and how busy each is.",
    cost: "Local file I/O. `months` reads each month's manifest; `overview` reads one manifest. No detail files are touched.",
    input: "months\noverview <YYYY-MM>",
    return: "Exit 0 on success. DAY_USAGE if a subcommand is missing. DAY_INVALID_INPUT on bad month strings. Output is human-formatted; structured `--json` arrives with §S12.",
    gotcha: "Manifests are auto-rewritten on every Day write — they should never lag. If they do, run `scaffold-day rebuild-index` (placeholder; landing per §S2). Tracking SLICES.md §S10 (manifest), §S12 (full day views).",
  },
  run: async (args) => {
    const sub = args[0];
    if (sub === undefined || sub === "") {
      throw usage("day: missing subcommand. try `day months` or `day overview <YYYY-MM>`");
    }
    if (sub === "months") return runDayMonths();
    if (sub === "overview") return runDayOverview(args.slice(1));
    throw usage(`day: unknown subcommand '${sub}'`);
  },
};
