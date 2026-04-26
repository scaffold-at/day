import { z } from "zod";
import { entityIdSchemaOf } from "../ids/entity-id";
import { ISODateSchema, ISODateTimeSchema } from "../ids/schemas";

const ConflictIdSchema = entityIdSchemaOf("conflict");

export const ConflictKindSchema = z.enum([
  "overlap",
  "hard_rule_violation",
  "buffer_breach",
  "capacity_exceeded",
]);
export type ConflictKind = z.infer<typeof ConflictKindSchema>;

export const ConflictStatusSchema = z.enum(["open", "resolved", "ignored"]);
export type ConflictStatus = z.infer<typeof ConflictStatusSchema>;

export const ConflictSchema = z
  .object({
    id: ConflictIdSchema,
    date: ISODateSchema,
    kind: ConflictKindSchema,
    detected_at: ISODateTimeSchema,
    detector: z.string().min(1),
    /** Ids involved in the conflict (placements + events). */
    party_ids: z.array(z.string()).min(1),
    detail: z.string().min(1),
    /** When kind = hard_rule_violation, which HardRule kind triggered. */
    hard_rule_kind: z.string().nullable().default(null),
    status: ConflictStatusSchema,
    resolved_at: ISODateTimeSchema.nullable().default(null),
    resolved_by: z.string().nullable().default(null),
    resolution: z.record(z.unknown()).nullable().default(null),
  })
  .strict();
export type Conflict = z.infer<typeof ConflictSchema>;
