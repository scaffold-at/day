import {
  defaultHomeDir,
  FsTodoRepository,
  ISODateSchema,
  TagSchema,
  TODO_STATUSES,
} from "@scaffold/day-core";
import { z } from "zod";
import type { Tool } from "./registry";

const InputSchema = z
  .object({
    title: z.string().trim().min(1).max(280),
    status: z.enum(TODO_STATUSES).optional(),
    tags: z.array(TagSchema).max(32).optional(),
    target_date: ISODateSchema.nullable().optional(),
    duration_min: z.number().int().min(0).max(60 * 24 * 30).nullable().optional(),
    description: z.string().nullable().optional(),
    reasoning: z.string().nullable().optional(),
    by: z.string().min(1).optional(),
  })
  .strict();
type Input = z.infer<typeof InputSchema>;

const inputJsonSchema = {
  type: "object",
  properties: {
    title: { type: "string", minLength: 1, maxLength: 280 },
    status: { type: "string", enum: TODO_STATUSES, default: "open" },
    tags: { type: "array", items: { type: "string" }, maxItems: 32 },
    target_date: { type: ["string", "null"], description: "YYYY-MM-DD" },
    duration_min: { type: ["integer", "null"], minimum: 0 },
    description: { type: ["string", "null"] },
    reasoning: { type: ["string", "null"] },
    by: { type: "string", description: "History attribution (default: 'user')" },
  },
  required: ["title"],
  additionalProperties: false,
} as const;

export const createTodoTool: Tool<Input, unknown> = {
  name: "create_todo",
  description:
    "Create a new TODO and return its full Detail (with id, history, importance=null). Status defaults to 'open'. Tags are validated by the §S5 TagSchema regex.",
  inputSchema: inputJsonSchema,
  parser: InputSchema,
  handler: async (input: Input) => {
    const repo = new FsTodoRepository(defaultHomeDir());
    const detail = await repo.create({
      title: input.title,
      status: input.status,
      tags: input.tags,
      target_date: input.target_date ?? null,
      duration_min: input.duration_min ?? null,
      description: input.description ?? null,
      reasoning: input.reasoning ?? null,
      by: input.by,
    });
    return detail;
  },
};
