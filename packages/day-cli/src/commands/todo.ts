import {
  compilePolicy,
  defaultHomeDir,
  detectAvailableProviders,
  FsTodoRepository,
  type ImportanceDimensions,
  ISODateSchema,
  makeTaskImportance,
  MockAIProvider,
  readPolicyYaml,
  ScaffoldError,
  scoreImportanceViaProvider,
  TagSchema,
  type TodoSummary,
  TODO_STATUSES,
  type TodoStatus,
} from "@scaffold/day-core";
import type { Command } from "../cli/command";

function usage(message: string): ScaffoldError {
  return new ScaffoldError({
    code: "DAY_USAGE",
    summary: { en: message },
    cause: "See `scaffold-day todo --help` for the full input contract.",
    try: ["Run `scaffold-day todo --help`."],
  });
}

function takeValue(args: string[], i: number, flag: string): string {
  const v = args[i + 1];
  if (v === undefined || v.startsWith("--")) {
    throw usage(`todo: ${flag} requires a value`);
  }
  return v;
}

function ensureTag(value: string): string {
  const r = TagSchema.safeParse(value);
  if (!r.success) {
    throw new ScaffoldError({
      code: "DAY_INVALID_INPUT",
      summary: { en: `tag '${value}' is not a valid Tag` },
      cause: r.error.message,
      try: ["Tags look like #kebab or #deadline:YYYY-MM-DD."],
      context: { value },
    });
  }
  return r.data;
}

function ensureDate(value: string, flag: string): string {
  const r = ISODateSchema.safeParse(value);
  if (!r.success) {
    throw new ScaffoldError({
      code: "DAY_INVALID_INPUT",
      summary: { en: `${flag} must be a real YYYY-MM-DD date` },
      cause: r.error.message,
      try: [`Pass ${flag} 2026-04-26.`],
      context: { value },
    });
  }
  return r.data;
}

// ─── add ──────────────────────────────────────────────────────────

async function runAdd(args: string[]): Promise<number> {
  let title: string | undefined;
  let status: TodoStatus | undefined;
  let durationMin: number | undefined;
  let targetDate: string | undefined;
  let description: string | undefined;
  let reasoning: string | undefined;
  const tags: string[] = [];
  let json = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? "";
    if (a === "--title") { title = takeValue(args, i, "--title"); i++; }
    else if (a === "--status") {
      const v = takeValue(args, i, "--status");
      if (!TODO_STATUSES.includes(v as TodoStatus)) {
        throw new ScaffoldError({
          code: "DAY_INVALID_INPUT",
          summary: { en: `invalid status '${v}'` },
          cause: `Must be one of ${TODO_STATUSES.join(", ")}.`,
          try: ["Pass --status open|in_progress|done."],
        });
      }
      status = v as TodoStatus; i++;
    } else if (a === "--duration-min") {
      const v = takeValue(args, i, "--duration-min");
      const n = Number.parseInt(v, 10);
      if (!Number.isFinite(n) || n < 0) {
        throw usage("--duration-min must be a non-negative integer");
      }
      durationMin = n; i++;
    } else if (a === "--target-date") {
      targetDate = ensureDate(takeValue(args, i, "--target-date"), "--target-date"); i++;
    } else if (a === "--description") {
      description = takeValue(args, i, "--description"); i++;
    } else if (a === "--reasoning") {
      reasoning = takeValue(args, i, "--reasoning"); i++;
    } else if (a === "--tag") {
      tags.push(ensureTag(takeValue(args, i, "--tag"))); i++;
    } else if (a === "--json") {
      json = true;
    } else {
      throw usage(`todo add: unexpected argument '${a}'`);
    }
  }

  if (!title) throw usage("todo add: --title is required");

  const repo = new FsTodoRepository(defaultHomeDir());
  const created = await repo.create({
    title,
    status,
    tags,
    duration_min: durationMin ?? null,
    target_date: targetDate ?? null,
    description: description ?? null,
    reasoning: reasoning ?? null,
  });

  if (json) {
    console.log(JSON.stringify(created, null, 2));
  } else {
    console.log("scaffold-day todo add");
    console.log(`  id:       ${created.id}`);
    console.log(`  title:    ${created.title}`);
    console.log(`  status:   ${created.status}`);
    if (created.tags.length > 0) console.log(`  tags:     ${created.tags.join(" ")}`);
    if (created.target_date) console.log(`  due:      ${created.target_date}`);
  }
  return 0;
}

