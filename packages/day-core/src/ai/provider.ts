import { z } from "zod";
import {
  type ImportanceDimensions,
  ImportanceDimensionsSchema,
} from "../policy/importance";

/**
 * Cost class for a provider call (PRD §11.5.2).
 *
 *   zero          — local model or already-paid subscription, no marginal cost
 *   subscription  — paid via a flat subscription (Anthropic Pro / Max, etc.)
 *   per-token     — billed per token (raw API key, OpenAI metered)
 */
export const ProviderCostSchema = z.enum(["zero", "subscription", "per-token"]);
export type ProviderCost = z.infer<typeof ProviderCostSchema>;

/** Tier 1 / 2 / 3 per PRD §11.5.6. */
export const ProviderTierSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export type ProviderTier = z.infer<typeof ProviderTierSchema>;

export const ProviderCapabilitiesSchema = z
  .object({
    supports_classification: z.boolean(),
    supports_importance: z.boolean(),
    approx_context_window: z.number().int().positive(),
    approx_cost_per_call: ProviderCostSchema,
    tier: ProviderTierSchema,
  })
  .strict();
export type ProviderCapabilities = z.infer<typeof ProviderCapabilitiesSchema>;

export type ScoreImportanceInput = {
  title: string;
  description?: string | null;
  tags?: readonly string[];
  target_date?: string | null;
};

export type ClassifyEventInput = {
  title: string;
  description?: string | null;
  start: string;
  end: string;
  tags?: readonly string[];
};

export type ClassificationResult = {
  /** category id → score in [0, 1]. Sum is not required to be 1. */
  scores: Record<string, number>;
  reasoning: string;
  /** model id or attribution string (e.g. "claude-sonnet-4-5", "user", "mock"). */
  computed_by: string;
};

/** Importance dimensions returned by the AI; the score is then derived
 * deterministically by `computeImportanceScore` from policy weights. */
export type ImportanceFromAI = ImportanceDimensions & {
  reasoning: string;
  computed_by: string;
};

/**
 * Adapter for an AI client (`claude` CLI, `codex` CLI, mock, etc.).
 *
 * v0.1 ships:
 *   - `MockAIProvider` (always available; returns fixture data) —
 *     used by tests and any caller that just needs deterministic
 *     behavior without an external runtime.
 *   - `ClaudeCliProvider` (lands in §S33) — wraps `claude -p` via
 *     `Bun.spawn`; `available()` returns `false` cleanly when the
 *     binary is missing or unauthenticated.
 *
 * Methods MAY throw `DAY_PROVIDER_UNSUPPORTED` (when a capability is
 * declared `false` but the call is made anyway) or
 * `DAY_PROVIDER_UNAVAILABLE` (when the provider's runtime is not
 * reachable). All other failures should map to `DAY_PROVIDER_TIMEOUT`
 * or `DAY_PROVIDER_AUTH_EXPIRED`.
 */
export interface AIProvider {
  readonly id: string;
  available(): Promise<boolean>;
  capabilities(): ProviderCapabilities;
  scoreImportance(input: ScoreImportanceInput): Promise<ImportanceFromAI>;
  classifyEvent(
    input: ClassifyEventInput,
    categories: readonly string[],
  ): Promise<ClassificationResult>;
}

/** Round-trip helper for tests / docs. */
export function validateImportanceDimensions(
  candidate: unknown,
): ImportanceDimensions {
  return ImportanceDimensionsSchema.parse(candidate);
}
