import { TOOLS as MCP_TOOLS } from "@scaffold/day-mcp";
import pkg from "../../package.json" with { type: "json" };
import type { Command } from "../cli/command";

export type DocsBundle = {
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

export type BuildBundleOptions = {
  commands: Command[];
  filterCli: string[] | null;
  scope: "all" | "cli" | "mcp";
  home: string;
};

export function buildBundle(options: BuildBundleOptions): DocsBundle {
  const { commands, filterCli, scope, home } = options;
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
    scaffold_day: { version: pkg.version, home },
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

export function renderMarkdown(bundle: DocsBundle): string {
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

export function renderYaml(bundle: DocsBundle): string {
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
