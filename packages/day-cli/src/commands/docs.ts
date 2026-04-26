import {
  defaultHomeDir,
  ScaffoldError,
} from "@scaffold/day-core";
import { TOOLS as MCP_TOOLS } from "@scaffold/day-mcp";
import pkg from "../../package.json" with { type: "json" };
import type { Command } from "../cli/command";
import { formatCommandHelp } from "../cli/help";
import { commands } from "../cli/registry";

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

type DocsBundle = {
  scaffold_day: {
    version: string;
    home: string;
  };
  cli: Array<{
    name: string;
    summary: string;
    help: {
      what: string;
      when: string;
      cost: string;
      input: string;
      return: string;
      gotcha: string;
    };
  }>;
  mcp: Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    tokens_est: number;
  }>;
  jtbd: Array<{
    label: string;
    flow: string[];
  }>;
};

function buildBundle(filterCli: string[] | null, scope: "all" | "cli" | "mcp"): DocsBundle {
  const cli =
    scope === "mcp"
      ? []
      : commands
          .filter((c) => (filterCli ? filterCli.includes(c.name) : true))
          .map((c) => ({
            name: c.name,
            summary: c.summary,
            help: {
              what: c.help.what,
              when: c.help.when,
              cost: c.help.cost,
              input: c.help.input,
              return: c.help.return,
              gotcha: c.help.gotcha,
            },
          }));

  const mcp =
    scope === "cli"
      ? []
      : MCP_TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
          tokens_est: Math.ceil(t.description.length / 4),
        }));

  return {
    scaffold_day: { version: pkg.version, home: defaultHomeDir() },
    cli,
    mcp,
    jtbd: [
      {
        label: "What's on my plate today?",
        flow: ["scaffold-day today --json", "(MCP) get_day"],
      },
      {
        label: "Add a TODO and place it",
        flow: [
          "scaffold-day todo add --title \"...\"   (MCP) create_todo",
          "scaffold-day todo score <id> --ai      (MCP) compute_task_importance",
          "scaffold-day place suggest <id> --json (MCP) suggest_placement",
          "scaffold-day place do <id> --slot ...  (MCP) place_todo",
        ],
      },
      {
        label: "Why was a slot picked?",
        flow: ["scaffold-day explain <plc-id> --json", "(MCP) explain_placement"],
      },
      {
        label: "A meeting moved — replan",
        flow: [
          "scaffold-day day replan <date> --json     (MCP) replan_day",
          "scaffold-day conflict list --json         (MCP) (resolve_conflict)",
        ],
      },
      {
        label: "Discover the surface",
        flow: ["scaffold-day docs --for-ai --format json (this dump)"],
      },
    ],
  };
}

function renderMarkdown(bundle: DocsBundle): string {
  const lines: string[] = [];
  lines.push(`# scaffold-day v${bundle.scaffold_day.version} — for AI`);
  lines.push("");
  lines.push("**Identity.** scaffold-day is a CLI-first OSS that places TODOs into a calendar's free slots, with an AI client (Claude Code / Cursor / Claude Desktop) as a first-class user. Same surface via CLI flags or MCP tools.");
  lines.push("");
  lines.push("**Quick start.**");
  lines.push("```");
  lines.push("scaffold-day init");
  lines.push("scaffold-day today --tz Asia/Seoul");
  lines.push("scaffold-day docs --for-ai   # this document");
  lines.push("```");
  lines.push("");
  lines.push("**Token efficiency.** Default to `--json`; for AI clients prefer the MCP tool surface (one tool call per question) over piping CLI text.");
  lines.push("");
  lines.push("## JTBD → call flow");
  lines.push("");
  for (const j of bundle.jtbd) {
    lines.push(`- **${j.label}**`);
    for (const step of j.flow) {
      lines.push(`  - \`${step}\``);
    }
  }
  lines.push("");

  if (bundle.cli.length > 0) {
    lines.push("## CLI commands");
    lines.push("");
    for (const c of bundle.cli) {
      lines.push(`### \`scaffold-day ${c.name}\` — ${c.summary}`);
      lines.push("");
      lines.push(`- **WHAT.** ${c.help.what}`);
      lines.push(`- **WHEN.** ${c.help.when}`);
      lines.push(`- **COST.** ${c.help.cost}`);
      lines.push(`- **INPUT.** ${c.help.input}`);
      lines.push(`- **RETURN.** ${c.help.return}`);
      lines.push(`- **GOTCHA.** ${c.help.gotcha}`);
      lines.push("");
    }
  }

  if (bundle.mcp.length > 0) {
    lines.push("## MCP tools");
    lines.push("");
    for (const t of bundle.mcp) {
      lines.push(`### \`${t.name}\``);
      lines.push("");
      lines.push(`> ${t.description}`);
      lines.push("");
      lines.push(`**inputSchema:**`);
      lines.push("```json");
      lines.push(JSON.stringify(t.inputSchema, null, 2));
      lines.push("```");
      lines.push(`*tokens_est: ${t.tokens_est}*`);
      lines.push("");
    }
  }

  return lines.join("\n");
}

function renderYaml(bundle: DocsBundle): string {
  // Minimal YAML emitter (avoid extra dep). Bundle is shallow enough.
  const lines: string[] = [];
  lines.push(`scaffold_day:`);
  lines.push(`  version: ${bundle.scaffold_day.version}`);
  lines.push(`  home: ${JSON.stringify(bundle.scaffold_day.home)}`);
  if (bundle.cli.length > 0) {
    lines.push("cli:");
    for (const c of bundle.cli) {
      lines.push(`  - name: ${c.name}`);
      lines.push(`    summary: ${JSON.stringify(c.summary)}`);
    }
  }
  if (bundle.mcp.length > 0) {
    lines.push("mcp:");
    for (const t of bundle.mcp) {
      lines.push(`  - name: ${t.name}`);
      lines.push(`    tokens_est: ${t.tokens_est}`);
    }
  }
  return lines.join("\n");
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

  const bundle = buildBundle(filter, scope);
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
