import { z } from "zod";
import { ISODateSchema } from "../ids/schemas";
import { FixedEventSchema } from "./event";
import { PlacementSchema } from "./placement";

export const DaySchema = z.object({
  schema_version: z.string().min(1),
  date: ISODateSchema,
  events: z.array(FixedEventSchema).default([]),
  placements: z.array(PlacementSchema).default([]),
  /** Conflict ids open against this day. §S23 lands the ConflictId type. */
  conflicts_open: z.array(z.string()).default([]),
});

export type Day = z.infer<typeof DaySchema>;
