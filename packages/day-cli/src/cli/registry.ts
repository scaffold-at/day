import { authCommand } from "../commands/auth";
import { conflictCommand } from "../commands/conflict";
import { dayCommand } from "../commands/day";
import { docsCommand } from "../commands/docs";
import { doctorCommand } from "../commands/doctor";
import { eventCommand } from "../commands/event";
import { explainCommand } from "../commands/explain";
import { feedbackCommand } from "../commands/feedback";
import { initCommand } from "../commands/init";
import { logsCommand } from "../commands/logs";
import { mcpCommand } from "../commands/mcp";
import { migrateCommand } from "../commands/migrate";
import { morningCommand } from "../commands/morning";
import { placeCommand } from "../commands/place";
import { policyCommand } from "../commands/policy";
import { rebuildIndexCommand } from "../commands/rebuild-index";
import { selfUpdateCommand } from "../commands/self-update";
import { syncCommand } from "../commands/sync";
import { telemetryCommand } from "../commands/telemetry";
import { todayCommand } from "../commands/today";
import { todoCommand } from "../commands/todo";
import { weekCommand } from "../commands/week";
import type { Command } from "./command";

export const commands: Command[] = [
  todayCommand,
  morningCommand,
  initCommand,
  authCommand,
  doctorCommand,
  migrateCommand,
  dayCommand,
  weekCommand,
  todoCommand,
  placeCommand,
  conflictCommand,
  explainCommand,
  eventCommand,
  policyCommand,
  mcpCommand,
  docsCommand,
  feedbackCommand,
  selfUpdateCommand,
  rebuildIndexCommand,
  logsCommand,
  telemetryCommand,
  syncCommand,
];

export function findCommand(name: string): Command | undefined {
  return commands.find((c) => c.name === name);
}
