import { ScaffoldError } from "../error";
import type { AIProvider } from "./provider";

/**
 * In-memory provider registry. v0.1 holds either `MockAIProvider`
 * (tests / fork-friendly default) or `ClaudeCliProvider` (S33). v0.2+
 * adds codex/gemini/llm/ollama.
 *
 * Resolution order:
 *   1. caller passes a `primary` id → registry returns that provider
 *      if registered; throws `DAY_PROVIDER_UNAVAILABLE` if not.
 *   2. otherwise: first available provider (in registration order)
 *      whose `available()` resolves true.
 */
export class ProviderRegistry {
  private readonly providers: AIProvider[] = [];

  register(provider: AIProvider): this {
    if (this.providers.some((p) => p.id === provider.id)) {
      throw new Error(`provider '${provider.id}' is already registered`);
    }
    this.providers.push(provider);
    return this;
  }

  unregister(id: string): boolean {
    const idx = this.providers.findIndex((p) => p.id === id);
    if (idx === -1) return false;
    this.providers.splice(idx, 1);
    return true;
  }

  get(id: string): AIProvider | undefined {
    return this.providers.find((p) => p.id === id);
  }

  list(): readonly AIProvider[] {
    return [...this.providers];
  }

  async availableProviders(): Promise<AIProvider[]> {
    const checks = await Promise.all(
      this.providers.map(async (p) => ({ p, ok: await p.available() })),
    );
    return checks.filter((c) => c.ok).map((c) => c.p);
  }

  /**
   * Resolve a usable provider. If `primary` is given, returns that
   * provider (when registered + available). Otherwise picks the first
   * available provider in registration order. Throws
   * `DAY_PROVIDER_UNAVAILABLE` if nothing usable.
   */
  async resolve(primary?: string): Promise<AIProvider> {
    if (primary !== undefined) {
      const p = this.get(primary);
      if (!p) {
        throw new ScaffoldError({
          code: "DAY_PROVIDER_UNAVAILABLE",
          summary: { en: `provider '${primary}' is not registered` },
          cause: `Registered providers: ${this.providers.map((x) => x.id).join(", ") || "(none)"}.`,
          try: ["Register the provider before calling resolve()."],
          context: { id: primary, registered: this.providers.map((x) => x.id) },
        });
      }
      if (!(await p.available())) {
        throw new ScaffoldError({
          code: "DAY_PROVIDER_UNAVAILABLE",
          summary: { en: `provider '${primary}' is not available` },
          cause: `provider.available() returned false.`,
          try: [
            "Check the binary/runtime is installed and authenticated.",
            "Or fall back to another provider with `resolve()` (no primary).",
          ],
          context: { id: primary },
        });
      }
      return p;
    }

    const available = await this.availableProviders();
    if (available.length === 0) {
      throw new ScaffoldError({
        code: "DAY_PROVIDER_UNAVAILABLE",
        summary: { en: "no AI provider is available" },
        cause: `Registered providers: ${this.providers.map((x) => x.id).join(", ") || "(none)"}; none reported available().`,
        try: [
          "Register a MockAIProvider for fork-friendly testing.",
          "Install and authenticate `claude` to enable ClaudeCliProvider (S33).",
        ],
        context: { registered: this.providers.map((x) => x.id) },
      });
    }
    return available[0]!;
  }
}
