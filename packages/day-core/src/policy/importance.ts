import { z } from "zod";
import { ISODateTimeSchema, ModelIdSchema } from "../ids/schemas";
import {
  type ImportanceWeights,
  ImportanceWeightsSchema,
  type Policy,
  policyHash,
} from "./policy";

export const DeadlineKindSchema = z.enum(["hard", "soft", "none"]);
export type DeadlineKind = z.infer<typeof DeadlineKindSchema>;

export const ImportanceDimensionsSchema = z
  .object({
    urgency: z.number().min(0).max(10).finite(),
    impact: z.number().min(0).max(10).finite(),
    effort: z.number().min(0).max(10).finite(),
    reversibility: z.number().min(0).max(10).finite(),
    time_sensitivity: z.number().min(0).max(10).finite().optional(),
    external_dependency: z.boolean().default(false),
    deadline: DeadlineKindSchema.default("none"),
  })
  .strict();

export type ImportanceDimensions = z.infer<typeof ImportanceDimensionsSchema>;

const COMPUTED_BY_SCHEMA = z.union([z.literal("user"), ModelIdSchema, z.literal("ai")]);

export const TaskImportanceSchema = z
  .object({
    score: z.number().min(0).max(100).finite(),
    dimensions: ImportanceDimensionsSchema,
    reasoning: z.string().min(1),
    computed_at: ISODateTimeSchema,
    computed_by: COMPUTED_BY_SCHEMA,
    policy_hash: z.string().regex(/^[0-9a-f]{64}$/, "policy_hash must be a 64-char SHA-256 hex"),
  })
  .strict();

export type TaskImportance = z.infer<typeof TaskImportanceSchema>;

const EPS = 1e-9;

/**
 * Pure deterministic Importance Score (PRD §10.2).
 *
 *   inner = urgency*w_u + impact*w_i - effort*w_e + (10-reversibility)*w_r
 *   base  = 10 * inner / (w_u + w_i + w_e + w_r)
 *   score = clamp(0, 100, base + deadline_bonus + external_dependency_bonus)
 *
 * `deadline = "hard"` adds `hard_deadline_bonus`; `"soft"` adds
 * `soft_deadline_bonus`; `"none"` adds nothing. `external_dependency`
 * is independent.
 *
 * `time_sensitivity` is parsed but does not affect the score in v0.1
 * — it's reserved for a future weight wiring (currently the weight
 * defaults to 0 in the Balanced preset, so contribution is zero
 * either way).
 */
export function computeImportanceScore(
  dimensions: ImportanceDimensions,
  weights: ImportanceWeights,
): number {
  const sumW =
    weights.urgency + weights.impact + weights.effort + weights.reversibility;
  if (sumW < EPS) return 0;

  const inner =
    dimensions.urgency * weights.urgency +
    dimensions.impact * weights.impact -
    dimensions.effort * weights.effort +
    (10 - dimensions.reversibility) * weights.reversibility;

  let score = (10 * inner) / sumW;

  if (dimensions.deadline === "hard") score += weights.hard_deadline_bonus;
  else if (dimensions.deadline === "soft") score += weights.soft_deadline_bonus;

  if (dimensions.external_dependency) {
    score += weights.external_dependency_bonus;
  }

  return Math.max(0, Math.min(100, score));
}

/**
 * Wrap a freshly computed score into a `TaskImportance` record with
 * the originating policy hash recorded for replay (§S25 explain
 * relies on this).
 */
export async function makeTaskImportance(
  dimensions: ImportanceDimensions,
  policy: Policy,
  options: {
    reasoning: string;
    computedBy: TaskImportance["computed_by"];
    computedAt?: string;
  },
): Promise<TaskImportance> {
  const validated = ImportanceDimensionsSchema.parse(dimensions);
  const weights = ImportanceWeightsSchema.parse(policy.importance_weights);
  const score = computeImportanceScore(validated, weights);
  const hash = await policyHash(policy);
  const importance: TaskImportance = {
    score,
    dimensions: validated,
    reasoning: options.reasoning,
    computed_at: options.computedAt ?? new Date().toISOString(),
    computed_by: options.computedBy,
    policy_hash: hash,
  };
  // Round-trip validate to catch any subtle drift.
  return TaskImportanceSchema.parse(importance);
}
