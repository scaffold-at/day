import { z } from "zod";
import { ISOTimeSchema } from "../ids/schemas";

export const DAYS_OF_WEEK = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export const DayOfWeekSchema = z.enum(DAYS_OF_WEEK);
export type DayOfWeek = z.infer<typeof DayOfWeekSchema>;

export const TimeRangeSchema = z
  .object({
    start: ISOTimeSchema,
    end: ISOTimeSchema,
    days: z.array(DayOfWeekSchema).default([...DAYS_OF_WEEK]),
  })
  .strict();
export type TimeRange = z.infer<typeof TimeRangeSchema>;

export const ProtectedRangeSchema = z
  .object({
    start: ISOTimeSchema,
    end: ISOTimeSchema,
    label: z.string().min(1),
    days: z.array(DayOfWeekSchema).default([...DAYS_OF_WEEK]),
  })
  .strict();
export type ProtectedRange = z.infer<typeof ProtectedRangeSchema>;

export const ContextSchema = z
  .object({
    tz: z.string().min(1),
    working_hours: z.array(TimeRangeSchema).default([]),
    energy_peaks: z.array(TimeRangeSchema).default([]),
    protected_ranges: z.array(ProtectedRangeSchema).default([]),
  })
  .strict();
export type Context = z.infer<typeof ContextSchema>;
