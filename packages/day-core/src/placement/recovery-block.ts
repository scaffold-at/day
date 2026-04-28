/**
 * Recovery block evaluation (PRD v0.2 §S62, design issue #2).
 *
 * If yesterday had any event ending past `working_hours.end +
 * late_threshold_minutes`, today's morning window
 * (`working_hours.start` → `+ morning_block_hours`) is marked as a
 * soft recovery block. Slots inside that window accumulate a
 * negative score contribution; slots outside are unaffected.
 *
 * The block is *not* a hard reject — the engine still allows the
 * placement if nothing else fits, just ranks it below.
 *
 * Free of any I/O — pure scoring helper.
 */

import type { FixedEvent } from "../day";
import type { RecoveryBlock } from "../policy";

export type RecoveryBlockSeverity = "soft" | "ok" | "skip";

export type RecoveryBlockEvaluation = {
  severity: RecoveryBlockSeverity;
  /** Score contribution; ≤ 0 always. 0 when ok / skip. */
  penalty: number;
  /** True iff yesterday triggered the block. */
  triggered: boolean;
  reason: string;
};

export type RecoveryBlockInput = {
  /** Slot start ISO with TZ. */
  slot: { start: string };
  /** Yesterday's events on the slot's date - 1 day. */
  yesterdayEvents: readonly FixedEvent[];
  /**
   * Yesterday's working_hours.end as a wall-clock instant on the
   * yesterday date (ISO with TZ). null → can't evaluate.
   */
  yesterdayWorkingEnd: string | null;
  /**
   * Today's working_hours.start as a wall-clock instant on the
   * slot's date (ISO with TZ). null → can't evaluate.
   */
  todayWorkingStart: string | null;
  /** Policy field; null → skip. */
  policy: RecoveryBlock | null;
};

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

export function evaluateRecoveryBlock(
  input: RecoveryBlockInput,
): RecoveryBlockEvaluation {
  if (
    !input.policy ||
    !input.yesterdayWorkingEnd ||
    !input.todayWorkingStart
  ) {
    return {
      severity: "skip",
      penalty: 0,
      triggered: false,
      reason: "recovery_block not configured or working hours unknown",
    };
  }

  const thresholdMs =
    Date.parse(input.yesterdayWorkingEnd) +
    input.policy.late_threshold_minutes_past_working_end * MIN;

  const triggered = input.yesterdayEvents.some(
    (e) => Date.parse(e.end) > thresholdMs,
  );
  if (!triggered) {
    return {
      severity: "ok",
      penalty: 0,
      triggered: false,
      reason: "yesterday had no forced-late events",
    };
  }

  const blockStartMs = Date.parse(input.todayWorkingStart);
  const blockEndMs = blockStartMs + input.policy.morning_block_hours * HOUR;
  const slotMs = Date.parse(input.slot.start);

  if (slotMs < blockStartMs || slotMs >= blockEndMs) {
    return {
      severity: "ok",
      penalty: 0,
      triggered: true,
      reason: "outside the morning recovery window",
    };
  }

  return {
    severity: "soft",
    penalty: -input.policy.soft_penalty,
    triggered: true,
    reason: `inside the morning recovery window (yesterday ran late)`,
  };
}
