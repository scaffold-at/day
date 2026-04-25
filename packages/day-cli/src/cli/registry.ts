import { doctorCommand } from "../commands/doctor";
import { feedbackCommand } from "../commands/feedback";
import { initCommand } from "../commands/init";
import { logsCommand } from "../commands/logs";
import { mcpCommand } from "../commands/mcp";
import { migrateCommand } from "../commands/migrate";
import { rebuildIndexCommand } from "../commands/rebuild-index";
import { selfUpdateCommand } from "../commands/self-update";
import { telemetryCommand } from "../commands/telemetry";
import type { Command } from "./command";

export const commands: Command[] = [
  initCommand,
  doctorCommand,
  migrateCommand,
  mcpCommand,
  feedbackCommand,
  selfUpdateCommand,
  rebuildIndexCommand,
  logsCommand,
  telemetryCommand,
];

export function findCommand(name: string): Command | undefined {
  return commands.find((c) => c.name === name);
}
