import type { Command, HelpDoc } from "./command";

/**
 * Description token budget for the entire CLI surface, per PRD §11.1.
 * Heuristic: chars/4 (tiktoken WASM lands in S44).
 */
export const TOKEN_BUDGET = 6000;

export const HELP_SECTIONS = [
  "what",
  "when",
  "cost",
  "input",
  "return",
  "gotcha",
] as const satisfies ReadonlyArray<keyof HelpDoc>;

export type IssueKind =
  | "missing-name"
  | "missing-summary"
  | "missing-section"
  | "empty-section";

export type ValidationIssue = {
  command: string;
  kind: IssueKind;
  detail: string;
};

export type RegistryValidation = {
  ok: boolean;
  issues: ValidationIssue[];
  commandCount: number;
  totalChars: number;
  estimatedTokens: number;
  tokenBudget: number;
  overBudget: boolean;
};

export function estimateTokens(charCount: number): number {
  return Math.ceil(charCount / 4);
}

export function validateCommand(cmd: Command): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const name = cmd.name?.trim() ?? "";
  const label = name === "" ? "<unknown>" : name;

  if (name === "") {
    issues.push({ command: label, kind: "missing-name", detail: "name is empty" });
  }
  if (!cmd.summary || cmd.summary.trim() === "") {
    issues.push({ command: label, kind: "missing-summary", detail: "summary is empty" });
  }
  for (const section of HELP_SECTIONS) {
    const value = cmd.help?.[section];
    if (value === undefined || value === null) {
      issues.push({ command: label, kind: "missing-section", detail: section });
      continue;
    }
    if (value.trim() === "") {
      issues.push({ command: label, kind: "empty-section", detail: section });
    }
  }
  return issues;
}

export function commandDescriptionChars(cmd: Command): number {
  let chars = (cmd.summary ?? "").length;
  for (const section of HELP_SECTIONS) {
    chars += (cmd.help?.[section] ?? "").length;
  }
  return chars;
}

export function validateRegistry(commands: Command[]): RegistryValidation {
  const issues: ValidationIssue[] = [];
  let totalChars = 0;

  const seen = new Set<string>();
  for (const cmd of commands) {
    if (cmd.name && seen.has(cmd.name)) {
      issues.push({
        command: cmd.name,
        kind: "missing-name",
        detail: `duplicate command name '${cmd.name}'`,
      });
    } else if (cmd.name) {
      seen.add(cmd.name);
    }
    issues.push(...validateCommand(cmd));
    totalChars += commandDescriptionChars(cmd);
  }

  const estimatedTokens = estimateTokens(totalChars);
  const overBudget = estimatedTokens > TOKEN_BUDGET;

  return {
    ok: issues.length === 0 && !overBudget,
    issues,
    commandCount: commands.length,
    totalChars,
    estimatedTokens,
    tokenBudget: TOKEN_BUDGET,
    overBudget,
  };
}