// ─── list ─────────────────────────────────────────────────────────

async function runList(args: string[]): Promise<number> {
  let json = false;
  const tagsAny: string[] = [];
  const statuses: TodoStatus[] = [];
  let hasDeadline: boolean | undefined;

  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? "";
    if (a === "--json") json = true;
    else if (a === "--status") {
      const v = takeValue(args, i, "--status");
      if (!TODO_STATUSES.includes(v as TodoStatus)) {
        throw new ScaffoldError({
          code: "DAY_INVALID_INPUT",
          summary: { en: `invalid status '${v}'` },
          cause: `Must be one of ${TODO_STATUSES.join(", ")}.`,
          try: ["Pass --status open|in_progress|done."],
        });
      }
      statuses.push(v as TodoStatus); i++;
    } else if (a === "--tag") {
      tagsAny.push(ensureTag(takeValue(args, i, "--tag"))); i++;
    } else if (a === "--has-deadline") { hasDeadline = true; }
    else if (a === "--no-deadline") { hasDeadline = false; }
    else throw usage(`todo list: unexpected argument '${a}'`);
  }

  const repo = new FsTodoRepository(defaultHomeDir());
  const summaries = await repo.listSummaries({
    status: statuses.length > 0 ? statuses : undefined,
    tagsAny: tagsAny.length > 0 ? tagsAny : undefined,
    hasDeadline,
  });

  if (json) {
    console.log(JSON.stringify({ items: summaries, total: summaries.length }, null, 2));
    return 0;
  }
  if (summaries.length === 0) {
    console.log("scaffold-day todo list");
    console.log("  (no todos match)");
    return 0;
  }
  console.log("scaffold-day todo list");
  for (const s of summaries) {
    const score = s.importance_score == null ? "  -" : String(Math.round(s.importance_score)).padStart(3);
    const status = s.status.padEnd(11);
    console.log(`  ${s.id}  [${status}] score:${score}  ${s.title}`);
  }
  return 0;
}

// ─── get / detail ─────────────────────────────────────────────────

async function runGet(args: string[]): Promise<number> {
  const positional: string[] = [];
  let json = false;
  for (const a of args) {
    if (a === "--json") json = true;
    else if (a.startsWith("--")) throw usage(`todo get: unknown option '${a}'`);
    else positional.push(a);
  }
  const id = positional[0];
  if (!id) throw usage("todo get: <id> argument is required");

  const repo = new FsTodoRepository(defaultHomeDir());
  const detail = await repo.getDetail(id);
  if (!detail) {
    throw new ScaffoldError({
      code: "DAY_NOT_FOUND",
      summary: { en: `todo '${id}' not found` },
      cause: `No active todo exists with id '${id}'.`,
      try: ["Run `scaffold-day todo list` to see available ids."],
      context: { id },
    });
  }

  if (json) {
    console.log(JSON.stringify(detail, null, 2));
    return 0;
  }
  console.log(`scaffold-day todo get ${id}`);
  console.log(`  title:           ${detail.title}`);
  console.log(`  status:          ${detail.status}`);
  if (detail.tags.length > 0) console.log(`  tags:            ${detail.tags.join(" ")}`);
  if (detail.target_date) console.log(`  due:             ${detail.target_date}`);
  if (detail.duration_min != null) console.log(`  duration_min:    ${detail.duration_min}`);
  if (detail.importance) {
    console.log(`  importance.score: ${detail.importance.score.toFixed(2)} / 100`);
    console.log(`  importance.policy_hash: ${detail.importance.policy_hash.slice(0, 12)}…`);
  } else if (detail.importance_score != null) {
    console.log(`  importance_score: ${detail.importance_score}`);
  }
  if (detail.description) console.log(`  description:     ${detail.description}`);
  if (detail.reasoning) console.log(`  reasoning:       ${detail.reasoning}`);
  console.log(`  history (${detail.history.length} entries):`);
  for (const h of detail.history) {
    console.log(`    ${h.at}  ${h.by.padEnd(10)}  ${h.kind}${h.notes ? `  — ${h.notes}` : ""}`);
  }
  return 0;
}

// ─── update ───────────────────────────────────────────────────────

