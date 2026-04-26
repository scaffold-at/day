import { mkdir, open } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { ISODateTimeSchema } from "../ids/schemas";
import { entityIdSchemaOf } from "../ids/entity-id";

const PlacementIdSchema = entityIdSchemaOf("placement");
const TodoIdSchema = entityIdSchemaOf("todo");

export const PlacementLogActionSchema = z.enum([
  "placed",
  "overridden",
  "removed",
]);
export type PlacementLogAction = z.infer<typeof PlacementLogActionSchema>;

export const PlacementLogEntrySchema = z.object({
  schema_version: z.string().min(1),
  at: ISODateTimeSchema,
  action: PlacementLogActionSchema,
  placement_id: PlacementIdSchema,
  todo_id: TodoIdSchema,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start: ISODateTimeSchema,
  end: ISODateTimeSchema,
  by: z.string().min(1),
  policy_hash: z.string().nullable(),
  reason: z.string().nullable(),
  /** For "overridden", the previous (start, end) the placement moved from. */
  previous: z
    .object({ start: ISODateTimeSchema, end: ISODateTimeSchema })
    .nullable(),
});
export type PlacementLogEntry = z.infer<typeof PlacementLogEntrySchema>;

export function placementLogPath(home: string, month: string): string {
  return path.join(home, "logs", month, "placements.jsonl");
}

/**
 * Append a single JSON Lines entry to `logs/YYYY-MM/placements.jsonl`.
 * The file is opened with O_APPEND so concurrent writers don't
 * clobber each other; the entry is fsync'd before close so the log
 * always reaches disk before the day file does (§S21 transactional
 * order: log → day).
 */
export async function appendPlacementLog(
  home: string,
  entry: PlacementLogEntry,
): Promise<void> {
  const validated = PlacementLogEntrySchema.parse(entry);
  const month = validated.date.slice(0, 7);
  const target = placementLogPath(home, month);
  await mkdir(path.dirname(target), { recursive: true });

  const fh = await open(target, "a", 0o600);
  try {
    await fh.writeFile(`${JSON.stringify(validated)}\n`);
    await fh.sync();
  } finally {
    await fh.close();
  }
}
