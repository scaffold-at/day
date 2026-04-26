import {
  defaultHomeDir,
  detectAvailableProviders,
  MockAIProvider,
  pathExists,
  type ProviderProbeResult,
  readPolicyYaml,
  readSchemaVersionFile,
  ScaffoldError,
  schemaVersionPath,
} from "@scaffold/day-core";
import path from "node:path";
import pkg from "../../package.json" with { type: "json" };
import { colors } from "../cli/colors";
import type { Command } from "../cli/command";

type Status = "ok" | "warn" | "error" | "info";

type Line = {
  status: Status;
  text: string;
  /** Detail lines indented under the parent. */
  detail?: string[];
};

type Section = {
  title: string;
  lines: Line[];
};

function statusGlyph(s: Status): string {
  switch (s) {
    case "ok":
      return colors.emerald("✓");
    case "warn":
      return colors.amber("⚠");
    case "error":
      return colors.red("✗");
    case "info":
      return colors.dim("·");
  }
}

function sectionToLines(section: Section): string[] {
  const out: string[] = [];
  out.push(colors.bold(section.title));
  for (const line of section.lines) {
    out.push(`  ${statusGlyph(line.status)} ${line.text}`);
    for (const d of line.detail ?? []) {
      out.push(`      ${colors.dim(d)}`);
    }
  }
  return out;
}

async function buildEnvironmentSection(home: string): Promise<Section> {
  const lines: Line[] = [];
  const homeExists = await pathExists(home);
  if (homeExists) {
    lines.push({ status: "ok", text: `home: ${home}` });
  } else {
    lines.push({
      status: "warn",
      text: `home: ${home}`,
      detail: ["directory does not exist yet — run `scaffold-day init` (placeholder until §S29.5)"],
    });
  }

  const schemaPath = schemaVersionPath(home);
  if (await pathExists(schemaPath)) {
    try {
      const file = await readSchemaVersionFile(home);
      lines.push({
        status: "ok",
        text: `schema_version: ${file.schema_version}`,
        detail: [`scaffold_day_version: ${file.scaffold_day_version}`],
      });
    } catch (err) {
      lines.push({
        status: "error",
        text: `schema_version: malformed`,
        detail: [(err as Error).message],
      });
    }
  } else {
    lines.push({
      status: "warn",
      text: "schema_version: missing",
      detail: ["initialize the home with `scaffold-day init`"],
    });
  }

  const yaml = await readPolicyYaml(home);
  if (yaml === null) {
    lines.push({
      status: "warn",
      text: "policy/current.yaml: missing",
      detail: ["seed via `scaffold-day policy preset apply balanced`"],
    });
  } else {
    lines.push({
      status: "ok",
      text: `policy/current.yaml: present (${yaml.length} chars)`,
    });
  }

  const lockPath = path.join(home, ".scaffold-day", "lock");
  if (await pathExists(lockPath)) {
    lines.push({
      status: "info",
      text: `lock: present (${lockPath})`,
      detail: ["another scaffold-day process may be running, or a previous run crashed"],
    });
  } else {
    lines.push({ status: "ok", text: "lock: free" });
  }

  lines.push({ status: "info", text: `bun: ${Bun.version}` });
  lines.push({ status: "info", text: `scaffold-day: ${pkg.version}` });
  return { title: "Environment", lines };
}

async function buildProvidersSection(probe: boolean): Promise<{
  section: Section;
  results: Array<ProviderProbeResult & { roundtrip_ms?: number; roundtrip_error?: string }>;
}> {
  const results = (await detectAvailableProviders()) as Array<
    ProviderProbeResult & { roundtrip_ms?: number; roundtrip_error?: string }
  >;
  const lines: Line[] = [];

  for (const r of results) {
    if (!r.available) {
      lines.push({
        status: r.id === "mock" ? "error" : "warn",
        text: `${r.id}: unavailable`,
        detail: r.note ? [r.note] : undefined,
      });
      continue;
    }

    const detail: string[] = [];
    if (r.capabilities) {
      detail.push(
        `Tier ${r.capabilities.tier} · cost ${r.capabilities.approx_cost_per_call} · context ~${r.capabilities.approx_context_window.toLocaleString()}`,
      );
    }

    // Roundtrip test: zero-cost providers run by default; metered
    // providers require --probe so a routine `doctor` doesn't burn
    // tokens on every call.
    const shouldProbe =
      probe || (r.capabilities && r.capabilities.approx_cost_per_call === "zero");
    if (shouldProbe) {
      try {
        const rt = await runRoundtrip(r.id);
        r.roundtrip_ms = rt.ms;
        detail.push(`roundtrip: ${rt.ms} ms (${rt.note})`);
      } catch (err) {
        r.roundtrip_error = err instanceof Error ? err.message : String(err);
        detail.push(`roundtrip: failed — ${r.roundtrip_error}`);
        lines.push({ status: "error", text: `${r.id}: roundtrip failed`, detail });
        continue;
      }
    } else {
      detail.push("roundtrip: skipped (re-run with --probe to exercise)");
    }

    lines.push({ status: "ok", text: `${r.id}: healthy`, detail });
  }

  return {
    section: { title: "AI Providers", lines },
    results,
  };
}

