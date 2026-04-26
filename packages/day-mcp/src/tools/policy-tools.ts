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
import { z } from "zod";
import type { Tool } from "./registry";

// ─── get_policy ────────────────────────────────────────────────────

const GetInput = z.object({}).strict();
type GetIn = z.infer<typeof GetInput>;

export const getPolicyTool: Tool<GetIn, unknown> = {
  name: "get_policy",
  description:
    "Return the active Policy compiled from <home>/policy/current.yaml. Throws DAY_NOT_INITIALIZED if no policy file is present.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  parser: GetInput,
  handler: async () => {
    const home = defaultHomeDir();
    const yaml = await readPolicyYaml(home);
    if (!yaml) {
      throw new ScaffoldError({
        code: "DAY_NOT_INITIALIZED",
        summary: { en: "no policy/current.yaml yet" },
        cause: "The local home does not have a policy file.",
        try: ["Call apply_preset with a built-in preset name."],
      });
    }
    return compilePolicy(yaml);
  },
};

// ─── update_policy (RFC 6902 patch) ────────────────────────────────

const UpdateInput = z
  .object({
    patch: z.array(
      z
        .object({
          op: z.enum(["add", "replace", "remove", "test"]),
          path: z.string().min(1),
          value: z.unknown().optional(),
        })
        .strict(),
    ),
  })
  .strict();
type UpdateIn = z.infer<typeof UpdateInput>;

export const updatePolicyTool: Tool<UpdateIn, unknown> = {
  name: "update_policy",
  description:
    "Apply an RFC 6902 JSON Patch to <home>/policy/current.yaml while preserving comments + key ordering. The patched policy is re-validated against the schema before write — schema-breaking patches are rejected.",
  inputSchema: {
    type: "object",
    properties: {
      patch: {
        type: "array",
        items: {
          type: "object",
          properties: {
            op: { type: "string", enum: ["add", "replace", "remove", "test"] },
            path: { type: "string" },
            value: {},
          },
          required: ["op", "path"],
        },
      },
    },
    required: ["patch"],
    additionalProperties: false,
  },
  parser: UpdateInput,
  handler: async (input: UpdateIn) => {
    const home = defaultHomeDir();
    const yaml = await readPolicyYaml(home);
    if (!yaml) {
      throw new ScaffoldError({
        code: "DAY_NOT_INITIALIZED",
        summary: { en: "no policy/current.yaml yet" },
        cause: "Apply a preset first.",
        try: ["Call apply_preset with a built-in preset name."],
      });
    }
    const patched = applyPolicyPatchPreservingFormatting(
      yaml,
      input.patch as JsonPatchOperation[],
    );
    await writePolicyYaml(home, patched);
    return { ok: true, applied: input.patch.length };
  },
};

// ─── apply_preset ──────────────────────────────────────────────────

const ApplyInput = z
  .object({
    name: z.string().min(1),
  })
  .strict();
type ApplyIn = z.infer<typeof ApplyInput>;

export const applyPresetTool: Tool<ApplyIn, unknown> = {
  name: "apply_preset",
  description:
    "Overwrite <home>/policy/current.yaml with a built-in preset. v0.1 only ships `balanced`. Generates a header comment with the timestamp.",
  inputSchema: {
    type: "object",
    properties: { name: { type: "string", description: "Built-in preset name (v0.1: 'balanced')" } },
    required: ["name"],
    additionalProperties: false,
  },
  parser: ApplyInput,
  handler: async (input: ApplyIn) => {
    if (!(input.name in BUILTIN_PRESETS)) {
      throw new ScaffoldError({
        code: "DAY_INVALID_INPUT",
        summary: { en: `unknown preset '${input.name}'` },
        cause: `Built-in presets: ${Object.keys(BUILTIN_PRESETS).join(", ")}.`,
        try: ["Pick a built-in preset name."],
        context: { name: input.name, builtins: Object.keys(BUILTIN_PRESETS) },
      });
    }
    const preset = BUILTIN_PRESETS[input.name as BuiltinPresetName];
    const header = `scaffold-day policy — ${input.name} preset (generated ${new Date().toISOString()})`;
    const yamlText = serializePolicy(preset, { headerComment: header });
    await writePolicyYaml(defaultHomeDir(), yamlText);
    return { applied: input.name, lines: yamlText.split("\n").length };
  },
};
