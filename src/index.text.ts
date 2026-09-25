import { assertFixedMode } from "./engine/assert-fixed-mode.js";
import { analyzeTextPipeline, runTextPipeline } from "./engine/text-pipeline.js";
import type { Change } from "./engine/origin.js";
import type { Options } from "./types.js";

/**
 * `polytypo/text` — text-only entry point. Its module graph excludes `parse5` and the
 * Micromark/MDX stack entirely (AUDIT_REMEDIATION_AND_RELEASE_PLAN.md 5.1): it imports
 * `./engine/text-pipeline.js` directly and never `./engine/pipeline.js`, `./modes/html.js` or
 * `./modes/markdown.js`.
 *
 * `mode` is absent from `TextOptions`, since this entry only ever runs `text` mode. `dialect` is
 * likewise absent — it has no effect in `text` mode even in the aggregate entry (types.ts), so
 * there is nothing for it to conflict with here.
 */
export type TextOptions = Omit<Options, "mode" | "dialect" | "frontmatterKeys">;

export function transform(input: string, options: TextOptions): string {
  const given = (options ?? {}) as Partial<Options>;
  assertFixedMode(given.mode, "text", "polytypo/text");
  return runTextPipeline(input, given);
}

/**
 * The same pipeline as this entry's `transform`, reporting instead of applying
 * (spec/rules/analyze.md). Offsets are code-point offsets into `input`.
 */
export function analyze(input: string, options: TextOptions): Change[] {
  const given = (options ?? {}) as Partial<Options>;
  assertFixedMode(given.mode, "text", "polytypo/text");
  return analyzeTextPipeline(input, given);
}

export { PolytypoError } from "./errors.js";
export type { PolytypoErrorCode } from "./errors.js";
export type { Change } from "./engine/origin.js";
export type { NarrowNbsp } from "./types.js";
export type { LocaleData, LocaleSource, QuotePair, Rule, RuleContext, RuleId } from "./types.js";
