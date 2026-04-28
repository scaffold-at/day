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
 * Recovery block (PRD v0.2 §S62, design issue #2).
 *
 * When yesterday had a "forced-late" event — an event that ran past
 * working_hours.end + a soft threshold — today's morning window is
 * marked as a soft recovery block. Slots inside it accumulate a
 * negative score contribution, *not* a hard reject. The user can
 * still place there if needed; the engine just ranks them below.
 *
 * Defaults (chosen 2026-04-28):
 *   late_threshold_minutes_past_working_end = 120
 *                       — events ending 2h+ after working_hours.end
 *                         count as "forced late"
 *   morning_block_hours = 2
 *                       — first 2h of working_hours protected
 *   soft_penalty = 30   — score contribution per slot inside the
 *                         recovery window. Negative; engine adds it
 *                         when severity = "soft".
 *
 * Optional. Absent → engine skips evaluation.
 */
export const RecoveryBlockSchema = z
  .object({
    late_threshold_minutes_past_working_end: z
      .number()
      .int()
      .min(0)
      .default(120),
    morning_block_hours: z.number().min(0).max(12).default(2),
    soft_penalty: z.number().min(0).default(30),
  })
  .strict();
export type RecoveryBlock = z.infer<typeof RecoveryBlockSchema>;

/**
 * Cognitive load decay (PRD v0.2 §S59, design issue #2).
 *
 * Heavy tasks placed late in the day (i.e. many hours after the
 * morning anchor) get a soft score penalty. Light tasks are
 * unaffected. The penalty is *not* a hard reject — the engine still
 * lets the user place the slot if nothing else fits, just ranks it
 * below earlier candidates.
 *
 * Defaults (chosen by PO 2026-04-28; revisit on first dogfood pass):
 *   decay = "linear"             — predictable; exponential reserved
 *                                  for users who prefer steeper falloff
 *   full_capacity_window_hours = 4
 *                                  — first 4h after anchor are
 *                                    "no penalty" zone
 *   heavy_task_threshold_min = 60
 *                                  — TODOs whose duration_min ≥ 60 are
 *                                    "heavy"; tweak if v0.2 dogfooding
 *                                    shows this is too aggressive
 *   linear_penalty_per_hour = 10  — score points per hour past the
 *                                    capacity window (linear mode only)
 *   exponential_base = 2          — 2^overshoot - 1 hour-by-hour
 *                                    growth (exp mode only); not the
 *                                    default but kept as an opt-in
 *
 * Optional. When absent, the engine skips cognitive_load evaluation
 * (back-compat for v0.1 + v0.2-without-S59 policies).
 */
export const CognitiveLoadSchema = z
  .object({
    decay: z.enum(["linear", "exponential"]).default("linear"),
    full_capacity_window_hours: z.number().min(0).max(24).default(4),
    heavy_task_threshold_min: z.number().int().min(1).default(60),
    linear_penalty_per_hour: z.number().min(0).default(10),
    exponential_base: z.number().min(1).default(2),
  })
  .strict();
export type CognitiveLoad = z.infer<typeof CognitiveLoadSchema>;

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
    cognitive_load: CognitiveLoadSchema.optional(),
    recovery_block: RecoveryBlockSchema.optional(),
  })
  .strict();
export type Context = z.infer<typeof ContextSchema>;
