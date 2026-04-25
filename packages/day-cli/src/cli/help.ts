import type { Command, HelpDoc } from "./command";

const SECTIONS: Array<[keyof HelpDoc, string]> = [
  ["what", "WHAT"],
  ["when", "WHEN"],
  ["cost", "COST"],
  ["input", "INPUT"],
  ["return", "RETURN"],
  ["gotcha", "GOTCHA"],
];

function indent(text: string, prefix = "  "): string {
  return text
    .split("\n")
    .map((line) => (line.length === 0 ? "" : prefix + line))
    .join("\n");
}

export function formatCommandHelp(cmd: Command): string {
  const header = `scaffold-day ${cmd.name} — ${cmd.summary}`;
  const body = SECTIONS.map(([key, label]) => {
    return `${label}\n${indent(cmd.help[key])}`;
  }).join("\n\n");
  return `${header}\n\n${body}\n`;
}

export function formatRootHelp(version: string, commands: Command[]): string {
  const colWidth = Math.max(...commands.map((c) => c.name.length)) + 2;
  const cmdLines = commands.map(
    (c) => `  ${c.name.padEnd(colWidth)}${c.summary}`,
  );
  return [
    `scaffold-day v${version}`,
    "",
    "  Scaffold your day with AI.",
    "",
    "USAGE",
    "  scaffold-day <command> [options]",
    "  scaffold-day [-v|--version]",
    "  scaffold-day [-h|--help]",
    "",
    "COMMANDS",
    ...cmdLines,
    "",
    "OPTIONS",
    "  -v, --version    Print version and exit",
    "  -h, --help       Print this help and exit",
    "",
    "Run `scaffold-day <command> --help` for command-specific docs.",
    "",
    "DOCS",
    "  https://scaffold.at/day",
    "",
  ].join("\n");
}
