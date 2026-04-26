import { z } from "zod";
import { ISOTimeSchema, TagSchema } from "../ids/schemas";

const NoPlacementInSchema = z
  .object({
    kind: z.literal("no_placement_in"),
    start: ISOTimeSchema,
    end: ISOTimeSchema,
  })
  .strict();

const NoOverlapWithTagSchema = z
  .object({
    kind: z.literal("no_overlap_with_tag"),
    tag: TagSchema,
  })
  .strict();

const MinBufferAroundMeetingMinSchema = z
  .object({
    kind: z.literal("min_buffer_around_meeting_min"),
    minutes: z.number().int().min(0).max(120),
  })
  .strict();

const DurationCapPerDayMinSchema = z
  .object({
    kind: z.literal("duration_cap_per_day_min"),
    minutes: z.number().int().min(0).max(60 * 24),
  })
  .strict();

const RequireTagInRangeSchema = z
  .object({
    kind: z.literal("require_tag_in_range"),
    tag: TagSchema,
    start: ISOTimeSchema,
    end: ISOTimeSchema,
  })
  .strict();

export const HardRuleSchema = z.discriminatedUnion("kind", [
  NoPlacementInSchema,
  NoOverlapWithTagSchema,
  MinBufferAroundMeetingMinSchema,
  DurationCapPerDayMinSchema,
  RequireTagInRangeSchema,
]);

export type HardRule = z.infer<typeof HardRuleSchema>;
export type HardRuleKind = HardRule["kind"];
