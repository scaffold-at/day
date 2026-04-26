import {
  compilePolicy,
  defaultHomeDir,
  FsDayStore,
  FsTodoRepository,
  type Day,
  ISODateSchema,
  readPolicyYaml,
  ScaffoldError,
  suggestPlacements,
  type SuggestionInput,
} from "@scaffold/day-core";
import type { Command } from "../cli/command";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function usage(message: string): ScaffoldError {
  return new ScaffoldError({
    code: "DAY_USAGE",
    summary: { en: message },
    cause: "See `scaffold-day place --help` for the full input contract.",
    try: ["Run `scaffold-day place --help`."],
  });
}

function shiftDays(date: string, delta: number): string {
  const ms = Date.parse(`${date}T00:00:00Z`);
  return new Date(ms + delta * 86_400_000).toISOString().slice(0, 10);
}

function todayInTz(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function runSuggest(args: string[]): Promise<number> {
  let id: string | undefined;
  let startDate: string | undefined;
  let days = 7;
  let max = 5;
  let json = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? "";
    if (!id && !a.startsWith("--")) {
      id = a;
      continue;
    }
    if (a === "--date") {
      startDate = ISODateSchema.parse(args[i + 1]);
      i++;
    } else if (a === "--within") {
      const v = args[i + 1];
      if (!v) throw usage("--within requires a value (e.g. 7)");
      const n = Number.parseInt(v, 10);
      if (!Number.isFinite(n) || n < 1 || n > 30) {
        throw usage("--within must be an integer in [1, 30]");
      }
      days = n;
      i++;
    } else if (a === "--max") {
      const v = args[i + 1];
      if (!v) throw usage("--max requires a value");
      const n = Number.parseInt(v, 10);
      if (!Number.isFinite(n) || n < 1 || n > 50) {
        throw usage("--max must be an integer in [1, 50]");
      }
      max = n;
      i++;
    } else if (a === "--json") {
      json = true;
    } else if (a.startsWith("--")) {
      throw usage(`place suggest: unknown option '${a}'`);
    } else {
      throw usage(`place suggest: unexpected argument '${a}'`);
    }
  }
  if (!id) throw usage("place suggest: <todo-id> argument is required");

  const home = defaultHomeDir();
  const yaml = await readPolicyYaml(home);
  if (!yaml) {
    throw new ScaffoldError({
      code: "DAY_NOT_INITIALIZED",
      summary: { en: "no policy/current.yaml yet" },
      cause: "place suggest needs the policy weights + working hours.",
      try: ["Run `scaffold-day policy preset apply balanced`."],
    });
  }
  const policy = compilePolicy(yaml);

  const todoRepo = new FsTodoRepository(home);
  const detail = await todoRepo.getDetail(id);
  if (!detail) {
    throw new ScaffoldError({
      code: "DAY_NOT_FOUND",
      summary: { en: `todo '${id}' not found` },
      cause: `No active todo exists with id '${id}'.`,
      try: ["Run `scaffold-day todo list` to see available ids."],
      context: { id },
    });
  }
  if (detail.duration_min == null) {
    throw new ScaffoldError({
      code: "DAY_INVALID_INPUT",
      summary: { en: "todo has no duration_min — can't generate candidates" },
      cause: `Todo '${id}' has no duration_min set.`,
      try: [`Run \`scaffold-day todo update ${id} --duration-min 60\`.`],
    });
  }

  const dayStore = new FsDayStore(home);
  const start = startDate ?? todayInTz(policy.context.tz);
  const daysByDate = new Map<string, Day>();
  for (let i = 0; i < days; i++) {
    const d = shiftDays(start, i);
    daysByDate.set(d, await dayStore.readDay(d));
  }

  const importanceScore = detail.importance?.score ?? detail.importance_score ?? 0;
  const input: SuggestionInput = {
    todo: {
      id: detail.id,
      tags: detail.tags,
      duration_min: detail.duration_min,
      importance_score: importanceScore,
    },
    daysByDate,
    policy,
    max,
  };
  const suggestion = suggestPlacements(input);

  if (json) {
    console.log(JSON.stringify(suggestion, null, 2));
    return 0;
  }

  console.log(`scaffold-day place suggest ${id}`);
  console.log(`  duration:  ${suggestion.duration_min} min`);
  console.log(`  importance: ${suggestion.importance_score.toFixed(1)}`);
  console.log(`  range:     ${start} → ${shiftDays(start, days - 1)} (${days} day${days === 1 ? "" : "s"})`);
  console.log("");

  if (suggestion.candidates.length === 0) {
    console.log("  no candidates");
    if (suggestion.no_fit_reason) {
      console.log(`  reason: ${suggestion.no_fit_reason}`);
    }
    return 0;
  }

  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: policy.context.tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  for (const c of suggestion.candidates) {
    const startHM = fmt.format(new Date(c.start));
    const endHM = fmt.format(new Date(c.end));
    console.log(`  [${c.rank}] ${c.date}  ${startHM}-${endHM}  score: ${c.score.toFixed(2)}`);
    console.log(`        importance:  ${c.importance.toFixed(2)}`);
    console.log(`        soft_total:  ${c.soft_total >= 0 ? "+" : ""}${c.soft_total}`);
    if (c.reactivity_penalty !== 0) {
      console.log(`        reactivity:  ${c.reactivity_penalty}`);
    }
    for (const ctr of c.contributions) {
      console.log(`        + ${ctr.note}`);
    }
  }
  return 0;
}

export const placeCommand: Command = {
  name: "place",
  summary: "rank free slots for a todo (suggest), commit one (do), move one (override)",
  help: {
    what: "Drive the placement engine. `suggest <todo-id>` ranks free slots across the next N days using importance + soft preferences − reactivity. `do` and `override` arrive in §S21 / §S22.",
    when: "When deciding where in the day a todo should land, or when reshuffling after a calendar change.",
    cost: "Local file I/O (policy + day files for the requested range). No network. No mutations from `suggest`.",
    input: "suggest <todo-id> [--date <YYYY-MM-DD>] [--within <N>=7] [--max <K>=5] [--json]\ndo <todo-id> --slot <ISO> [--lock]            (placeholder, §S21)\noverride <placement-id> --new-slot <ISO> [--reason <T>]   (placeholder, §S22)",
    return: "Exit 0. DAY_NOT_INITIALIZED if no policy/current.yaml. DAY_NOT_FOUND for unknown todo. DAY_INVALID_INPUT if the todo has no duration_min. DAY_USAGE on bad flags.",
    gotcha: "`suggest` does not write anything — call `place do` to commit. The Balanced preset's working window (09:00-18:00 weekdays) means a Saturday todo will produce zero candidates until you customize policy. Tracking SLICES.md §S20 (suggest) / §S21 (do) / §S22 (override).",
  },
  run: async (args) => {
    const sub = args[0];
    if (!sub) throw usage("place: missing subcommand. try `place suggest <todo-id>`");
    const rest = args.slice(1);
    if (sub === "suggest") return runSuggest(rest);
    if (sub === "do") {
      console.log("scaffold-day place do: not yet implemented (placeholder).");
      console.log("Tracking: SLICES.md §S21");
      return 0;
    }
    if (sub === "override") {
      console.log("scaffold-day place override: not yet implemented (placeholder).");
      console.log("Tracking: SLICES.md §S22");
      return 0;
    }
    throw usage(`place: unknown subcommand '${sub}'`);
  },
};
