import { compare, type Operation } from "fast-json-patch";
import { Document, parseDocument } from "yaml";
import { ScaffoldError } from "../error";
import { type Policy, PolicySchema } from "./policy";

/**
 * Parse a YAML string into a validated Policy. The original YAML
 * (including comments + key ordering) is NOT preserved in the
 * returned object — for round-tripping, hold onto the source string
 * and use `applyPolicyPatchPreservingFormatting` to mutate it.
 */
export function compilePolicy(yamlText: string): Policy {
  const doc = parseDocument(yamlText, { strict: false });
  if (doc.errors.length > 0) {
    throw new ScaffoldError({
      code: "DAY_INVALID_INPUT",
      summary: { en: "policy YAML failed to parse" },
      cause: doc.errors.map((e) => e.message).join("\n"),
      try: ["Fix the YAML syntax and re-run."],
    });
  }
  const obj = doc.toJSON();
  const parsed = PolicySchema.safeParse(obj);
  if (!parsed.success) {
    throw new ScaffoldError({
      code: "DAY_INVALID_INPUT",
      summary: { en: "policy YAML did not match the Policy schema" },
      cause: parsed.error.issues
        .map((i) => `  ${i.path.join(".")}: ${i.message}`)
        .join("\n"),
      try: ["Compare against `scaffold-day policy preset apply balanced`."],
    });
  }
  return parsed.data;
}

/**
 * Stringify a Policy as fresh YAML. Used when no prior file exists
 * (e.g., when seeding `policy/current.yaml` from a preset). Does NOT
 * preserve comments — there are none to preserve.
 */
export function serializePolicy(
  policy: Policy,
  options: { headerComment?: string } = {},
): string {
  const validated = PolicySchema.parse(policy);
  const doc = new Document(validated as unknown as Record<string, unknown>);
  let text = doc.toString();
  if (options.headerComment) {
    text = `${options.headerComment.replace(/^/gm, "# ")}\n${text}`;
  }
  return text;
}

/**
 * Compute a JSON Patch (RFC 6902) that turns `before` into `after`.
 */
export function diffPolicy(before: Policy, after: Policy): Operation[] {
  return compare(before, after);
}

function jsonPointerToPath(pointer: string): Array<string | number> {
  if (pointer === "" || pointer === "/") return [];
  return pointer
    .split("/")
    .slice(1)
    .map((segment) => {
      const decoded = segment.replace(/~1/g, "/").replace(/~0/g, "~");
      return /^\d+$/.test(decoded) ? Number(decoded) : decoded;
    });
}

/**
 * Apply a JSON Patch to an existing YAML string while preserving
 * comments + key ordering. Each op is dispatched against the YAML
 * Document API; the resulting string is re-emitted by the same
 * Document so unchanged regions stay byte-identical.
 */
export function applyPolicyPatchPreservingFormatting(
  yamlText: string,
  patch: ReadonlyArray<Operation>,
): string {
  const doc = parseDocument(yamlText, { strict: false });
  if (doc.errors.length > 0) {
    throw new ScaffoldError({
      code: "DAY_INVALID_INPUT",
      summary: { en: "policy YAML failed to parse" },
      cause: doc.errors.map((e) => e.message).join("\n"),
      try: ["Fix the YAML syntax and re-run."],
    });
  }

  for (const op of patch) {
    const path = jsonPointerToPath(op.path);
    switch (op.op) {
      case "add":
      case "replace":
        if (path.length === 0) {
          throw new ScaffoldError({
            code: "DAY_INVALID_INPUT",
            summary: { en: "cannot ${op.op} at the document root" },
            cause: `JSON Patch op '${op.op}' targets '/' which would replace the entire document.`,
            try: ["Patch a child key instead."],
          });
        }
        doc.setIn(path, op.value);
        break;
      case "remove":
        doc.deleteIn(path);
        break;
      case "test":
        // No-op for our purposes; the diff helper never produces these.
        break;
      case "copy":
      case "move":
        throw new ScaffoldError({
          code: "DAY_INVALID_INPUT",
          summary: { en: `JSON Patch op '${op.op}' is not supported on policy YAML` },
          cause: "v0.1 only handles add / replace / remove / test.",
          try: ["Reduce the patch to add/replace/remove operations."],
        });
      default:
        throw new ScaffoldError({
          code: "DAY_INVALID_INPUT",
          summary: { en: `unknown JSON Patch op '${(op as { op: string }).op}'` },
          cause: "Operation must be one of: add, replace, remove, test.",
          try: ["Check the patch source."],
        });
    }
  }

  // Validate the final shape so callers know their patch produced a
  // schema-clean policy.
  const obj = doc.toJSON();
  const parsed = PolicySchema.safeParse(obj);
  if (!parsed.success) {
    throw new ScaffoldError({
      code: "DAY_INVALID_INPUT",
      summary: { en: "patched policy no longer matches the Policy schema" },
      cause: parsed.error.issues
        .map((i) => `  ${i.path.join(".")}: ${i.message}`)
        .join("\n"),
      try: ["Inspect the patch operations."],
    });
  }

  return doc.toString();
}

export type { Operation as JsonPatchOperation } from "fast-json-patch";