async function runUpdate(args: string[]): Promise<number> {
  let id: string | undefined;
  let title: string | undefined;
  let status: TodoStatus | undefined;
  const tags: string[] = [];
  let tagsTouched = false;
  let durationMin: number | null | undefined;
  let targetDate: string | null | undefined;
  let description: string | null | undefined;
  let reasoning: string | null | undefined;
  let notes: string | null | undefined;

  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? "";
    if (!id && !a.startsWith("--")) { id = a; continue; }
    if (a === "--title") { title = takeValue(args, i, "--title"); i++; }
    else if (a === "--status") {
      const v = takeValue(args, i, "--status");
      if (!TODO_STATUSES.includes(v as TodoStatus)) {
        throw new ScaffoldError({
          code: "DAY_INVALID_INPUT",
          summary: { en: `invalid status '${v}'` },
          cause: `Must be one of ${TODO_STATUSES.join(", ")}.`,
          try: ["Pass --status open|in_progress|done."],
        });
      }
      status = v as TodoStatus; i++;
    } else if (a === "--tag") {
      tags.push(ensureTag(takeValue(args, i, "--tag"))); tagsTouched = true; i++;
    } else if (a === "--clear-tags") { tagsTouched = true; }
    else if (a === "--duration-min") {
      const v = takeValue(args, i, "--duration-min");
      durationMin = v === "null" ? null : Number.parseInt(v, 10);
      i++;
    } else if (a === "--target-date") {
      const v = takeValue(args, i, "--target-date");
      targetDate = v === "null" ? null : ensureDate(v, "--target-date");
      i++;
    } else if (a === "--description") {
      const v = takeValue(args, i, "--description");
      description = v === "null" ? null : v;
      i++;
    } else if (a === "--reasoning") {
      const v = takeValue(args, i, "--reasoning");
      reasoning = v === "null" ? null : v;
      i++;
    } else if (a === "--notes") {
      notes = takeValue(args, i, "--notes"); i++;
    } else {
      throw usage(`todo update: unexpected argument '${a}'`);
    }
  }
  if (!id) throw usage("todo update: <id> argument is required");

  const repo = new FsTodoRepository(defaultHomeDir());
  const updated = await repo.update(id, {
    title,
    status,
    tags: tagsTouched ? tags : undefined,
    duration_min: durationMin,
    target_date: targetDate,
    description,
    reasoning,
    notes,
  });

  console.log("scaffold-day todo update");
  console.log(`  id:       ${updated.id}`);
  console.log(`  status:   ${updated.status}`);
  if (updated.tags.length > 0) console.log(`  tags:     ${updated.tags.join(" ")}`);
  console.log(`  history:  ${updated.history.length} entries`);
  return 0;
}

// ─── archive ──────────────────────────────────────────────────────

async function runArchive(args: string[]): Promise<number> {
  let id: string | undefined;
  let reason: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? "";
    if (!id && !a.startsWith("--")) { id = a; continue; }
    if (a === "--reason") { reason = takeValue(args, i, "--reason"); i++; }
    else throw usage(`todo archive: unexpected argument '${a}'`);
  }
  if (!id) throw usage("todo archive: <id> argument is required");

  const repo = new FsTodoRepository(defaultHomeDir());
  const archived = await repo.archive(id, { reason });
  console.log("scaffold-day todo archive");
  console.log(`  id:           ${archived.id}`);
  console.log(`  archived_at:  ${archived.archived_at}`);
  console.log(`  final_status: ${archived.final_status}`);
  if (archived.archive_reason) console.log(`  reason:       ${archived.archive_reason}`);
  return 0;
}

// ─── score ────────────────────────────────────────────────────────

function takeNum(args: string[], i: number, flag: string): number {
  const v = takeValue(args, i, flag);
  const n = Number(v);
  if (!Number.isFinite(n)) {
    throw new ScaffoldError({
      code: "DAY_INVALID_INPUT",
      summary: { en: `${flag} must be a number` },
      cause: `Got: ${v}`,
      try: [`Pass ${flag} 0..10.`],
    });
  }
  return n;
}

