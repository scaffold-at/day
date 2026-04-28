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

/**
 * Sleep budget (PRD v0.2 §S58, design issue #2).
 *
 * The relative time model: instead of pinning sleep to absolute clock
 * times, the user declares how many hours they need ("min_hours") and
 * how many they prefer ("target_hours"). The placement engine
 * computes the candidate slot's *implied* sleep window — the gap
 * between the day's last activity and the next anchor estimate — and:
 *   - rejects the candidate as a hard violation when implied < min
 *   - applies a soft penalty when min ≤ implied < target
 *
 * Optional. When absent, the engine skips budget evaluation entirely
 * (back-compat for v0.1 policies).
 */
export const SleepBudgetSchema = z
  .object({
    target_hours: z.number().min(1).max(16).default(8),
    min_hours: z.number().min(1).max(16).default(6),
    /** Soft penalty per missing hour below `target` (down to `min`). */
    soft_penalty_per_hour: z.number().min(0).default(15),
  })
  .strict()
  .refine((s) => s.min_hours <= s.target_hours, {
    message: "sleep_budget.min_hours must be ≤ target_hours",
  });
export type SleepBudget = z.infer<typeof SleepBudgetSchema>;

export const ContextSchema = z
  .object({
    tz: z.string().min(1),
    working_hours: z.array(TimeRangeSchema).default([]),
    energy_peaks: z.array(TimeRangeSchema).default([]),
    protected_ranges: z.array(ProtectedRangeSchema).default([]),
    sleep_budget: SleepBudgetSchema.optional(),
  })
  .strict();
export type Context = z.infer<typeof ContextSchema>;
