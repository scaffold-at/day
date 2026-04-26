import { z } from "zod";
import { ISOTimeSchema, TagSchema } from "../ids/schemas";

const PreferTagInRangeSchema = z
  .object({
    kind: z.literal("prefer_tag_in_range"),
    tag: TagSchema,
    start: ISOTimeSchema,
    end: ISOTimeSchema,
    weight: z.number().finite(),
  })
  .strict();

const AvoidBackToBackAfterMinSchema = z
  .object({
    kind: z.literal("avoid_back_to_back_after_min"),
    minutes: z.number().int().min(0).max(60 * 8),
    weight: z.number().finite(),
  })
  .strict();

const ClusterSameTagSchema = z
  .object({
    kind: z.literal("cluster_same_tag"),
    weight: z.number().finite(),
  })
  .strict();

const AvoidTagAfterTimeSchema = z
  .object({
    kind: z.literal("avoid_tag_after_time"),
    tag: TagSchema,
    after: ISOTimeSchema,
    weight: z.number().finite(),
  })
  .strict();

const EnergyPeakBonusSchema = z
  .object({
    kind: z.literal("energy_peak_bonus"),
    weight: z.number().finite(),
  })
  .strict();

export const SoftPreferenceSchema = z.discriminatedUnion("kind", [
  PreferTagInRangeSchema,
  AvoidBackToBackAfterMinSchema,
  ClusterSameTagSchema,
  AvoidTagAfterTimeSchema,
  EnergyPeakBonusSchema,
]);

export type SoftPreference = z.infer<typeof SoftPreferenceSchema>;
export type SoftPreferenceKind = SoftPreference["kind"];