async function runRoundtrip(id: string): Promise<{ ms: number; note: string }> {
  // Run a tiny scoreImportance against the named provider. We construct
  // a fresh adapter rather than reuse the detect.ts instances so the
  // probe is independent of caching.
  const start = performance.now();
  if (id === "mock") {
    const p = new MockAIProvider();
    const result = await p.scoreImportance({ title: "doctor probe" });
    return {
      ms: Math.round(performance.now() - start),
      note: `urgency=${result.urgency}, deadline=${result.deadline}`,
    };
  }
  if (id === "claude-cli") {
    // Lazy import to avoid spawning by accident.
    const { ClaudeCliProvider } = await import("@scaffold/day-core");
    const p = new ClaudeCliProvider({ timeoutMs: 30_000 });
    const result = await p.scoreImportance({ title: "doctor probe" });
    return {
      ms: Math.round(performance.now() - start),
      note: `urgency=${result.urgency}`,
    };
  }
  throw new ScaffoldError({
    code: "DAY_PROVIDER_UNSUPPORTED",
    summary: { en: `doctor probe is not wired for provider '${id}'` },
    cause: "Add a runRoundtrip() branch in commands/doctor.ts.",
    try: ["Skip with --json or report as a bug."],
  });
}

function buildAdaptersSection(): Section {
  return {
    title: "Adapters",
    lines: [
      {
        status: "info",
        text: "google-calendar: deferred",
        detail: [
          "real OAuth + sync land in §S27–§S31c",
          "v0.1 ships fixture-based mock adapter (project memory: project_test_strategy)",
        ],
      },
    ],
  };
}

function summarize(sections: Section[]): { ok: number; warn: number; error: number; info: number } {
  const counts = { ok: 0, warn: 0, error: 0, info: 0 };
  for (const s of sections) {
    for (const l of s.lines) counts[l.status]++;
  }
  return counts;
}

export const doctorCommand: Command = {
  name: "doctor",
  summary: "diagnose home + AI providers + adapters",
  help: {
    what: "Read-only health check across Environment (home, schema_version, lock, policy presence, bun + scaffold-day versions), AI Providers (catalog detect, capabilities, optional roundtrip), and Adapters (Google Calendar deferred for now).",
    when: "When something feels wrong, before reporting a bug, or after a self-update.",
    cost: "Local checks plus a light roundtrip ping per zero-cost provider. Subscription / per-token providers are skipped unless --probe is given (so routine doctor calls don't burn tokens).",
    input: "[--json] for machine output. [--probe] to also exercise subscription / per-token providers.",
    return: "Exit 0 if no errors. Exit 70 (DAY_INTERNAL) on internal failure; provider issues remain non-fatal warnings unless they block the catalog entirely.",
    gotcha: "doctor is strictly read-only. Tracking SLICES.md §S35 + §S33 + §S34.",
  },
  run: async (args) => {
    const json = args.includes("--json");
    const probe = args.includes("--probe");
    for (const a of args) {
      if (a !== "--json" && a !== "--probe") {
        throw new ScaffoldError({
          code: "DAY_USAGE",
          summary: { en: `doctor: unexpected argument '${a}'` },
          cause: "Run `scaffold-day doctor --help` for the input contract.",
          try: ["Drop the unknown argument or use --json / --probe."],
        });
      }
    }
    const home = defaultHomeDir();

    const env = await buildEnvironmentSection(home);
    const providers = await buildProvidersSection(probe);
    const adapters = buildAdaptersSection();
    const sections = [env, providers.section, adapters];
    const counts = summarize(sections);

    if (json) {
      console.log(
        JSON.stringify(
          {
            scaffold_day_version: pkg.version,
            home,
            sections: sections.map((s) => ({
              title: s.title,
              lines: s.lines,
            })),
            providers: providers.results,
            summary: counts,
          },
          null,
          2,
        ),
      );
      return 0;
    }

    const out: string[] = [];
    out.push(colors.cyan("─".repeat(46)));
    out.push(colors.bold(`scaffold-day · doctor · v${pkg.version}`));
    out.push(colors.cyan("─".repeat(46)));
    for (const s of sections) {
      out.push("");
      out.push(...sectionToLines(s));
    }
    out.push("");
    out.push(
      colors.dim(
        `Summary: ${counts.ok} ok · ${counts.warn} warn · ${counts.error} error · ${counts.info} info`,
      ),
    );
    console.log(out.join("\n"));
    return 0;
  },
};
