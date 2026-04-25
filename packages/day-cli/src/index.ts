#!/usr/bin/env bun
import pkg from "../package.json" with { type: "json" };

const VERSION = pkg.version;
const NAME = "scaffold-day";

const HELP = `${NAME} v${VERSION}

  Scaffold your day with AI.

USAGE
  ${NAME} [command] [options]

COMMANDS
  (none yet — coming in S2)

OPTIONS
  -v, --version    Print version and exit
  -h, --help       Print this help and exit

DOCS
  https://scaffold.at/day
`;

function printVersion(): void {
  console.log(`${NAME} v${VERSION}`);
}

function printHelp(): void {
  console.log(HELP);
}

function main(argv: string[]): number {
  const args = argv.slice(2);

  if (args.length === 0) {
    printHelp();
    return 0;
  }

  if (args.includes("--version") || args.includes("-v")) {
    printVersion();
    return 0;
  }

  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return 0;
  }

  console.error(`${NAME}: unknown command '${args[0]}'`);
  console.error(`Run \`${NAME} --help\` for usage.`);
  return 2;
}

process.exit(main(process.argv));
