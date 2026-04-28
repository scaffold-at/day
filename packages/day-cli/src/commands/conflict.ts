import {
  appendConflictLog,
  type Conflict,
  ConflictStatusSchema,
  compilePolicy,
  defaultHomeDir,
  detectConflicts,
  FsDayStore,
  readConflicts,
  readPolicyYaml,
  ScaffoldError,
  syncConflicts,
  writeConflicts,
} from "@scaffold/day-core";
import type { Command } from "../cli/command";
import { emitDryRun, isDryRun } from "../cli/runtime";

const YYYYMM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function usage(message: string): ScaffoldError {
  return new ScaffoldError({
    code: "DAY_USAGE",
    summary: { en: message },
    cause: "See `scaffold-day conflict --help` for the full input contract.",
    try: ["Run `scaffold-day conflict --help`."],
  });
}

async function runList(args: string[]): Promise<number> {
  let month: string | undefined;
  let status: "all" | "open" | "resolved" | "ignored" = "open";
  let json = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? "";
    if (a === "--month") { month = args[i + 1]; i++; }
    else if (a === "--status") {
      const v = args[i + 1];
      if (v !== "all" && v !== "open" && v !== "resolved" && v !== "ignored") {
        throw usage("--status must be all|open|resolved|ignored");
      }
      status = v;
      i++;
    } else if (a === "--json") { json = true; }
    else throw usage(`conflict list: unexpected argument '${a}'`);
  }

  const home = defaultHomeDir();
  const dayStore = new FsDayStore(home);

  const months = month ? [month] : await dayStore.listMonths();
  if (month && !YYYYMM_RE.test(month)) {
    throw new ScaffoldError({
      code: "DAY_INVALID_INPUT",
      summary: { en: `invalid --month '${month}'` },
      cause: "Month must match YYYY-MM.",
      try: ["Pass --month 2026-04."],
    });
  }
  const all: Conflict[] = [];
  for (const m of months) {
    const partition = await readConflicts(home, m);
    for (const c of partition.conflicts) {
      if (status === "all" || c.status === status) all.push(c);
    }
  }
  all.sort((a, b) => a.date.localeCompare(b.date));

  if (json) {
    console.log(JSON.stringify({ items: all, total: all.length }, null, 2));
    return 0;
  }
  if (all.length === 0) {
    console.log("scaffold-day conflict list");
    console.log("  (no conflicts match)");
    return 0;
  }
  console.log("scaffold-day conflict list");
  for (const c of all) {
    console.log(
      `  ${c.id}  [${c.status.padEnd(8)}] ${c.date}  ${c.kind.padEnd(20)}  ${c.detail}`,
    );
  }
  return 0;
}

async function runResolve(args: string[]): Promise<number> {
  let id: string | undefined;
  let statusInput: string | undefined;
  let reason: string | undefined;
  let by = "user";
  let json = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? "";
    if (!id && !a.startsWith("--")) { id = a; continue; }
    if (a === "--status") { statusInput = args[i + 1]; i++; }
    else if (a === "--reason") { reason = args[i + 1]; i++; }
    else if (a === "--by") { by = args[i + 1] ?? "user"; i++; }
    else if (a === "--json") { json = true; }
    else throw usage(`conflict resolve: unexpected argument '${a}'`);
  }
  if (!id) throw usage("conflict resolve: <id> argument is required");
  if (!statusInput) throw usage("conflict resolve: --status resolved|ignored is required");
  if (statusInput !== "resolved" && statusInput !== "ignored") {
    throw usage("conflict resolve: --status must be resolved|ignored");
  }
  const newStatus = ConflictStatusSchema.parse(statusInput);

  const home = defaultHomeDir();
  const dayStore = new FsDayStore(home);

  // Find the conflict by scanning month partitions.
  const months = await dayStore.listMonths();
  let found: { conflict: Conflict; month: string } | null = null;
  for (const m of months) {
    const partition = await readConflicts(home, m);
    const c = partition.conflicts.find((x) => x.id === id);
    if (c) {
      found = { conflict: c, month: m };
      break;
    }
  }
  if (!found) {
    throw new ScaffoldError({
      code: "DAY_NOT_FOUND",
      summary: { en: `conflict '${id}' not found` },
      cause: "No conflict partition contains this id.",
      try: ["Run `scaffold-day conflict list --status all` to inspect."],
      context: { id },
    });
  }
  if (found.conflict.status !== "open") {
    throw new ScaffoldError({
      code: "DAY_INVALID_INPUT",
      summary: { en: `conflict '${id}' is already ${found.conflict.status}` },
      cause: "Only open conflicts can be resolved or ignored.",
      try: ["Pick another conflict id."],
      context: { id, status: found.conflict.status },
    });
  }

  const now = new Date().toISOString();

  if (isDryRun()) {
    emitDryRun(json, {
      command: "conflict resolve",
      writes: [
        { path: `conflicts/${found.month}.json`, op: "update" },
        { path: `days/${found.conflict.date.slice(0, 7)}/${found.conflict.date}.json`, op: "update" },
        { path: "logs/conflict.jsonl", op: "update" },
      ],
      result: { id, status: newStatus, reason: reason ?? null, by, at: now },
    });
    return 0;
  }

  const partition = await readConflicts(home, found.month);
  partition.conflicts = partition.conflicts.map((c) =>
    c.id === id
      ? {
          ...c,
          status: newStatus,
          resolved_at: now,
          resolved_by: by,
          resolution: { note: reason ?? null },
        }
      : c,
  );
  await writeConflicts(home, partition);

  // Also refresh the day's conflicts_open if status is changing away from open.
  const day = await dayStore.readDay(found.conflict.date);
  day.conflicts_open = day.conflicts_open.filter((cid) => cid !== id);
  await dayStore.writeDay(day);

  await appendConflictLog(home, {
    schema_version: "0.1.0",
    at: now,
    action: newStatus === "ignored" ? "ignored" : "resolved",
    conflict_id: id,
    date: found.conflict.date,
    kind: found.conflict.kind,
    party_ids: [...found.conflict.party_ids],
    by,
    reason: reason ?? null,
    resolution: { note: reason ?? null },
  });

  if (json) {
    console.log(JSON.stringify({ id, status: newStatus, reason: reason ?? null }, null, 2));
    return 0;
  }
  console.log("scaffold-day conflict resolve");
  console.log(`  id:     ${id}`);
  console.log(`  status: ${newStatus}`);
  if (reason) console.log(`  reason: ${reason}`);
  return 0;
}

