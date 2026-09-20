import { PolytypoError } from "../errors.js";

/**
 * modes.md §3.8.2: `yaml` mode's `keys` option, resolved once at the call boundary.
 *
 * It has **no default**, for the reason `dialect` has none. YAML is a data format with islands of
 * prose in it, and nothing in its syntax marks them — `description` holds a sentence and `run`
 * holds a shell script, spelled identically — so a default would be a guess about the schema
 * above the document. An **empty list is legal**: "process nothing" is a choice a caller may
 * make, not an error.
 *
 * Checked after `locale`, last of the option checks, alongside `dialect` (ARCHITECTURE.md §7).
 * The two never both apply, since each belongs to a different mode.
 */
export function resolveYamlKeys(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    throw new PolytypoError(
      "POLYTYPO_INVALID_OPTION",
      `"keys" is required when mode is "yaml" and must be a list of strings (modes.md §3.8.2). ` +
        `Received ${value === undefined ? "nothing" : JSON.stringify(value)}.`,
    );
  }
  for (const key of value as readonly unknown[]) {
    if (typeof key !== "string") {
      throw new PolytypoError(
        "POLYTYPO_INVALID_OPTION",
        `"keys" must contain only strings; received ${JSON.stringify(key)}.`,
      );
    }
  }
  return value as readonly string[];
}
