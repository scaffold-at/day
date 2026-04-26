#!/usr/bin/env bun
/**
 * Token corpus regression gate (PRD §11.1, SLICES §S44).
 *
 * Measures the chars/4 estimate of:
 *   - the CLI `--help` corpus (already covered by validate-help.ts)
 *   - the MCP tool description corpus (this script's primary target)
 *
 * Compares against `scripts/.token-baseline.json`. Default thresholds:
 *   warn  = ±10% drift from the recorded baseline
 *   fail  = +25% drift OR over the absolute budget (6000 tokens)
 *
 * Exit:
 *   0  — within thresholds
 *   1  — over fail threshold
 *
 * Run with `--update-baseline` to record a new baseline (use on a
 * deliberate tool surface change after a green run).
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { TOOLS } from "../packages/day-mcp/src/server";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASELINE = path.join(HERE, ".token-baseline.json");
const ABSOLUTE_BUDGET_TOKENS = 6000;
const WARN_DRIFT = 0.1;
const FAIL_DRIFT = 0.25;

type Baseline = {
  recorded_at: string;
  total_chars: number;
  total_tokens_est: number;
  per_tool_tokens: Record<string, number>;
};

const args = process.argv.slice(2);
const updateBaseline = args.includes("--update-baseline");

function tokensFromChars(chars: number): number {
  return Math.ceil(chars / 4);
}

function snapshot() {
  const perTool = TOOLS.map((t) => ({
    name: t.name,
    chars: t.description.length,
    tokens: tokensFromChars(t.description.length),
  }));
  const totalChars = perTool.reduce((s, x) => s + x.chars, 0);
  const totalTokens = tokensFromChars(totalChars);
  return { perTool, totalChars, totalTokens };
}

async function loadBaseline(): Promise<Baseline | null> {
  try {
    const raw = await readFile(BASELINE, "utf8");
    return JSON.parse(raw) as Baseline;
  } catch {
    return null;
  }
}

async function writeBaseline(b: Baseline): Promise<void> {
  await writeFile(BASELINE, `${JSON.stringify(b, null, 2)}\n`, "utf8");
}

async function main(): Promise<number> {
  const snap = snapshot();
  console.log(
    `MCP tool corpus: ${TOOLS.length} tools, ${snap.totalChars} chars, ~${snap.totalTokens} tokens (budget ${ABSOLUTE_BUDGET_TOKENS})`,
  );
  for (const t of [...snap.perTool].sort((a, b) => b.tokens - a.tokens)) {
    console.log(`  ${t.name.padEnd(28)} ${t.tokens.toString().padStart(4)} tokens (${t.chars} chars)`);
  }

  if (snap.totalTokens > ABSOLUTE_BUDGET_TOKENS) {
    console.error(
      `\n✗ FAIL — total ${snap.totalTokens} tokens > absolute budget ${ABSOLUTE_BUDGET_TOKENS}`,
    );
    return 1;
  }

  if (updateBaseline) {
    const next: Baseline = {
      recorded_at: new Date().toISOString(),
      total_chars: snap.totalChars,
      total_tokens_est: snap.totalTokens,
      per_tool_tokens: Object.fromEntries(snap.perTool.map((t) => [t.name, t.tokens])),
    };
    await writeBaseline(next);
    console.log(`\n→ baseline updated: ${BASELINE}`);
    return 0;
  }

  const baseline = await loadBaseline();
  if (!baseline) {
    console.warn(
      "\n⚠ no baseline found — recording the current snapshot as the new baseline. Re-run with --update-baseline if this was deliberate.",
    );
    const next: Baseline = {
      recorded_at: new Date().toISOString(),
      total_chars: snap.totalChars,
      total_tokens_est: snap.totalTokens,
      per_tool_tokens: Object.fromEntries(snap.perTool.map((t) => [t.name, t.tokens])),
    };
    await writeBaseline(next);
    return 0;
  }

  const drift = (snap.totalTokens - baseline.total_tokens_est) / baseline.total_tokens_est;
  const driftPct = (drift * 100).toFixed(1);
  console.log(
    `\nbaseline: ${baseline.total_tokens_est} tokens (recorded ${baseline.recorded_at})`,
  );
  console.log(`drift:    ${driftPct}%`);

  if (Math.abs(drift) >= FAIL_DRIFT) {
    console.error(
      `\n✗ FAIL — drift ${driftPct}% exceeds ±${(FAIL_DRIFT * 100).toFixed(0)}%`,
    );
    return 1;
  }
  if (Math.abs(drift) >= WARN_DRIFT) {
    console.warn(
      `\n⚠ WARN — drift ${driftPct}% exceeds ±${(WARN_DRIFT * 100).toFixed(0)}%; rerun with --update-baseline if intentional.`,
    );
    return 0;
  }

  console.log("\n✓ OK");
  return 0;
}

const code = await main();
process.exit(code);
