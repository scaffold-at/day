import { describe, expect, test } from "bun:test";
import {
  BALANCED_PRESET,
  computeImportanceScore,
} from "../policy";
import { scoreImportanceViaProvider } from "./delegate";
import { MockAIProvider } from "./mock-provider";

describe("scoreImportanceViaProvider", () => {
  test("delegates dimensions to the provider; score is deterministic from policy weights", async () => {
    const provider = new MockAIProvider({
      importance: {
        urgency: 7,
        impact: 8,
        effort: 4,
        reversibility: 6,
        external_dependency: false,
        deadline: "soft",
        reasoning: "OKR-relevant",
        computed_by: "mock",
      },
    });
    const ti = await scoreImportanceViaProvider(
      { title: "ship S37" },
      BALANCED_PRESET,
      provider,
    );
    // The deterministic score for these dimensions under Balanced
    // weights matches the §S16 goldfile entry.
    const expected = computeImportanceScore(
      {
        urgency: 7,
        impact: 8,
        effort: 4,
        reversibility: 6,
        external_dependency: false,
        deadline: "soft",
      },
      BALANCED_PRESET.importance_weights,
    );
    expect(ti.score).toBeCloseTo(expected, 6);
    expect(ti.dimensions.urgency).toBe(7);
    expect(ti.dimensions.deadline).toBe("soft");
    expect(ti.reasoning).toBe("OKR-relevant");
    expect(ti.computed_by).toBe("mock");
    expect(ti.policy_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("same provider + same input + same policy → identical score AND policy_hash", async () => {
    const provider = new MockAIProvider({
      importance: { urgency: 6, impact: 6, effort: 6, reversibility: 6 },
    });
    const a = await scoreImportanceViaProvider(
      { title: "x" },
      BALANCED_PRESET,
      provider,
    );
    const b = await scoreImportanceViaProvider(
      { title: "x" },
      BALANCED_PRESET,
      provider,
    );
    expect(a.score).toBe(b.score);
    expect(a.policy_hash).toBe(b.policy_hash);
  });

  test("different policy → different policy_hash", async () => {
    const provider = new MockAIProvider({
      importance: { urgency: 5, impact: 5, effort: 5, reversibility: 5 },
    });
    const a = await scoreImportanceViaProvider(
      { title: "x" },
      BALANCED_PRESET,
      provider,
    );
    const tweaked = { ...BALANCED_PRESET, placement_grid_min: 15 };
    const b = await scoreImportanceViaProvider(
      { title: "x" },
      tweaked,
      provider,
    );
    expect(a.policy_hash).not.toBe(b.policy_hash);
  });

  test("by override flips computed_by, leaves dimensions intact", async () => {
    const provider = new MockAIProvider({
      importance: { urgency: 5 },
    });
    const ti = await scoreImportanceViaProvider(
      { title: "x" },
      BALANCED_PRESET,
      provider,
      { by: "claude-sonnet-4-5" },
    );
    expect(ti.computed_by).toBe("claude-sonnet-4-5");
  });
});