async function runScore(args: string[]): Promise<number> {
  let id: string | undefined;
  let urgency: number | undefined;
  let impact: number | undefined;
  let effort: number | undefined;
  let reversibility: number | undefined;
  let timeSensitivity: number | undefined;
  let extDep = false;
  let deadline: "hard" | "soft" | "none" | undefined;
  let reasoning: string | undefined;
  let computedBy = "user";
  let json = false;
  let aiMode = false;
  let aiProvider: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? "";
    if (!id && !a.startsWith("--")) { id = a; continue; }
    if (a === "--urgency") { urgency = takeNum(args, i, "--urgency"); i++; }
    else if (a === "--impact") { impact = takeNum(args, i, "--impact"); i++; }
    else if (a === "--effort") { effort = takeNum(args, i, "--effort"); i++; }
    else if (a === "--reversibility") { reversibility = takeNum(args, i, "--reversibility"); i++; }
    else if (a === "--time-sensitivity") { timeSensitivity = takeNum(args, i, "--time-sensitivity"); i++; }
    else if (a === "--external-dependency") { extDep = true; }
    else if (a === "--deadline") {
      const v = takeValue(args, i, "--deadline");
      if (v !== "hard" && v !== "soft" && v !== "none") {
        throw new ScaffoldError({
          code: "DAY_INVALID_INPUT",
          summary: { en: `--deadline must be hard|soft|none` },
          cause: `Got: ${v}`,
          try: ["Pass --deadline hard."],
        });
      }
      deadline = v;
      i++;
    } else if (a === "--reasoning") { reasoning = takeValue(args, i, "--reasoning"); i++; }
    else if (a === "--by") { computedBy = takeValue(args, i, "--by"); i++; }
    else if (a === "--ai") { aiMode = true; }
    else if (a === "--ai-provider") { aiProvider = takeValue(args, i, "--ai-provider"); i++; }
    else if (a === "--json") { json = true; }
    else if (a === "--from-stdin") {
      // Read JSON from stdin: { urgency, impact, effort, reversibility, ... }
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin as AsyncIterable<Buffer>) chunks.push(chunk);
      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      urgency = urgency ?? payload.urgency;
      impact = impact ?? payload.impact;
      effort = effort ?? payload.effort;
      reversibility = reversibility ?? payload.reversibility;
      timeSensitivity = timeSensitivity ?? payload.time_sensitivity;
      if (payload.external_dependency) extDep = true;
      if (payload.deadline) deadline = payload.deadline;
      if (payload.reasoning && !reasoning) reasoning = payload.reasoning;
    } else {
      throw usage(`todo score: unexpected argument '${a}'`);
    }
  }

  if (!id) throw usage("todo score: <id> argument is required");

  const home = defaultHomeDir();
  const yaml = await readPolicyYaml(home);
  if (!yaml) {
    throw new ScaffoldError({
      code: "DAY_NOT_INITIALIZED",
      summary: { en: "no policy/current.yaml yet" },
      cause: "Importance scoring needs the policy weights.",
      try: ["Run `scaffold-day policy preset apply balanced`."],
    });
  }
  const policy = compilePolicy(yaml);

  let importance;
  if (aiMode) {
    // Resolve a provider: explicit --ai-provider id wins; otherwise
    // pick the first available from the catalog (mock-first per
    // memory:project_test_strategy).
    const probes = await detectAvailableProviders();
    let chosen: string | null = null;
    if (aiProvider) {
      const match = probes.find((p) => p.id === aiProvider);
      if (!match || !match.available) {
        throw new ScaffoldError({
          code: "DAY_PROVIDER_UNAVAILABLE",
          summary: { en: `provider '${aiProvider}' is not available` },
          cause: match ? `Provider declared unavailable: ${match.note ?? ""}` : "Not in the catalog.",
          try: ["Drop --ai-provider to use the first available provider, or install the named one."],
          context: { provider: aiProvider },
        });
      }
      chosen = aiProvider;
    } else {
      const first = probes.find((p) => p.available);
      if (!first) {
        throw new ScaffoldError({
          code: "DAY_PROVIDER_UNAVAILABLE",
          summary: { en: "no AI provider is available" },
          cause: `Catalog: ${probes.map((p) => p.id).join(", ")}; none reported available.`,
          try: ["Install Claude Code, or test with the bundled mock provider."],
        });
      }
      chosen = first.id;
    }

    const todoRepo = new FsTodoRepository(home);
    const detail = await todoRepo.getDetail(id);
    if (!detail) {
      throw new ScaffoldError({
        code: "DAY_NOT_FOUND",
        summary: { en: `todo '${id}' not found` },
        cause: `No active todo exists with id '${id}'.`,
        try: ["Run `scaffold-day todo list`."],
        context: { id },
      });
    }

    // Build the provider instance fresh — detect.ts returns probes,
    // not adapter instances. Same wiring as doctor's roundtrip.
    const { ClaudeCliProvider } = await import("@scaffold/day-core");
    const provider =
      chosen === "mock"
        ? new MockAIProvider()
        : new ClaudeCliProvider();

    importance = await scoreImportanceViaProvider(
      {
        title: detail.title,
        description: detail.description,
        tags: detail.tags,
        target_date: detail.target_date,
      },
      policy,
      provider,
      { by: computedBy === "user" ? provider.id : computedBy },
    );
  } else {
    for (const [name, v] of [
      ["--urgency", urgency],
      ["--impact", impact],
      ["--effort", effort],
      ["--reversibility", reversibility],
    ] as const) {
      if (v === undefined) throw usage(`todo score: ${name} is required (or pass --ai)`);
    }
    const dimensions: ImportanceDimensions = {
      urgency: urgency!,
      impact: impact!,
      effort: effort!,
      reversibility: reversibility!,
      time_sensitivity: timeSensitivity,
      external_dependency: extDep,
      deadline: deadline ?? "none",
    };
    importance = await makeTaskImportance(dimensions, policy, {
      reasoning: reasoning ?? "manual scoring",
      computedBy,
    });
  }

  const repo = new FsTodoRepository(home);
  const updated = await repo.update(id, {
    importance,
    by: computedBy,
    history_kind: "scored",
    notes: reasoning ?? null,
  });

  if (json) {
    console.log(JSON.stringify({ id: updated.id, importance: updated.importance }, null, 2));
    return 0;
  }
  console.log("scaffold-day todo score");
  console.log(`  id:        ${updated.id}`);
  console.log(`  score:     ${importance.score.toFixed(2)} / 100`);
  console.log(`  policy:    ${importance.policy_hash.slice(0, 12)}…`);
  console.log(`  by:        ${importance.computed_by}`);
  return 0;
}

