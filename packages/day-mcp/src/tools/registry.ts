import type { z } from "zod";

/**
 * Internal Tool descriptor. `inputSchema` is JSON Schema (the format
 * MCP wants on the wire); `parser` is the Zod schema we validate the
 * incoming `arguments` against before dispatching to `handler`.
 *
 * `tokens_est` is the chars/4 heuristic estimate of the description's
 * weight against the surface budget (PRD §11.1, §S44). Filled in
 * automatically by the registry helper.
 */
export type Tool<I = unknown, O = unknown> = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /**
   * `z.ZodType<I, ZodTypeDef, unknown>` so schemas with `.default()`
   * (where Zod's input ≠ output) still satisfy the slot — input is
   * unknown JSON from MCP, output is the typed `I`.
   */
  parser: z.ZodType<I, z.ZodTypeDef, unknown>;
  handler: (input: I) => Promise<O>;
};

export type ToolRegistry = ReadonlyArray<Tool<unknown, unknown>>;
