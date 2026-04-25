#!/usr/bin/env bun
/**
 * CI entry point for SLICES §S2.5: every CLI command must expose the full
 * 6-section help template (WHAT/WHEN/COST/INPUT/RETURN/GOTCHA) and the
 * combined description corpus must stay under the token budget.
 *
 * Exit 0 on pass; exit 1 with a structured stderr report on any issue.
 */

import { commands } from "../packages/day-cli/src/cli/registry";
import {
  HELP_SECTIONS,
  TOKEN_BUDGET,
  commandDescriptionChars,
  validateRegistry,
} from "../packages/day-cli/src/cli/validate";

const result = validateRegistry(commands);

console.log(
  `Validating ${result.commandCount} commands × ${HELP_SECTIONS.length} sections`,
);
console.log(`  total chars : ${result.totalChars}`);
console.log(
  `  ~tokens     : ${result.estimatedTokens} / ${result.tokenBudget} (${(
    (result.estimatedTokens / result.tokenBudget) *
    100
  ).toFixed(1)}%)`,
);

const perCommand = commands
  .map((c) => ({ name: c.name, chars: commandDescriptionChars(c) }))
  .sort((a, b) => b.chars - a.chars);
console.log("  per command (descending):");
for (const { name, chars } of perCommand) {
  console.log(`    ${name.padEnd(16)} ${chars.toString().padStart(5)} chars`);
}

if (result.issues.length > 0) {
  console.error(`\n${result.issues.length} validation issue(s):`);
  for (const issue of result.issues) {
    console.error(`  ✗ ${issue.command.padEnd(16)} ${issue.kind} :: ${issue.detail}`);
  }
}
if (result.overBudget) {
  console.error(
    `\n✗ token budget exceeded: ${result.estimatedTokens} > ${result.tokenBudget}`,
  );
}

if (!result.ok) {
  console.error("\nvalidate-help: FAILED");
  process.exit(1);
}

console.log("\nvalidate-help: OK");
