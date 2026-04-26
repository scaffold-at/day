import { stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { ScaffoldError } from "../error";
import { ImportanceDimensionsSchema } from "../policy/importance";
import {
  type AIProvider,
  type ClassificationResult,
  type ClassifyEventInput,
  type ImportanceFromAI,
  type ProviderCapabilities,
  type ScoreImportanceInput,
} from "./provider";

export type ClaudeCliProviderOptions = {
  /** Override the binary lookup. Useful for tests injecting a fake. */
  command?: string;
  /** Total timeout per spawn, ms. Default 30 000. */
  timeoutMs?: number;
  /** PATH to search for the binary. Defaults to `process.env.PATH`. */
  searchPath?: string;
  /** Override `process.env.PATH` when spawning child processes. */
  spawnEnv?: Record<string, string | undefined>;
};

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_BINARY = "claude";

/** Best-effort PATH lookup that mirrors POSIX `which`. */
async function findOnPath(
  bin: string,
  searchPath: string,
): Promise<string | null> {
  // GUI-launched apps on macOS often have a stripped PATH; fall back
  // to a few well-known install dirs (Homebrew arm64, Homebrew x64,
  // /usr/local/bin) so an authenticated `claude` install doesn't
  // disappear when scaffold-day is launched from Spotlight.
  const fallback = [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
  ];
  const dirs = [
    ...searchPath.split(path.delimiter).filter(Boolean),
    ...fallback,
  ];
  for (const dir of dirs) {
    const candidate = path.join(dir, bin);
    try {
      const st = await stat(candidate);
      if (st.isFile() && (st.mode & 0o111) !== 0) return candidate;
    } catch {
      // missing / EACCES — keep walking
    }
  }
  return null;
}

const ImportanceWireSchema = ImportanceDimensionsSchema.extend({
  reasoning: z.string().min(1),
}).strict();

const ClassificationWireSchema = z
  .object({
    scores: z.record(z.number().min(0).max(1)),
    reasoning: z.string().min(1),
  })
  .strict();

/**
 * Real `AIProvider` adapter backed by the user's local `claude` CLI
 * (Anthropic Claude Code). Spawn-only; never imports
 * `@anthropic-ai/sdk` (PRD §11.5 explicitly rules out direct SDK
 * usage so scaffold-day doesn't manage API keys).
 *
 * Spawn contract (PRD §11.5.3 / SLICES §S33):
 *   - argv only (no shell)
 *   - stdin: pipe (so we can pass long prompts above ARG_MAX)
 *   - PATH search: explicit; falls back to /opt/homebrew/bin etc.
 *     when launched from a GUI shell
 *   - timeout: 30s default (configurable)
 *
 * `available()` returns `false` cleanly when the binary is missing
 * or not executable, so a fork without `claude` installed never sees
 * a thrown error from this provider — see `MockAIProvider` for the
 * fork-friendly default per `memory:project_test_strategy`.
 */
export class ClaudeCliProvider implements AIProvider {
  readonly id = "claude-cli";
  private readonly command: string;
  private readonly timeoutMs: number;
  private readonly searchPath: string;
  private readonly spawnEnv: Record<string, string | undefined>;
  private resolvedCommand: string | null = null;
  private cachedAvailable: boolean | null = null;

  constructor(options: ClaudeCliProviderOptions = {}) {
    this.command = options.command ?? DEFAULT_BINARY;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.searchPath = options.searchPath ?? process.env.PATH ?? "";
    this.spawnEnv = options.spawnEnv ?? (process.env as Record<string, string | undefined>);
  }

  async available(): Promise<boolean> {
    if (this.cachedAvailable !== null) return this.cachedAvailable;
    // If the caller passed an absolute path, trust it (subject to stat).
    if (path.isAbsolute(this.command)) {
      try {
        const st = await stat(this.command);
        if (!st.isFile() || (st.mode & 0o111) === 0) {
          this.cachedAvailable = false;
          return false;
        }
        this.resolvedCommand = this.command;
      } catch {
        this.cachedAvailable = false;
        return false;
      }
    } else {
      const resolved = await findOnPath(this.command, this.searchPath);
      if (!resolved) {
        this.cachedAvailable = false;
        return false;
      }
      this.resolvedCommand = resolved;
    }

    // Light spawn ping: --version is cheap and doesn't require auth.
    try {
      const ok = await this.spawnVersionCheck();
      this.cachedAvailable = ok;
      return ok;
    } catch {
      this.cachedAvailable = false;
      return false;
    }
  }

  capabilities(): ProviderCapabilities {
    return {
      supports_classification: true,
      supports_importance: true,
      approx_context_window: 200_000,
      approx_cost_per_call: "subscription",
      tier: 1,
    };
  }

  async scoreImportance(input: ScoreImportanceInput): Promise<ImportanceFromAI> {
    await this.assertAvailable();
    const prompt = this.renderImportancePrompt(input);
    const text = await this.run(prompt);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new ScaffoldError({
        code: "DAY_PROVIDER_UNSUPPORTED",
        summary: { en: "claude-cli returned non-JSON output" },
        cause: (err as Error).message,
        try: ["Re-run with --output-format json (handled by the provider)."],
        context: { stdout_excerpt: text.slice(0, 200) },
      });
    }
    const r = ImportanceWireSchema.safeParse(parsed);
    if (!r.success) {
      throw new ScaffoldError({
        code: "DAY_PROVIDER_UNSUPPORTED",
        summary: { en: "claude-cli scoreImportance response failed validation" },
        cause: r.error.message,
        try: ["Inspect the prompt and the model's response."],
      });
    }
    return {
      ...r.data,
      computed_by: "claude-cli",
    };
  }

  async classifyEvent(
    input: ClassifyEventInput,
    categories: readonly string[],
  ): Promise<ClassificationResult> {
    await this.assertAvailable();
    const prompt = this.renderClassifyPrompt(input, categories);
    const text = await this.run(prompt);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new ScaffoldError({
        code: "DAY_PROVIDER_UNSUPPORTED",
        summary: { en: "claude-cli returned non-JSON output" },
        cause: (err as Error).message,
        try: ["Re-run with --output-format json."],
        context: { stdout_excerpt: text.slice(0, 200) },
      });
    }
    const r = ClassificationWireSchema.safeParse(parsed);
    if (!r.success) {
      throw new ScaffoldError({
        code: "DAY_PROVIDER_UNSUPPORTED",
        summary: { en: "claude-cli classifyEvent response failed validation" },
        cause: r.error.message,
        try: ["Inspect the prompt and the model's response."],
      });
    }
    return {
      scores: r.data.scores,
      reasoning: r.data.reasoning,
      computed_by: "claude-cli",
    };
  }

  // ─── internals ────────────────────────────────────────────────────

  private async assertAvailable(): Promise<void> {
    if (!(await this.available())) {
      throw new ScaffoldError({
        code: "DAY_PROVIDER_UNAVAILABLE",
        summary: { en: "claude-cli is not available" },
        cause: `Could not locate or invoke '${this.command}' on PATH.`,
        try: [
          "Install Anthropic Claude Code (`brew install anthropic-claude` or per the docs).",
          "Run `claude login` to authenticate.",
          "Or use MockAIProvider for tests / forks.",
        ],
        context: { command: this.command, path_searched: this.searchPath },
      });
    }
  }

  private async spawnVersionCheck(): Promise<boolean> {
    if (!this.resolvedCommand) return false;
    const proc = Bun.spawn([this.resolvedCommand, "--version"], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: this.spawnEnv as Record<string, string>,
    });
    // Version probe always uses a generous fixed budget regardless of
    // the per-call `timeoutMs`. A short timeoutMs (set by callers that
    // want a tight scoreImportance/classifyEvent budget) should not
    // also time out shell startup on a slow runner.
    const timer = setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch {
        // already exited
      }
    }, 10_000);
    try {
      const code = await proc.exited;
      return code === 0;
    } finally {
      clearTimeout(timer);
    }
  }

  private async run(prompt: string): Promise<string> {
    if (!this.resolvedCommand) {
      throw new ScaffoldError({
        code: "DAY_PROVIDER_UNAVAILABLE",
        summary: { en: "claude-cli not resolved" },
        cause: "Internal: available() must be called before run().",
        try: ["Call available() first."],
      });
    }
    const proc = Bun.spawn(
      [
        this.resolvedCommand,
        "-p",
        prompt,
        "--output-format",
        "json",
        "--max-turns",
        "1",
      ],
      {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        env: this.spawnEnv as Record<string, string>,
      },
    );
    // Close stdin since we already pass the prompt via argv (the
    // ARG_MAX-overflow stdin path is reserved for the next slice; for
    // v0.1 prompts well within ARG_MAX this is sufficient).
    proc.stdin?.end();

    // Race the child's exit against a timeout. If the timeout fires
    // first, send SIGKILL and throw DAY_PROVIDER_TIMEOUT — this
    // guarantees the call resolves within `timeoutMs`, even if the
    // child holds stdout/stderr open after death.
    const TIMEOUT_MARKER = Symbol("timeout");
    const timeoutPromise = new Promise<typeof TIMEOUT_MARKER>((resolve) => {
      setTimeout(() => resolve(TIMEOUT_MARKER), this.timeoutMs).unref?.();
    });
    const winner = await Promise.race([proc.exited, timeoutPromise]);
    if (winner === TIMEOUT_MARKER) {
      try {
        proc.kill(9); // SIGKILL
      } catch {
        // already exited
      }
      throw new ScaffoldError({
        code: "DAY_PROVIDER_TIMEOUT",
        summary: { en: `claude-cli exceeded ${this.timeoutMs} ms` },
        cause: "The provider did not respond within the configured timeout.",
        try: [
          "Re-run with a longer timeout (provider option).",
          "Verify the model is online and authenticated.",
        ],
        context: { timeout_ms: this.timeoutMs },
      });
    }

    const code = winner;
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    if (code !== 0) {
      throw mapExitCode(code, stderr);
    }
    return stdout;
  }

  private renderImportancePrompt(input: ScoreImportanceInput): string {
    return [
      "You are scoring a TODO's importance dimensions for scaffold-day.",
      'Return STRICT JSON matching the shape: {"urgency": 0..10, "impact": 0..10, "effort": 0..10, "reversibility": 0..10, "external_dependency": boolean, "deadline": "hard"|"soft"|"none", "reasoning": string}.',
      "Do not include backticks, prose, or any text outside the JSON.",
      "",
      `Title: ${input.title}`,
      input.description ? `Description: ${input.description}` : "",
      input.tags && input.tags.length > 0 ? `Tags: ${input.tags.join(", ")}` : "",
      input.target_date ? `Target date: ${input.target_date}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  private renderClassifyPrompt(
    input: ClassifyEventInput,
    categories: readonly string[],
  ): string {
    return [
      "You are classifying a calendar event for scaffold-day.",
      `Categories: ${categories.join(", ")}.`,
      'Return STRICT JSON: {"scores": {"<category>": 0..1, ...}, "reasoning": string}.',
      "Each score is independent (no sum-to-1 constraint).",
      "Do not include backticks, prose, or any text outside the JSON.",
      "",
      `Title: ${input.title}`,
      input.description ? `Description: ${input.description}` : "",
      `Window: ${input.start} → ${input.end}`,
      input.tags && input.tags.length > 0 ? `Tags: ${input.tags.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }
}

function mapExitCode(code: number | null, stderr: string): ScaffoldError {
  const lower = stderr.toLowerCase();
  if (
    lower.includes("not authenticated") ||
    lower.includes("authentication") ||
    lower.includes("login")
  ) {
    return new ScaffoldError({
      code: "DAY_PROVIDER_AUTH_EXPIRED",
      summary: { en: "claude-cli is not authenticated" },
      cause: stderr.trim() || "claude exited with auth-related error.",
      try: ["Run `claude login` and re-run."],
      context: { exit_code: code },
    });
  }
  return new ScaffoldError({
    code: "DAY_PROVIDER_UNSUPPORTED",
    summary: { en: `claude-cli exited with code ${code ?? "<null>"}` },
    cause: stderr.trim() || "no stderr",
    try: ["Inspect the prompt and the claude-cli response."],
    context: { exit_code: code },
  });
}
