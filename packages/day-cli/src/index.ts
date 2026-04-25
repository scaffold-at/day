#!/usr/bin/env bun
import pkg from "../package.json" with { type: "json" };
import { formatCommandHelp, formatRootHelp } from "./cli/help";
import { commands, findCommand } from "./cli/registry";

const VERSION = pkg.version;

async function main(argv: string[]): Promise<number> {
  const args = argv.slice(2);

  if (args.length === 0) {
    console.log(formatRootHelp(VERSION, commands));
    return 0;
  }

  const first = args[0] ?? "";

  if (first === "--version" || first === "-v") {
    console.log(`scaffold-day v${VERSION}`);
    return 0;
  }

  if (first === "--help" || first === "-h") {
    console.log(formatRootHelp(VERSION, commands));
    return 0;
  }

  if (first.startsWith("-")) {
    console.error(`scaffold-day: unknown option '${first}'`);
    console.error("Run `scaffold-day --help` for usage.");
    return 2;
  }

  const cmd = findCommand(first);
  if (!cmd) {
    console.error(`scaffold-day: unknown command '${first}'`);
    console.error("Run `scaffold-day --help` for usage.");
    return 2;
  }

  const rest = args.slice(1);
  if (rest.includes("--help") || rest.includes("-h")) {
    console.log(formatCommandHelp(cmd));
    return 0;
  }

  return await cmd.run(rest);
}

process.exit(await main(process.argv));
