import {
  compilePolicy,
  defaultHomeDir,
  FsDayStore,
  FsTodoRepository,
  type Placement,
  readPolicySnapshot,
  readPolicyYaml,
  ScaffoldError,
  suggestPlacements,
  type SuggestionInput,
  type Day,
} from "@scaffold/day-core";
import type { Command } from "../cli/command";

function usage(message: string): ScaffoldError {
  return new ScaffoldError({
    code: "DAY_USAGE",
    summary: { en: message },
    cause: "See `scaffold-day explain --help` for the full input contract.",
    try: ["Run `scaffold-day explain --help`."],
  });
}

async function runExplain(args: string[]): Promise<number> {
  let id: string | undefined;
  let json = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? "";
    if (!id && !a.startsWith("--")) { id = a; continue; }
    if (a === "--json") json = true;
    else throw usage(`explain: unexpected argument '${a}'`);
  }
  if (!id) throw usage("explain: <placement-id> argument is required");

  const home = defaultHomeDir();

  // Find the placement and the day it lives on.
  const dayStore = new FsDayStore(home);
  const months = await dayStore.listMonths();
  let foundPlacement: Placement | null = null;
  let foundDay: Day | null = null;
  outer: for (const m of months) {
    const dates = await dayStore.listMonth(m);
    for (const d of dates) {
      const day = await dayStore.readDay(d);
      const match = day.placements.find((p) => p.id === id);
      if (match) {
        foundPlacement = match;
        foundDay = day;
        break outer;
      }
    }
  }
  if (!foundPlacement || !foundDay) {
    throw new ScaffoldError({
      code: "DAY_NOT_FOUND",
      summary: { en: `placement '${id}' not found` },
      cause: "No day file under <home>/days/ contains a placement with this id.",
      try: ["Run `scaffold-day day overview <YYYY-MM>` to inspect."],
      context: { placement_id: id },
    });
  }

  // Resolve the policy in effect at placement time, then fall back to current.
  let policySnapshotMeta: { hash: string; captured_at: string } | null = null;
  let policy = null as ReturnType<typeof compilePolicy> | null;
  if (foundPlacement.policy_hash) {
    const snap = await readPolicySnapshot(home, foundPlacement.policy_hash);
    if (snap) {
      policy = snap.policy;
      policySnapshotMeta = { hash: snap.hash, captured_at: snap.captured_at };
    }
  }
  if (!policy) {
    const yaml = await readPolicyYaml(home);
    if (!yaml) {
      throw new ScaffoldError({
        code: "DAY_NOT_INITIALIZED",
        summary: { en: "no policy/current.yaml yet" },
        cause: "explain falls back to the current policy when the snapshot is missing.",
        try: ["Run `scaffold-day policy preset apply balanced`."],
      });
    }
    policy = compilePolicy(yaml);
  }

  // Re-rank candidates as they would have been at placement time.
  const todoRepo = new FsTodoRepository(home);
  const todoDetail = await todoRepo.getDetail(foundPlacement.todo_id);
  const importanceScore =
    foundPlacement.importance_at_placement?.score ??
    foundPlacement.importance_score ??
    todoDetail?.importance?.score ??
    todoDetail?.importance_score ??
    0;

  // Recreate the day at placement time by removing this placement.
  const dayWithoutThis: Day = {
    ...foundDay,
    placements: foundDay.placements.filter((p) => p.id !== foundPlacement!.id),
  };

  const input: SuggestionInput = {
    todo: {
      id: foundPlacement.todo_id,
      tags: foundPlacement.tags,
      duration_min: foundPlacement.duration_min,
      importance_score: importanceScore,
    },
    daysByDate: new Map([[foundDay.date, dayWithoutThis]]),
    policy,
    max: 5,
  };
  const suggestion = suggestPlacements(input);

  // Find the alternative that matches our actual slot, mark it as chosen.
  const chosen = suggestion.candidates.find((c) => c.start === foundPlacement!.start) ?? null;
  const alternatives = suggestion.candidates.filter((c) => c.start !== foundPlacement!.start);

  const output = {
    placement: foundPlacement,
    placed_by: foundPlacement.placed_by,
    chosen_reason: chosen
      ? `Ranked #${chosen.rank} of ${suggestion.candidates.length} (score ${chosen.score.toFixed(2)}). ${chosen.rationale}`
      : "Slot not in the current top-5; either policy changed or the slot was hand-picked.",
    chosen_breakdown: chosen,
    alternatives,
    policy_snapshot: policySnapshotMeta,
    importance_at_placement: foundPlacement.importance_at_placement,
  };

  if (json) {
    console.log(JSON.stringify(output, null, 2));
    return 0;
  }
  console.log(`scaffold-day explain ${id}`);
  console.log(`  placement: ${foundPlacement.id}`);
  console.log(`  todo:      ${foundPlacement.todo_id}`);
  console.log(`  when:      ${foundPlacement.start} → ${foundPlacement.end}`);
  console.log(`  placed_by: ${foundPlacement.placed_by}`);
  if (policySnapshotMeta) {
    console.log(`  policy:    ${policySnapshotMeta.hash.slice(0, 12)}… (captured ${policySnapshotMeta.captured_at})`);
  } else {
    console.log("  policy:    (no snapshot, using current)");
  }
  console.log(`  reason:    ${output.chosen_reason}`);
  if (alternatives.length > 0) {
    console.log(`  alternatives: ${alternatives.length}`);
    for (const alt of alternatives) {
      console.log(`    [${alt.rank}] ${alt.start} score: ${alt.score.toFixed(2)}`);
    }
  }
  return 0;
}

export const explainCommand: Command = {
  name: "explain",
  summary: "explain a placement decision (chosen reason + alternatives + policy snapshot)",
  help: {
    what: "Replay the placement decision for `<placement-id>` against the policy snapshot in effect at placement time. Returns the chosen reason, ranked alternatives, and the policy hash so AI clients can audit decisions even after the user edits the live policy.",
    when: "When asked 'why did the AI pick this slot?' or when investigating an outcome.",
    cost: "Local file I/O. Reads the placement, the policy snapshot under <home>/policy-snapshots/, and re-runs the suggest engine for the day.",
    input: "<placement-id> [--json]",
    return: "Exit 0. JSON shape includes {placement, placed_by, chosen_reason, chosen_breakdown, alternatives, policy_snapshot, importance_at_placement}. DAY_NOT_FOUND if the placement is gone.",
    gotcha: "Falls back to the current policy when no snapshot exists for the placement's policy_hash. The chosen_reason then reflects the fresh ranking, which may differ from the original. Tracking SLICES.md §S25 (cmd) / §S21 (placement log).",
  },
  run: async (args) => runExplain(args),
};