export const todoCommand: Command = {
  name: "todo",
  summary: "manage todos (add / list / get / update / archive / score)",
  help: {
    what: "Create, query, update, archive, and score TODOs against the active policy. Subcommands operate on the Two-tier active store under <home>/todos/.",
    when: "Daily intake, triage, and importance scoring. AI clients should prefer --json everywhere.",
    cost: "Local file I/O only. `score` additionally reads policy/current.yaml to fetch weights.",
    input: "add --title <text> [--status open|in_progress|done] [--tag <#tag>...] [--target-date <YYYY-MM-DD>] [--duration-min <n>] [--description <text>] [--reasoning <text>] [--json]\nlist [--status <s>]... [--tag <#tag>]... [--has-deadline | --no-deadline] [--json]\nget <id> [--json]\nupdate <id> [--title <text>] [--status <s>] [--tag <#tag>]... [--clear-tags] [--duration-min <n|null>] [--target-date <date|null>] [--description <text|null>] [--reasoning <text|null>] [--notes <text>]\narchive <id> [--reason <text>]\nscore <id> --urgency <0..10> --impact <0..10> --effort <0..10> --reversibility <0..10> [--time-sensitivity <0..10>] [--deadline hard|soft|none] [--external-dependency] [--reasoning <text>] [--by <attribution>] [--from-stdin] [--json]",
    return: "Exit 0. DAY_USAGE on missing args. DAY_INVALID_INPUT on bad values. DAY_NOT_FOUND on unknown id. DAY_NOT_INITIALIZED if `score` runs before `policy preset apply`.",
    gotcha: "`score` updates `importance_score` AND the full `importance` record (with policy_hash). The policy_hash is what `explain` (§S25) replays — editing the policy invalidates old explanations. Tracking SLICES.md §S17 (cmd) / §S16 (formula) / §S6-§S8c (storage).",
  },
  run: async (args) => {
    const sub = args[0];
    if (!sub) throw usage("todo: missing subcommand. try `todo add`, `todo list`, `todo score <id> ...`");
    const rest = args.slice(1);
    if (sub === "add") return runAdd(rest);
    if (sub === "list") return runList(rest);
    if (sub === "get") return runGet(rest);
    if (sub === "update") return runUpdate(rest);
    if (sub === "archive") return runArchive(rest);
    if (sub === "score") return runScore(rest);
    throw usage(`todo: unknown subcommand '${sub}'`);
  },
};
