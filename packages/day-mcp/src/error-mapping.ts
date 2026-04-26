import { isScaffoldError, type ScaffoldError } from "@scaffold/day-core";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";

/**
 * Map a `ScaffoldError` (`DAY_*` code) onto a JSON-RPC McpError so the
 * MCP client gets a structured error with the original `DAY_*` code +
 * cause/try/docs in `data` (for AI clients that surface error data).
 */
export function toMcpError(err: unknown): McpError {
  if (isScaffoldError(err)) {
    return scaffoldToMcp(err);
  }
  if (err instanceof Error) {
    return new McpError(ErrorCode.InternalError, err.message, {
      original_name: err.name,
    });
  }
  return new McpError(ErrorCode.InternalError, String(err));
}

function scaffoldToMcp(err: ScaffoldError): McpError {
  const code = mapDayCodeToMcp(err.code);
  return new McpError(code, err.summary.en, {
    day_code: err.code,
    day_exit_code: err.exitCode,
    cause: err.causeText,
    try: err.try,
    docs: err.docs ?? null,
    context: err.context,
  });
}

function mapDayCodeToMcp(code: string): number {
  // RPC-level mapping — tools surface DAY_* in `data.day_code`, but the
  // RPC error code itself follows MCP/JSON-RPC conventions:
  //   InvalidParams   → user-input issues (DAY_USAGE, DAY_INVALID_INPUT)
  //   InvalidRequest  → state precondition failures (NOT_INITIALIZED, NOT_FOUND, LOCK_HELD)
  //   InternalError   → everything else (DAY_INTERNAL, provider issues)
  switch (code) {
    case "DAY_USAGE":
    case "DAY_INVALID_INPUT":
      return ErrorCode.InvalidParams;
    case "DAY_NOT_INITIALIZED":
    case "DAY_NOT_FOUND":
    case "DAY_LOCK_HELD":
    case "DAY_SCHEMA_FUTURE_VERSION":
      return ErrorCode.InvalidRequest;
    default:
      return ErrorCode.InternalError;
  }
}
