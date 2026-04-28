/**
 * Telemetry preference state (PRD v0.2 §S65).
 *
 * Stored at `<home>/.telemetry.json`:
 *   { "state": "ask" | "on" | "off", "decided_at": ISO | null }
 *
 * Default is "ask" — the first opportunity prompts the user. Only
 * `state: "on"` actually transmits events.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { pathExists } from "../schema/storage";

export const TELEMETRY_FILE = ".telemetry.json";

export const TelemetryStateSchema = z.enum(["ask", "on", "off"]);
export type TelemetryState = z.infer<typeof TelemetryStateSchema>;

export const TelemetryConfigSchema = z
  .object({
    state: TelemetryStateSchema,
    decided_at: z.string().nullable().default(null),
  })
  .strict();
export type TelemetryConfig = z.infer<typeof TelemetryConfigSchema>;

export function telemetryConfigPath(home: string): string {
  return path.join(home, TELEMETRY_FILE);
}

export async function readTelemetryConfig(
  home: string,
): Promise<TelemetryConfig> {
  const p = telemetryConfigPath(home);
  if (!(await pathExists(p))) {
    return { state: "ask", decided_at: null };
  }
  try {
    const raw = await readFile(p, "utf8");
    const parsed = TelemetryConfigSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
  } catch {
    // fall through to default
  }
  return { state: "ask", decided_at: null };
}

export async function writeTelemetryConfig(
  home: string,
  config: TelemetryConfig,
): Promise<void> {
  const p = telemetryConfigPath(home);
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o644 });
}
