#!/usr/bin/env bun
import { ScaffoldError } from "@scaffold/day-core";
import pkg from "../package.json" with { type: "json" };
import { handleCliError } from "./cli/error-handler";
import { formatCommandHelp, formatRootHelp } from "./cli/help";
import { commands, findCommand } from "./cli/registry";

const VERSION = pkg.version;

async function dispatch(argv: string[]): Promise<number> {
  const args = argv.slice(2).filter((a) => a !== "--json");

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
    throw new ScaffoldError({
      code: "DAY_USAGE",
      summary: {
        en: `unknown option '${first}'`,
        ko: `알 수 없는 옵션 '${first}'`,
      },
      cause: `'${first}' is not a recognized top-level option.`,
      try: [
        "Run `scaffold-day --help` for usage.",
        "Place command-specific options after the command name.",
      ],
      context: { typed: first, position: "top-level" },
    });
  }

  const cmd = findCommand(first);
  if (!cmd) {
    throw new ScaffoldError({
      code: "DAY_USAGE",
      summary: {
        en: `unknown command '${first}'`,
        ko: `알 수 없는 명령 '${first}'`,
      },
      cause: `scaffold-day does not have a command named '${first}'.`,
      try: [
        "Run `scaffold-day --help` to list available commands.",
        "Check spelling — commands are lower-case kebab-case.",
      ],
      context: { typed: first },
    });
  }

  const rest = args.slice(1);
  if (rest.includes("--help") || rest.includes("-h")) {
    console.log(formatCommandHelp(cmd));
    return 0;
  }

  return await cmd.run(rest);
}

async function main(argv: string[]): Promise<number> {
  const jsonMode = argv.includes("--json");
  try {
    return await dispatch(argv);
  } catch (err) {
    return handleCliError(err, { jsonMode });
  }
}

process.exit(await main(process.argv));
