import { defaultHomeDir, ScaffoldError } from "@scaffold/day-core";
import type { Command } from "../cli/command";
import { commands } from "../cli/registry";
import { buildBundle, renderMarkdown, renderYaml } from "./docs-bundle";

type Format = "markdown" | "json" | "yaml";

function usage(message: string): ScaffoldError {
  return new ScaffoldError({
    code: "DAY_USAGE",
    summary: { en: message },
    cause: "See `scaffold-day docs --help`.",
    try: ["Run `scaffold-day docs --help`."],
  });
}

function takeValue(args: string[], i: number, flag: string): string {
  const v = args[i + 1];
  if (v === undefined || v.startsWith("--")) {
    throw usage(`docs: ${flag} requires a value`);
  }
  return v;
}

export async function runDocsForAi(args: string[]): Promise<number> {
  let format: Format = "markdown";
  let scope: "all" | "cli" | "mcp" = "all";
  let filter: string[] | null = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? "";
    if (a === "--for-ai") {
      // already in this branch
    } else if (a === "--format") {
      const v = takeValue(args, i, "--format");
      if (v !== "markdown" && v !== "json" && v !== "yaml") {
        throw new ScaffoldError({
          code: "DAY_INVALID_INPUT",
          summary: { en: `--format must be markdown|json|yaml` },
          cause: `Got: ${v}`,
          try: ["Pick one of markdown, json, yaml."],
        });
      }
      format = v;
      i++;
    } else if (a === "--cli-only") {
      scope = "cli";
    } else if (a === "--mcp-only") {
      scope = "mcp";
    } else if (a === "--commands") {
      filter = takeValue(args, i, "--commands").split(",").map((s) => s.trim()).filter(Boolean);
      i++;
    } else {
      throw usage(`docs: unexpected argument '${a}'`);
    }
  }

  const bundle = buildBundle({
    commands,
    filterCli: filter,
    scope,
    home: defaultHomeDir(),
  });
  if (format === "json") {
    console.log(JSON.stringify(bundle, null, 2));
  } else if (format === "yaml") {
    console.log(renderYaml(bundle));
  } else {
    console.log(renderMarkdown(bundle));
  }
  return 0;
}

export const docsCommand: Command = {
  name: "docs",
  summary: "emit a single AI-readable dump of the scaffold-day surface",
  help: {
    what: "`docs --for-ai` returns the entire surface — CLI commands + MCP tools + JTBD recipes — in markdown / json / yaml so an AI client can paste it once and stay token-efficient.",
    when: "When booting a fresh AI session that needs to reason about scaffold-day. Or as the source of `AGENTS.md` (§S53.7) and the docs site (§S53/§S53.8).",
    cost: "Local, in-memory. No file I/O beyond reading the registry.",
    input: "--for-ai [--format markdown|json|yaml] [--cli-only|--mcp-only] [--commands name,name,...]",
    return: "Stdout. Exit 0.",
    gotcha: "v0.1 emits ~10K char markdown for the full bundle (well within Claude's window). Use --commands to fetch a sliver. Tracking SLICES.md §S53.5 (cmd) / §S53.7 (AGENTS.md generator) / §S53.8 (CLI reference).",
  },
  run: async (args) => {
    if (!args.includes("--for-ai")) {
      throw usage("docs: pass --for-ai (the only mode in v0.1)");
    }
    return runDocsForAi(args);
  },
};
