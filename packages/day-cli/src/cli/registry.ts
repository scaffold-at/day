import { dayCommand } from "../commands/day";
import { doctorCommand } from "../commands/doctor";
import { eventCommand } from "../commands/event";
import { feedbackCommand } from "../commands/feedback";
import { initCommand } from "../commands/init";
import { logsCommand } from "../commands/logs";
import { mcpCommand } from "../commands/mcp";
import { migrateCommand } from "../commands/migrate";
import { rebuildIndexCommand } from "../commands/rebuild-index";
import { selfUpdateCommand } from "../commands/self-update";
import { telemetryCommand } from "../commands/telemetry";
import { todayCommand } from "../commands/today";
import { weekCommand } from "../commands/week";
import type { Command } from "./command";

export const commands: Command[] = [
  todayCommand,
  initCommand,
  doctorCommand,
  migrateCommand,
  dayCommand,
  weekCommand,
  eventCommand,
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
