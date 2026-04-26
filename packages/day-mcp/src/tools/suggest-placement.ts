import {
  compilePolicy,
  type Day,
  defaultHomeDir,
  entityIdSchemaOf,
  FsDayStore,
  FsTodoRepository,
  ISODateSchema,
  readPolicyYaml,
  ScaffoldError,
  suggestPlacements,
} from "@scaffold/day-core";
import { z } from "zod";
import type { Tool } from "./registry";

const InputSchema = z
  .object({
    todo_id: entityIdSchemaOf("todo"),
    date: ISODateSchema.optional(),
    within: z.number().int().min(1).max(30).optional(),
    max: z.number().int().min(1).max(50).optional(),
  })
  .strict();
type Input = z.infer<typeof InputSchema>;

const inputJsonSchema = {
  type: "object",
  properties: {
    todo_id: { type: "string", pattern: "^todo_[a-z0-9]{14}$" },
    date: { type: "string", description: "YYYY-MM-DD anchor; defaults to today (policy TZ)" },
    within: { type: "integer", minimum: 1, maximum: 30, description: "Number of days to scan, default 7" },
    max: { type: "integer", minimum: 1, maximum: 50, description: "Maximum candidates returned, default 5" },
  },
  required: ["todo_id"],
  additionalProperties: false,
} as const;

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

export const suggestPlacementTool: Tool<Input, unknown> = {
  name: "suggest_placement",
  description:
    "Rank candidate slots for a TODO over a date window. Filters Hard Rules from policy, scores Soft Preferences + Reactivity penalty + importance, returns ranked candidates with breakdown. Read-only. Returns no_fit_reason when nothing fits.",
  inputSchema: inputJsonSchema,
  parser: InputSchema,
  handler: async (input: Input) => {
    const home = defaultHomeDir();
    const yaml = await readPolicyYaml(home);
    if (!yaml) {
      throw new ScaffoldError({
        code: "DAY_NOT_INITIALIZED",
        summary: { en: "no policy/current.yaml yet" },
        cause: "suggest_placement needs the policy.",
        try: ["Apply a preset (e.g. balanced) before calling this tool."],
      });
    }
    const policy = compilePolicy(yaml);
    const todoRepo = new FsTodoRepository(home);
    const detail = await todoRepo.getDetail(input.todo_id);
    if (!detail) {
      throw new ScaffoldError({
        code: "DAY_NOT_FOUND",
        summary: { en: `todo '${input.todo_id}' not found` },
        cause: `No active todo exists with id '${input.todo_id}'.`,
        try: ["Call query_todos to list available ids."],
        context: { id: input.todo_id },
      });
    }
    if (detail.duration_min == null) {
      throw new ScaffoldError({
        code: "DAY_INVALID_INPUT",
        summary: { en: "todo has no duration_min — cannot generate candidates" },
        cause: `Todo '${input.todo_id}' has no duration_min set.`,
        try: ["Update the todo with a duration_min before calling suggest_placement."],
      });
    }

    const dayStore = new FsDayStore(home);
    const start = input.date ?? todayInTz(policy.context.tz);
    const days = input.within ?? 7;
    const max = input.max ?? 5;
    const daysByDate = new Map<string, Day>();
    for (let i = 0; i < days; i++) {
      const d = shiftDays(start, i);
      daysByDate.set(d, await dayStore.readDay(d));
    }
    const importanceScore = detail.importance?.score ?? detail.importance_score ?? 0;
    return suggestPlacements({
      todo: {
        id: detail.id,
        tags: detail.tags,
        duration_min: detail.duration_min,
        importance_score: importanceScore,
      },
      daysByDate,
      policy,
      max,
    });
  },
};
