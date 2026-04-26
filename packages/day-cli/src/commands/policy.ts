import {
  applyPolicyPatchPreservingFormatting,
  BUILTIN_PRESETS,
  type BuiltinPresetName,
  compilePolicy,
  defaultHomeDir,
  type JsonPatchOperation,
  readPolicyYaml,
  ScaffoldError,
  serializePolicy,
  writePolicyYaml,
} from "@scaffold/day-core";
import type { Command } from "../cli/command";

function usage(message: string): ScaffoldError {
  return new ScaffoldError({
    code: "DAY_USAGE",
    summary: { en: message },
    cause: "See `scaffold-day policy --help` for the full input contract.",
    try: ["Run `scaffold-day policy --help`."],
  });
}

function notInitialized(): ScaffoldError {
  return new ScaffoldError({
    code: "DAY_NOT_INITIALIZED",
    summary: {
      en: "no policy/current.yaml yet",
      ko: "policy/current.yaml 이 없습니다",
    },
    cause: "The local home does not have a policy file.",
    try: [
      "Run `scaffold-day policy preset apply balanced` to seed it.",
    ],
  });
}

async function runShow(args: string[]): Promise<number> {
  const json = args.includes("--json");
  const home = defaultHomeDir();
  const yamlText = await readPolicyYaml(home);
  if (!yamlText) throw notInitialized();
  if (json) {
    const policy = compilePolicy(yamlText);
    console.log(JSON.stringify(policy, null, 2));
  } else {
    process.stdout.write(yamlText);
  }
  return 0;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin as AsyncIterable<Buffer>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function runPatch(args: string[]): Promise<number> {
  const positional: string[] = [];
  let fromStdin = false;
  let json = false;
  for (const a of args) {
    if (a === "--from-stdin") fromStdin = true;
    else if (a === "--json") json = true;
    else if (a.startsWith("--")) throw usage(`policy patch: unknown option '${a}'`);
    else positional.push(a);
  }

  let source: string;
  if (fromStdin) {
    source = await readStdin();
  } else {
    const first = positional[0];
    if (!first) {
      throw usage("policy patch: pass a JSON Patch as the first argument or use --from-stdin");
    }
    source = first;
  }

  let ops: JsonPatchOperation[];
  try {
    const parsed = JSON.parse(source);
    if (!Array.isArray(parsed)) throw new Error("expected a JSON array of RFC 6902 ops");
    ops = parsed as JsonPatchOperation[];
  } catch (err) {
    throw new ScaffoldError({
      code: "DAY_INVALID_INPUT",
      summary: { en: "patch must be a JSON array of RFC 6902 ops" },
      cause: (err as Error).message,
      try: [
        'Example: policy patch \'[{"op":"replace","path":"/placement_grid_min","value":15}]\'',
      ],
    });
  }

  const home = defaultHomeDir();
  const yamlText = await readPolicyYaml(home);
  if (!yamlText) throw notInitialized();

  const newYaml = applyPolicyPatchPreservingFormatting(yamlText, ops);
  await writePolicyYaml(home, newYaml);

  if (json) {
    console.log(JSON.stringify({ ok: true, applied: ops.length }));
  } else {
    console.log("scaffold-day policy patch");
    console.log(`  applied ${ops.length} op${ops.length === 1 ? "" : "s"} to policy/current.yaml`);
  }
  return 0;
}

async function runPreset(args: string[]): Promise<number> {
  const sub = args[0];
  if (sub !== "apply") {
    throw usage("policy preset: only `apply <name>` is supported in v0.1");
  }
  const name = args[1];
  if (!name) {
    throw usage("policy preset apply: <name> argument is required");
  }
  if (!(name in BUILTIN_PRESETS)) {
    throw new ScaffoldError({
      code: "DAY_INVALID_INPUT",
      summary: { en: `unknown preset '${name}'` },
      cause: `Built-in presets: ${Object.keys(BUILTIN_PRESETS).join(", ")}.`,
      try: ["Pick a built-in preset name."],
      context: { name, builtins: Object.keys(BUILTIN_PRESETS) },
    });
  }

  const preset = BUILTIN_PRESETS[name as BuiltinPresetName];
  const header = `scaffold-day policy — ${name} preset (generated ${new Date().toISOString()})`;
  const yamlText = serializePolicy(preset, { headerComment: header });

  const home = defaultHomeDir();
  await writePolicyYaml(home, yamlText);

  console.log(`scaffold-day policy preset apply ${name}`);
  console.log(`  wrote policy/current.yaml (${yamlText.split("\n").length} lines)`);
  return 0;
}

export const policyCommand: Command = {
  name: "policy",
  summary: "show / patch / preset-apply the local scheduling policy",
  help: {
    what: "Read or modify <home>/policy/current.yaml. v0.1 ships subcommands: `show` (print the YAML or compiled JSON), `patch <json-patch>` (apply RFC 6902 ops while preserving comments), `preset apply <name>` (overwrite with a built-in preset; v0.1 has only `balanced`).",
    when: "After install (seed via `preset apply`), or whenever you change scheduling rules / weights.",
    cost: "Local file I/O. Patch parses the YAML through the yaml Document API so unchanged regions stay byte-identical.",
    input: "show [--json]\npatch <json-patch> | --from-stdin [--json]\npreset apply <name>",
    return: "Exit 0 on success. DAY_NOT_INITIALIZED if there's no policy file yet. DAY_INVALID_INPUT on a bad patch / preset name. DAY_USAGE on missing args.",
    gotcha: "Comments in `current.yaml` survive `policy patch`. `preset apply` OVERWRITES the file — back up first if you've customized it. Tracking SLICES.md §S15 (cmds), §S14 (codec), §S13 (schemas).",
  },
  run: async (args) => {
    const sub = args[0];
    if (!sub) {
      throw usage("policy: missing subcommand. try `policy show`, `policy patch ...`, or `policy preset apply <name>`");
    }
    const rest = args.slice(1);
    if (sub === "show") return runShow(rest);
    if (sub === "patch") return runPatch(rest);
    if (sub === "preset") return runPreset(rest);
    throw usage(`policy: unknown subcommand '${sub}'`);
  },
};
