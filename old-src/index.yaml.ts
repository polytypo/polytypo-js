import { assertFixedMode } from "./engine/assert-fixed-mode.js";
import { analyzeYamlPipeline, runYamlPipeline } from "./engine/yaml-pipeline.js";
import type { Change } from "./engine/origin.js";
import type { Options } from "./types.js";

/**
 * `polytypo/yaml` — YAML-only entry point, and the lightest of the four: `yaml` mode uses no
 * parser at all (spec/rules/modes.md 3.8.1), so this entry's module graph excludes `parse5` and
 * the Micromark/MDX stack for the same reason `polytypo/text` does — it has nothing to import.
 * `scripts/check-entry-reach.mjs` asserts that against the real module graph, which is what
 * turns "parser-free" from a claim in the spec into a fact this package can be held to.
 *
 * `mode` is absent from `YamlOptions`, since this entry only ever runs `yaml` mode. `dialect` is
 * likewise absent — it belongs to `markdown` alone (types.ts). `keys` goes the other way: it is
 * optional on the aggregate `Options` because the other three modes ignore it, and **required**
 * here, where the mode is fixed and the option always applies.
 */
export type YamlOptions = Omit<Options, "mode" | "dialect" | "keys" | "frontmatterKeys"> & {
  /** Required here, with no default — modes.md §3.8.2. An empty list processes nothing. */
  readonly keys: readonly string[];
};

export function transform(input: string, options: YamlOptions): string {
  const given = (options ?? {}) as Partial<Options>;
  assertFixedMode(given.mode, "yaml", "polytypo/yaml");
  return runYamlPipeline(input, given);
}

/**
 * The same pipeline as this entry's `transform`, reporting instead of applying
 * (spec/rules/analyze.md). Offsets are code-point offsets into `input`, not into a span.
 */
export function analyze(input: string, options: YamlOptions): Change[] {
  const given = (options ?? {}) as Partial<Options>;
  assertFixedMode(given.mode, "yaml", "polytypo/yaml");
  return analyzeYamlPipeline(input, given);
}

export { PolytypoError } from "./errors.js";
export type { PolytypoErrorCode } from "./errors.js";
export type { Change } from "./engine/origin.js";
export type { NarrowNbsp } from "./types.js";
export type { LocaleData, LocaleSource, QuotePair, Rule, RuleContext, RuleId } from "./types.js";
