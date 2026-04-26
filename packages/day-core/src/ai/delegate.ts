import {
  makeTaskImportance,
  type Policy,
  type TaskImportance,
} from "../policy";
import type {
  AIProvider,
  ImportanceFromAI,
  ScoreImportanceInput,
} from "./provider";

export type ScoreImportanceViaProviderOptions = {
  /** Override the `computed_by` recorded on the TaskImportance. Defaults to whatever the provider returned. */
  by?: string;
};

/**
 * AI-delegated importance scoring (PRD §S37).
 *
 *   1. provider.scoreImportance(input) → dimensions + reasoning
 *   2. makeTaskImportance(dims, policy) → deterministic score +
 *      policy_hash + audit metadata
 *
 * The score itself is computed deterministically from the AI-judged
 * dimensions and the active policy weights, so `same model + same
 * dimensions + same policy → same score AND same policy_hash`. This
 * is the property the SLICES §S16 tests already cover; this helper
 * just wires AI into the front of the pipeline.
 */
export async function scoreImportanceViaProvider(
  input: ScoreImportanceInput,
  policy: Policy,
  provider: AIProvider,
  options: ScoreImportanceViaProviderOptions = {},
): Promise<TaskImportance> {
  const aiResult = await provider.scoreImportance(input);
  return await makeTaskImportance(stripAIMeta(aiResult), policy, {
    reasoning: aiResult.reasoning,
    computedBy: options.by ?? aiResult.computed_by,
  });
}

function stripAIMeta(ai: ImportanceFromAI) {
  // Drop AI-only fields so the dimensions object matches the
  // ImportanceDimensions schema exactly.
  const { reasoning: _r, computed_by: _c, ...dims } = ai;
  return dims;
}
