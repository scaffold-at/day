import {
  defaultHomeDir,
  FsTodoRepository,
  TagSchema,
  TODO_STATUSES,
} from "@scaffold/day-core";
import { z } from "zod";
import type { Tool } from "./registry";

const InputSchema = z
  .object({
    status: z.array(z.enum(TODO_STATUSES)).optional(),
    tags_any: z.array(TagSchema).optional(),
    has_deadline: z.boolean().optional(),
    limit: z.number().int().min(1).max(500).optional(),
  })
  .strict();
type Input = z.infer<typeof InputSchema>;

const inputJsonSchema = {
  type: "object",
  properties: {
    status: {
      type: "array",
      items: { type: "string", enum: TODO_STATUSES },
      description: "Match any of these statuses (default: all).",
    },
    tags_any: {
      type: "array",
      items: { type: "string", description: "Tag like #deep-work" },
      description: "Match if the todo has any of these tags.",
    },
    has_deadline: {
      type: "boolean",
      description: "Filter to todos with (true) or without (false) a #deadline:* tag.",
    },
    limit: { type: "integer", minimum: 1, maximum: 500 },
  },
  additionalProperties: false,
} as const;

export const queryTodosTool: Tool<Input, unknown> = {
  name: "query_todos",
  description:
    "List active TODOs with summary fields (id / title / status / tags / importance_score / duration_min / target_date). Filters: status[], tags_any[], has_deadline. Returns at most `limit` items (default unlimited). Read-only.",
  inputSchema: inputJsonSchema,
  parser: InputSchema,
  handler: async (input: Input) => {
    const repo = new FsTodoRepository(defaultHomeDir());
    let items = await repo.listSummaries({
      status: input.status,
      tagsAny: input.tags_any,
      hasDeadline: input.has_deadline,
    });
    if (input.limit !== undefined) items = items.slice(0, input.limit);
    return { items, total: items.length };
  },
};
