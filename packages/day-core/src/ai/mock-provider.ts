import {
  type AIProvider,
  type ClassificationResult,
  type ClassifyEventInput,
  type ImportanceFromAI,
  type ProviderCapabilities,
  type ScoreImportanceInput,
} from "./provider";

export type MockProviderFixture = {
  /** Defaults to `true`. When `false`, `available()` resolves false and
   * subsequent calls may throw — mirrors a real provider that's
   * uninstalled or unauthenticated. */
  available?: boolean;
  /** Override the importance dimensions returned by `scoreImportance`. */
  importance?: Partial<ImportanceFromAI>;
  /** Override the classification result. */
  classification?: ClassificationResult;
  /** Override the capabilities object. */
  capabilities?: Partial<ProviderCapabilities>;
  /** Override the provider id — useful when you want multiple mock
   * providers in a registry. */
  id?: string;
};

const DEFAULT_CAPABILITIES: ProviderCapabilities = {
  supports_classification: true,
  supports_importance: true,
  approx_context_window: 200_000,
  approx_cost_per_call: "zero",
  tier: 1,
};

const DEFAULT_IMPORTANCE: ImportanceFromAI = {
  urgency: 5,
  impact: 5,
  effort: 5,
  reversibility: 5,
  external_dependency: false,
  deadline: "none",
  reasoning: "mock provider — neutral defaults",
  computed_by: "mock",
};

/**
 * Deterministic AIProvider used by the test surface and by any caller
 * that wants a real provider's shape without spawning an external
 * runtime. Every call returns either the fixture-injected value or a
 * sane neutral default.
 */
export class MockAIProvider implements AIProvider {
  readonly id: string;
  private readonly fixture: MockProviderFixture;

  constructor(fixture: MockProviderFixture = {}) {
    this.id = fixture.id ?? "mock";
    this.fixture = fixture;
  }

  async available(): Promise<boolean> {
    return this.fixture.available ?? true;
  }

  capabilities(): ProviderCapabilities {
    return { ...DEFAULT_CAPABILITIES, ...this.fixture.capabilities };
  }

  async scoreImportance(_input: ScoreImportanceInput): Promise<ImportanceFromAI> {
    if (this.fixture.importance) {
      return { ...DEFAULT_IMPORTANCE, ...this.fixture.importance };
    }
    return DEFAULT_IMPORTANCE;
  }

  async classifyEvent(
    _input: ClassifyEventInput,
    categories: readonly string[],
  ): Promise<ClassificationResult> {
    if (this.fixture.classification) return this.fixture.classification;
    if (categories.length === 0) {
      return {
        scores: {},
        reasoning: "mock provider — empty category set",
        computed_by: this.id,
      };
    }
    const score = 1 / categories.length;
    const scores: Record<string, number> = {};
    for (const c of categories) scores[c] = score;
    return {
      scores,
      reasoning: "mock provider — uniform distribution",
      computed_by: this.id,
    };
  }
}
