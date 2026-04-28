import {
  defaultHomeDir,
  FsDayStore,
  FsTodoRepository,
  ScaffoldError,
} from "@scaffold/day-core";
import type { Command } from "../cli/command";
import { emitDryRun, isDryRun } from "../cli/runtime";

type Scope = "todos" | "days" | "all";

function usage(message: string): ScaffoldError {
  return new ScaffoldError({
    code: "DAY_USAGE",
    summary: { en: message },
    cause: "See `scaffold-day rebuild-index --help` for the full input contract.",
    try: ["Run `scaffold-day rebuild-index --help`."],
  });
}

async function runRebuild(args: string[]): Promise<number> {
  let json = false;
  let scope: Scope = "all";
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? "";
    if (a === "--json") {
      json = true;
    } else if (a === "--scope") {
      const v = args[i + 1];
      if (v !== "todos" && v !== "days" && v !== "all") {
        throw new ScaffoldError({
          code: "DAY_INVALID_INPUT",
          summary: { en: "--scope must be todos|days|all" },
          cause: `Got: ${v ?? "(missing)"}`,
          try: ["Pass --scope todos, --scope days, or --scope all."],
        });
      }
      scope = v;
      i++;
    } else {
      throw usage(`rebuild-index: unexpected argument '${a}'`);
    }
  }

  const home = defaultHomeDir();
  const dry = isDryRun();

  const result: {
    todos?: { detail_count: number; added: number; removed: number; changed: number };
    days?: { months: string[]; entries: number };
  } = {};

  if (scope === "todos" || scope === "all") {
    const repo = new FsTodoRepository(home);
    const r = await repo.rebuildIndex({ dryRun: dry });
    result.todos = {
      detail_count: r.detail_count,
      added: r.drift.added.length,
      removed: r.drift.removed.length,
      changed: r.drift.changed.length,
    };
  }

  if (scope === "days" || scope === "all") {
    const store = new FsDayStore(home);
    const months = await store.listMonths();
    let entries = 0;
    for (const month of months) {
      const dates = await store.listMonth(month);
      entries += dates.length;
      if (!dry) await store.refreshManifest(month);
    }
    result.days = { months, entries };
  }

  const writes: Array<{ path: string; op: "create" | "update" | "delete" }> = [];
  if (result.todos) writes.push({ path: "todos/active/index.json", op: "update" });
  if (result.days) {
    for (const m of result.days.months) {
      writes.push({ path: `days/${m}/manifest.json`, op: "update" });
    }
  }

  if (dry) {
    emitDryRun(json, {
      command: "rebuild-index",
      writes,
      result,
    });
    return 0;
  }

  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }

  console.log("scaffold-day rebuild-index");
  if (result.todos) {
    const t = result.todos;
    const driftHint =
      t.added + t.removed + t.changed > 0
        ? ` (drift: +${t.added} -${t.removed} ~${t.changed})`
        : " (no drift)";
    console.log(`  todos/active/index.json: ${t.detail_count} entries${driftHint}`);
  }
  if (result.days) {
    console.log(`  days manifests: ${result.days.months.length} months, ${result.days.entries} day files`);
  }
  return 0;
}

export const rebuildIndexCommand: Command = {
  name: "rebuild-index",
  summary: "rebuild local indexes from source-of-truth files",
  help: {
    what: "Recompute todos/active/index.json from per-id detail files, and days/<YYYY-MM>/manifest.json from per-day files. Used after manual edits, partial restores, or when `doctor` flags drift.",
    when: "After hand-editing files under <home>/, after a backup restore, or when `doctor` reports inconsistency.",
    cost: "Reads every TODO and day file once. Atomic write of the new index / manifests. Bound by disk speed.",
    input: "[--scope todos|days|all] (default all) [--json] [--dry-run]",
    return: "Exit 0 with counts of rebuilt indexes + a drift summary (added / removed / changed). Detail files are never modified — they are the source of truth.",
    gotcha: "Drift counts > 0 mean the index was out of sync with the detail files. v0.2 doesn't hold the advisory lock yet (S2 lock + this slice's coordination lands in a v0.3 followup); avoid running while the MCP server actively writes.",
  },
  run: async (args) => runRebuild(args),
};
