import { z } from "zod";
import { entityIdSchemaOf } from "../ids/entity-id";
import {
  ISODateSchema,
  ISODateTimeSchema,
  type Tag,
  TagSchema,
} from "../ids/schemas";
import { TODO_STATUSES } from "./status";

const TodoIdSchema = entityIdSchemaOf("todo");

export const ImportanceScoreSchema = z.number().min(0).max(100).finite();

const DURATION_MAX_MIN = 60 * 24 * 30; // 30 days, sanity cap
export const DurationMinSchema = z.number().int().min(0).max(DURATION_MAX_MIN);

export const TodoStatusSchema = z.enum(TODO_STATUSES);

const HISTORY_KINDS = [
  "created",
  "updated",
  "scored",
  "tagged",
  "status_changed",
  "archived",
  "restored",
] as const;

export const TodoHistoryEntrySchema = z.object({
  at: ISODateTimeSchema,
  by: z.string().min(1),
  kind: z.enum(HISTORY_KINDS),
  notes: z.string().nullable().default(null),
  patch: z.record(z.unknown()).nullable().default(null),
});

export const TodoSummarySchema = z.object({
  id: TodoIdSchema,
  title: z.string().trim().min(1).max(280),
  status: TodoStatusSchema,
  tags: z.array(TagSchema).max(32).default([]),
  importance_score: ImportanceScoreSchema.nullable(),
  duration_min: DurationMinSchema.nullable(),
  target_date: ISODateSchema.nullable(),
  created_at: ISODateTimeSchema,
  updated_at: ISODateTimeSchema,
});

export const TodoDetailSchema = TodoSummarySchema.extend({
  description: z.string().nullable(),
  reasoning: z.string().nullable(),
  history: z.array(TodoHistoryEntrySchema).default([]),
});

export const TodoArchiveSchema = TodoDetailSchema.extend({
  archived_at: ISODateTimeSchema,
  archive_reason: z.string().nullable(),
  final_status: TodoStatusSchema,
});

export type TodoSummary = z.infer<typeof TodoSummarySchema>;
export type TodoDetail = z.infer<typeof TodoDetailSchema>;
export type TodoArchive = z.infer<typeof TodoArchiveSchema>;
export type TodoHistoryEntry = z.infer<typeof TodoHistoryEntrySchema>;
export type TodoHistoryKind = (typeof HISTORY_KINDS)[number];

const DEADLINE_PREFIX = "#deadline:";
const DEADLINE_VALUE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Extract `YYYY-MM-DD` from a `#deadline:YYYY-MM-DD` tag, if present.
 * Returns the first valid match. Pure helper — does not validate the
 * date itself; pair with `ISODateSchema` if you need real-day checks.
 */
export function extractDeadlineDate(tags: readonly Tag[]): string | null {
  for (const tag of tags) {
    if (!tag.startsWith(DEADLINE_PREFIX)) continue;
    const value = tag.slice(DEADLINE_PREFIX.length);
    if (DEADLINE_VALUE_RE.test(value)) return value;
  }
  return null;
}

export const HISTORY_KIND_VALUES = HISTORY_KINDS;

/**
 * Project a `TodoDetail` (or `TodoArchive`) down to its `TodoSummary`
 * shape. Strips description / reasoning / history and any
 * archive-only fields. Used to keep the active index in sync with
 * per-todo detail files (PRD §9.4 inline-snapshot invariant).
 */
export function summarize(detail: TodoDetail | TodoArchive): TodoSummary {
  return {
    id: detail.id,
    title: detail.title,
    status: detail.status,
    tags: [...detail.tags],
    importance_score: detail.importance_score,
    duration_min: detail.duration_min,
    target_date: detail.target_date,
    created_at: detail.created_at,
    updated_at: detail.updated_at,
  };
}
