import { describe, expect, test } from "bun:test";
import { initCommand } from "../commands/init";
import type { Command } from "./command";
import { formatCommandHelp } from "./help";
import { commands } from "./registry";
import {
  HELP_SECTIONS,
  TOKEN_BUDGET,
  commandDescriptionChars,
  estimateTokens,
  validateCommand,
  validateRegistry,
} from "./validate";

describe("help validation — registry", () => {
  test("registry is non-empty", () => {
    expect(commands.length).toBeGreaterThan(0);
  });

  test("every registered command passes validation", () => {
    for (const cmd of commands) {
      const issues = validateCommand(cmd);
      expect(issues, `command '${cmd.name}': ${JSON.stringify(issues)}`).toEqual([]);
    }
  });

  test("registry validates clean", () => {
    const result = validateRegistry(commands);
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });

  test("registry stays under token budget", () => {
    const result = validateRegistry(commands);
    expect(result.estimatedTokens).toBeLessThanOrEqual(TOKEN_BUDGET);
    expect(result.overBudget).toBe(false);
  });
});

describe("help validation — failure modes", () => {
  test("missing section is reported", () => {
    const broken: Command = {
      ...initCommand,
      help: { ...initCommand.help, what: "" },
    };
    const issues = validateCommand(broken);
    expect(issues.some((i) => i.kind === "empty-section" && i.detail === "what")).toBe(true);
  });

  test("missing summary is reported", () => {
    const broken: Command = { ...initCommand, summary: "" };
    const issues = validateCommand(broken);
    expect(issues.some((i) => i.kind === "missing-summary")).toBe(true);
  });

  test("over-budget registry is rejected", () => {
    const filler = "x".repeat(TOKEN_BUDGET * 4 + 100);
    const big: Command = {
      ...initCommand,
      name: "big",
      help: {
        what: filler,
        when: "y",
        cost: "y",
        input: "y",
        return: "y",
        gotcha: "y",
      },
    };
    const result = validateRegistry([big]);
    expect(result.overBudget).toBe(true);
    expect(result.ok).toBe(false);
  });
});

describe("help formatter — golden invariants", () => {
  test("formatCommandHelp emits header + 6 section labels in order", () => {
    const output = formatCommandHelp(initCommand);
    expect(output.startsWith(`scaffold-day ${initCommand.name} — `)).toBe(true);

    const expectedLabels = HELP_SECTIONS.map((s) => s.toUpperCase());
    let cursor = 0;
    for (const label of expectedLabels) {
      const marker = `\n${label}\n`;
      const idx = output.indexOf(marker, cursor);
      expect(idx, `expected '${label}' after pos ${cursor} in:\n${output}`).toBeGreaterThan(-1);
      cursor = idx + marker.length;
    }
  });

  test("estimateTokens uses chars/4 ceiling", () => {
    expect(estimateTokens(0)).toBe(0);
    expect(estimateTokens(1)).toBe(1);
    expect(estimateTokens(4)).toBe(1);
    expect(estimateTokens(5)).toBe(2);
    expect(estimateTokens(commandDescriptionChars(initCommand))).toBeGreaterThan(0);
  });
});
