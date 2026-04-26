import { ClaudeCliProvider } from "./claude-cli-provider";
import { MockAIProvider } from "./mock-provider";
import type { AIProvider, ProviderCapabilities } from "./provider";

export type ProviderProbeResult = {
  id: string;
  available: boolean;
  capabilities?: ProviderCapabilities;
  /** A short note for the human-friendly init / doctor output. */
  note?: string;
};

export type DetectProvidersOptions = {
  /** Override the candidate list. Default: ClaudeCliProvider, MockAIProvider. */
  candidates?: ReadonlyArray<AIProvider>;
  /** Inject MockAIProvider too (default true) — useful for tests but
   * also keeps a fork-friendly fallback in the catalog. */
  includeMock?: boolean;
};

/**
 * Probe the v0.1 provider catalog and return a per-id availability
 * report. `init` (S29.5) and `doctor` (S35) consume this.
 *
 * The Mock provider is included by default so a fresh fork on a
 * machine without `claude` still has a usable provider for tests.
 */
export async function detectAvailableProviders(
  options: DetectProvidersOptions = {},
): Promise<ProviderProbeResult[]> {
  const includeMock = options.includeMock ?? true;
  const candidates: AIProvider[] = options.candidates
    ? [...options.candidates]
    : [
        new ClaudeCliProvider(),
        ...(includeMock ? [new MockAIProvider()] : []),
      ];

  const results = await Promise.all(
    candidates.map(async (p): Promise<ProviderProbeResult> => {
      const available = await p.available();
      if (!available) {
        return {
          id: p.id,
          available: false,
          note:
            p.id === "claude-cli"
              ? "binary not found on PATH — install Claude Code or set --client-id when calling init"
              : undefined,
        };
      }
      return {
        id: p.id,
        available: true,
        capabilities: p.capabilities(),
      };
    }),
  );
  return results;
}
