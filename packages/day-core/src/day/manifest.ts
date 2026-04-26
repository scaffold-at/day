import { z } from "zod";
import { ISODateSchema, ISODateTimeSchema } from "../ids/schemas";

export const DayManifestEntrySchema = z.object({
  date: ISODateSchema,
  event_count: z.number().int().min(0),
  placement_count: z.number().int().min(0),
  conflicts_open_count: z.number().int().min(0),
  updated_at: ISODateTimeSchema,
});

export const DayManifestSchema = z.object({
  schema_version: z.string().min(1),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  days: z.array(DayManifestEntrySchema),
  updated_at: ISODateTimeSchema,
});

export type DayManifestEntry = z.infer<typeof DayManifestEntrySchema>;
export type DayManifest = z.infer<typeof DayManifestSchema>;
