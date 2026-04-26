import {
  defaultHomeDir,
  entityIdSchemaOf,
  FsTodoRepository,
  ISODateSchema,
  ScaffoldError,
  TagSchema,
  TODO_STATUSES,
} from "@scaffold/day-core";
import { z } from "zod";
import type { Tool } from "./registry";

const TodoIdSchema = entityIdSchemaOf("todo");

// ─── get_todo_summary ──────────────────────────────────────────────

const SummaryInput = z.object({ id: TodoIdSchema }).strict();
type SummaryIn = z.infer<typeof SummaryInput>;

export const getTodoSummaryTool: Tool<SummaryIn, unknown> = {
  name: "get_todo_summary",
  description:
    "Return the TodoSummary for an active todo (id, title, status, tags, importance_score, duration_min, target_date, created_at, updated_at). Read-only, cheap.",
  inputSchema: {
    type: "object",
    properties: { id: { type: "string", pattern: "^todo_[a-z0-9]{14}$" } },
    required: ["id"],
    additionalProperties: false,
  },
  parser: SummaryInput,
  handler: async (input: SummaryIn) => {
    const repo = new FsTodoRepository(defaultHomeDir());
    const summary = await repo.getSummary(input.id);
    if (!summary) {
      throw new ScaffoldError({
        code: "DAY_NOT_FOUND",
        summary: { en: `todo '${input.id}' not found` },
        cause: `No active todo exists with id '${input.id}'.`,
        try: ["Call query_todos to discover ids."],
        context: { id: input.id },
      });
    }
    return summary;
  },
};

// ─── get_todo_detail ───────────────────────────────────────────────

export const getTodoDetailTool: Tool<SummaryIn, unknown> = {
  name: "get_todo_detail",
  description:
    "Return the full TodoDetail (Summary + description + reasoning + history[] + importance{}). Used when AI clients need the body or the audit log.",
  inputSchema: {
    type: "object",
    properties: { id: { type: "string", pattern: "^todo_[a-z0-9]{14}$" } },
    required: ["id"],
    additionalProperties: false,
  },
  parser: SummaryInput,
  handler: async (input: SummaryIn) => {
    const repo = new FsTodoRepository(defaultHomeDir());
    const detail = await repo.getDetail(input.id);
    if (!detail) {
      throw new ScaffoldError({
        code: "DAY_NOT_FOUND",
        summary: { en: `todo '${input.id}' not found` },
        cause: `No active todo exists with id '${input.id}'.`,
        try: ["Call query_todos to discover ids."],
        context: { id: input.id },
      });
    }
    return detail;
  },
};

// ─── update_todo ───────────────────────────────────────────────────

const UpdateInput = z
  .object({
    id: TodoIdSchema,
    title: z.string().trim().min(1).max(280).optional(),
    status: z.enum(TODO_STATUSES).optional(),
    tags: z.array(TagSchema).max(32).optional(),
    importance_score: z.number().min(0).max(100).finite().nullable().optional(),
    duration_min: z.number().int().min(0).max(60 * 24 * 30).nullable().optional(),
    target_date: ISODateSchema.nullable().optional(),
    description: z.string().nullable().optional(),
    reasoning: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    by: z.string().min(1).optional(),
  })
  .strict();
type UpdateIn = z.infer<typeof UpdateInput>;

export const updateTodoTool: Tool<UpdateIn, unknown> = {
  name: "update_todo",
  description:
    "Apply a partial patch to an active todo. Only the fields you pass are mutated; pass `null` to clear an optional column. Returns the updated TodoDetail with a new history entry.",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string", pattern: "^todo_[a-z0-9]{14}$" },
      title: { type: "string" },
      status: { type: "string", enum: TODO_STATUSES },
      tags: { type: "array", items: { type: "string" } },
      importance_score: { type: ["number", "null"] },
      duration_min: { type: ["integer", "null"] },
      target_date: { type: ["string", "null"] },
      description: { type: ["string", "null"] },
      reasoning: { type: ["string", "null"] },
      notes: { type: ["string", "null"] },
      by: { type: "string" },
    },
    required: ["id"],
    additionalProperties: false,
  },
  parser: UpdateInput,
  handler: async (input: UpdateIn) => {
    const repo = new FsTodoRepository(defaultHomeDir());
    const { id, ...patch } = input;
    return await repo.update(id, patch);
  },
};

// ─── archive_todo ──────────────────────────────────────────────────

const ArchiveInput = z
  .object({
    id: TodoIdSchema,
    reason: z.string().min(1).optional(),
    by: z.string().min(1).optional(),
  })
  .strict();
type ArchiveIn = z.infer<typeof ArchiveInput>;

export const archiveTodoTool: Tool<ArchiveIn, unknown> = {
  name: "archive_todo",
  description:
    "Move an active todo into the YYYY-MM archive partition. Returns the resulting TodoArchive with archive_reason + final_status frozen.",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string", pattern: "^todo_[a-z0-9]{14}$" },
      reason: { type: "string" },
      by: { type: "string" },
    },
    required: ["id"],
    additionalProperties: false,
  },
  parser: ArchiveInput,
  handler: async (input: ArchiveIn) => {
    const repo = new FsTodoRepository(defaultHomeDir());
    return await repo.archive(input.id, { reason: input.reason, by: input.by });
  },
};
