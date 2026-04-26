import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { ScaffoldError } from "@scaffold/day-core";
import { toMcpError } from "./error-mapping";
import { createTodoTool } from "./tools/create-todo";
import {
  getDaysRangeTool,
  getMonthOverviewTool,
  listAvailableMonthsTool,
} from "./tools/day-tools";
import {
  computeTaskImportanceTool,
  explainPlacementTool,
  placeOverrideTool,
  replanDayTool,
  resolveConflictTool,
} from "./tools/decision-tools";
import {
  createEventTool,
  deleteEventTool,
  updateEventTool,
} from "./tools/event-tools";
import { getDayTool } from "./tools/get-day";
import { healthTool } from "./tools/health";
import { placeTodoTool } from "./tools/place-todo";
import {
  applyPresetTool,
  getPolicyTool,
  updatePolicyTool,
} from "./tools/policy-tools";
import { queryTodosTool } from "./tools/query-todos";
import type { Tool, ToolRegistry } from "./tools/registry";
import { suggestPlacementTool } from "./tools/suggest-placement";
import {
  archiveTodoTool,
  getTodoDetailTool,
  getTodoSummaryTool,
  updateTodoTool,
} from "./tools/todo-tools";

export const TOOLS: ToolRegistry = [
  healthTool as Tool<unknown, unknown>,
  getDayTool as Tool<unknown, unknown>,
  getDaysRangeTool as Tool<unknown, unknown>,
  listAvailableMonthsTool as Tool<unknown, unknown>,
  getMonthOverviewTool as Tool<unknown, unknown>,
  queryTodosTool as Tool<unknown, unknown>,
  createTodoTool as Tool<unknown, unknown>,
  getTodoSummaryTool as Tool<unknown, unknown>,
  getTodoDetailTool as Tool<unknown, unknown>,
  updateTodoTool as Tool<unknown, unknown>,
  archiveTodoTool as Tool<unknown, unknown>,
  createEventTool as Tool<unknown, unknown>,
  updateEventTool as Tool<unknown, unknown>,
  deleteEventTool as Tool<unknown, unknown>,
  getPolicyTool as Tool<unknown, unknown>,
  updatePolicyTool as Tool<unknown, unknown>,
  applyPresetTool as Tool<unknown, unknown>,
  suggestPlacementTool as Tool<unknown, unknown>,
  placeTodoTool as Tool<unknown, unknown>,
  placeOverrideTool as Tool<unknown, unknown>,
  replanDayTool as Tool<unknown, unknown>,
  explainPlacementTool as Tool<unknown, unknown>,
  resolveConflictTool as Tool<unknown, unknown>,
  computeTaskImportanceTool as Tool<unknown, unknown>,
];

export type RunMcpServerOptions = {
  /** scaffold-day binary version, surfaced in the initialize handshake. */
  version: string;
};

/**
 * Build and connect a stdio MCP server with the registered tools.
 *
 * Logs MUST go to stderr — stdout is reserved for JSON-RPC frames the
 * client speaks. The SDK already emits its own diagnostics on stderr;
 * we follow the same rule for any handler-level output.
 */
export async function runMcpServer(options: RunMcpServerOptions): Promise<void> {
  const server = new Server(
    { name: "scaffold-day", version: options.version },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      // PRD §11.1 + §S44: surface a chars/4 token estimate so AI clients
      // can budget. Real tiktoken WASM is a future swap behind the same key.
      _meta: { tokens_est: Math.ceil(t.description.length / 4) },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: rawArgs } = request.params;
    const tool = TOOLS.find((t) => t.name === name);
    if (!tool) {
      throw toMcpError(
        new ScaffoldError({
          code: "DAY_USAGE",
          summary: { en: `unknown tool '${name}'` },
          cause: "The server does not register a tool with this name.",
          try: ["Call tools/list to see the registered set."],
          context: { typed: name },
        }),
      );
    }

    const parsed = tool.parser.safeParse(rawArgs ?? {});
    if (!parsed.success) {
      throw toMcpError(
        new ScaffoldError({
          code: "DAY_INVALID_INPUT",
          summary: { en: `invalid arguments for '${name}'` },
          cause: parsed.error.message,
          try: ["Check tools/list for the inputSchema."],
          context: { tool: name },
        }),
      );
    }

    try {
      const output = await tool.handler(parsed.data);
      const text = JSON.stringify(output);
      return {
        content: [{ type: "text" as const, text }],
        structuredContent: output as Record<string, unknown>,
      };
    } catch (err) {
      throw toMcpError(err);
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Keep the process alive while the transport is open. Under bun
  // we have to explicitly resume stdin and wait for its EOF — the
  // SDK's transport doesn't pin the event loop on its own here the
  // way it does on Node.
  process.stdin.resume();
  await new Promise<void>((resolve) => {
    process.stdin.on("end", () => resolve());
  });
}
