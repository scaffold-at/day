import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { ScaffoldError } from "@scaffold/day-core";
import { toMcpError } from "./error-mapping";
import { healthTool } from "./tools/health";
import type { Tool, ToolRegistry } from "./tools/registry";

export const TOOLS: ToolRegistry = [healthTool as Tool<unknown, unknown>];

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