async function runDetect(args: string[]): Promise<number> {
  let date: string | undefined;
  let json = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? "";
    if (!date && !a.startsWith("--")) { date = a; continue; }
    if (a === "--json") json = true;
    else throw usage(`conflict detect: unexpected argument '${a}'`);
  }
  if (!date) throw usage("conflict detect: <YYYY-MM-DD> argument is required");

  const home = defaultHomeDir();
  const yaml = await readPolicyYaml(home);
  if (!yaml) {
    throw new ScaffoldError({
      code: "DAY_NOT_INITIALIZED",
      summary: { en: "no policy/current.yaml yet" },
      cause: "conflict detect needs the policy.",
      try: ["Run `scaffold-day policy preset apply balanced`."],
    });
  }
  const policy = compilePolicy(yaml);
  const dayStore = new FsDayStore(home);
  const day = await dayStore.readDay(date);
  const detected = detectConflicts(day, policy);

  if (isDryRun()) {
    emitDryRun(json, {
      command: "conflict detect",
      writes: [
        { path: `conflicts/${date.slice(0, 7)}.json`, op: "update" },
        { path: `days/${date.slice(0, 7)}/${date}.json`, op: "update" },
        { path: "logs/conflict.jsonl", op: "update" },
      ],
      result: { date, detected_count: detected.length, detected },
    });
    return 0;
  }

  const { openIdsForDate } = await syncConflicts(home, date, detected);

  // Update day.conflicts_open and write back.
  day.conflicts_open = openIdsForDate;
  await dayStore.writeDay(day);

  // Append "detected" log entries for fresh ones.
  const partition = await readConflicts(home, date.slice(0, 7));
  const at = new Date().toISOString();
  for (const c of partition.conflicts) {
    if (c.date !== date) continue;
    if (c.status !== "open") continue;
    if (Math.abs(Date.parse(c.detected_at) - Date.parse(at)) < 5_000) {
      await appendConflictLog(home, {
        schema_version: "0.1.0",
        at,
        action: "detected",
        conflict_id: c.id,
        date,
        kind: c.kind,
        party_ids: [...c.party_ids],
        by: "system",
        reason: null,
        resolution: null,
      });
    }
  }

  if (json) {
    console.log(JSON.stringify({ date, open: openIdsForDate.length, ids: openIdsForDate }, null, 2));
    return 0;
  }
  console.log(`scaffold-day conflict detect ${date}`);
  console.log(`  open conflicts: ${openIdsForDate.length}`);
  for (const cid of openIdsForDate) {
    console.log(`    ${cid}`);
  }
  return 0;
}

export const conflictCommand: Command = {
  name: "conflict",
  summary: "list / resolve / detect scheduling conflicts",
  help: {
    what: "Inspect, resolve, or trigger detection of conflicts. Conflicts are detected automatically when `place do` / `place override` writes the day file; this command is the user-facing surface for them.",
    when: "When `today` shows open conflicts, or after a manual edit you want to verify.",
    cost: "Local file I/O over `<home>/conflicts/<YYYY-MM>.json` and the day files.",
    input: "list [--month <YYYY-MM>] [--status open|resolved|ignored|all] [--json]\nresolve <id> --status resolved|ignored [--reason <T>] [--by <attr>] [--json]\ndetect <YYYY-MM-DD> [--json]",
    return: "Exit 0. DAY_NOT_INITIALIZED if no policy. DAY_NOT_FOUND for unknown conflict. DAY_INVALID_INPUT on bad month / non-open conflict.",
    gotcha: "v0.1 `resolve` records the decision and clears `day.conflicts_open` but does NOT mutate the underlying placements — use `place override` for the actual move/remove. Auto-resolve lands in v0.2. Tracking SLICES.md §S24 (cmd) / §S23 (detection).",
  },
  run: async (args) => {
    const sub = args[0];
    if (!sub) throw usage("conflict: missing subcommand. try `conflict list`");
    const rest = args.slice(1);
    if (sub === "list") return runList(rest);
    if (sub === "resolve") return runResolve(rest);
    if (sub === "detect") return runDetect(rest);
    throw usage(`conflict: unknown subcommand '${sub}'`);
  },
};
