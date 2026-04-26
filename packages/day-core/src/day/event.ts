import { z } from "zod";
import { entityIdSchemaOf } from "../ids/entity-id";
import { ISODateTimeSchema, TagSchema } from "../ids/schemas";

const EventIdSchema = entityIdSchemaOf("event");

export const EventSourceSchema = z.enum(["manual", "google-calendar"]);
export type EventSource = z.infer<typeof EventSourceSchema>;

export const RecurringSchema = z
  .object({
    parent_id: z.string().min(1),
    rrule: z.string().min(1),
  })
  .nullable();

export const FixedEventSchema = z.object({
  id: EventIdSchema,
  source: EventSourceSchema,
  external_id: z.string().nullable(),
  title: z.string().trim().min(1).max(280),
  start: ISODateTimeSchema,
  end: ISODateTimeSchema,
  all_day: z.boolean(),
  location: z.string().nullable(),
  notes: z.string().nullable(),
  recurring: RecurringSchema,
  tags: z.array(TagSchema).max(32),
  synced_at: ISODateTimeSchema,
});

export type FixedEvent = z.infer<typeof FixedEventSchema>;
