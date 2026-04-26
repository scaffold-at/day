import { z } from "zod";
import { ContextSchema } from "./context";
import { HardRuleSchema } from "./hard-rule";
import { SoftPreferenceSchema } from "./soft-preference";

/**
 * Optional ai_provider section (PRD §11.5.4). When present, the
 * primary provider id is the one `init` selected (or the user
 * promoted manually); fallback is consulted in order. v0.1 records
 * the choice but does not yet auto-resolve a chain — single primary
 * with hand-coded fallback semantics until §S37 wires AI delegation.
 */
export const AIProviderConfigSchema = z
  .object({
    primary: z.string().min(1),
    fallback: z.array(z.string().min(1)).default([]),
    config: z.record(z.unknown()).default({}),
  })
  .strict();
export type AIProviderConfig = z.infer<typeof AIProviderConfigSchema>;

export const ReactivityLevelSchema = z.enum(["low", "balanced", "high"]);
export type ReactivityLevel = z.infer<typeof ReactivityLevelSchema>;

export const ImportanceWeightsSchema = z
  .object({
    urgency: z.number().finite().default(1.5),
    impact: z.number().finite().default(2.0),
    effort: z.number().finite().default(0.8),
    reversibility: z.number().finite().default(1.0),
    time_sensitivity: z.number().finite().default(0.0),
    external_dependency: z.number().finite().default(0.0),
    hard_deadline_bonus: z.number().finite().default(15),
    soft_deadline_bonus: z.number().finite().default(8),
    external_dependency_bonus: z.number().finite().default(5),
  })
  .strict();
export type ImportanceWeights = z.infer<typeof ImportanceWeightsSchema>;

export const ConflictThresholdsSchema = z
  .object({
    auto_resolve_max_score: z.number().int().min(0).max(100).default(40),
    decisive_gap_score: z.number().int().min(0).max(100).default(20),
  })
  .strict();
export type ConflictThresholds = z.infer<typeof ConflictThresholdsSchema>;

export const PolicySchema = z
  .object({
    schema_version: z.string().min(1).default("0.1.0"),
    preset: z.string().min(1).optional(),
    context: ContextSchema,
    hard_rules: z.array(HardRuleSchema).default([]),
    soft_preferences: z.array(SoftPreferenceSchema).default([]),
    reactivity: ReactivityLevelSchema.default("balanced"),
    importance_weights: ImportanceWeightsSchema.default(
      ImportanceWeightsSchema.parse({}),
    ),
    conflict_thresholds: ConflictThresholdsSchema.default(
      ConflictThresholdsSchema.parse({}),
    ),
    placement_grid_min: z.number().int().min(5).max(120).default(30),
    ai_provider: AIProviderConfigSchema.optional(),
  })
  .strict();
export type Policy = z.infer<typeof PolicySchema>;

/**
 * Stable hash of the parsed policy. Used by §S16 / §S25 to record
 * which policy was in effect for a given placement / score so the
 * decision can be replayed even after the user edits the policy.
 */
export async function policyHash(policy: Policy): Promise<string> {
  const canonical = JSON.stringify(policy);
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
