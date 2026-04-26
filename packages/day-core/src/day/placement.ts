import { z } from "zod";
import { entityIdSchemaOf } from "../ids/entity-id";
import { ISODateTimeSchema, TagSchema } from "../ids/schemas";
import { TaskImportanceSchema } from "../policy/importance";

const PlacementIdSchema = entityIdSchemaOf("placement");
const TodoIdSchema = entityIdSchemaOf("todo");

export const PlacedBySchema = z.enum(["ai", "user", "auto"]);
export type PlacedBy = z.infer<typeof PlacedBySchema>;

/**
 * Inline-snapshot fields capture the todo's state at the moment of
 * placement so a later `todo update` does not retroactively change
 * what we placed. `importance_at_placement` carries the full
 * TaskImportance record (with policy_hash) so §S25 explain can replay
 * the decision deterministically.
 */
export const PlacementSchema = z.object({
  id: PlacementIdSchema,
  todo_id: TodoIdSchema,
  start: ISODateTimeSchema,
  end: ISODateTimeSchema,
  title: z.string().trim().min(1).max(280),
  tags: z.array(TagSchema).max(32),
  importance_score: z.number().min(0).max(100).finite().nullable(),
  importance_at_placement: TaskImportanceSchema.nullable().default(null),
  duration_min: z.number().int().min(0).max(60 * 24 * 30),
  placed_by: PlacedBySchema,
  placed_at: ISODateTimeSchema,
  policy_hash: z.string().nullable().default(null),
  locked: z.boolean().default(false),
});

export type Placement = z.infer<typeof PlacementSchema>;
