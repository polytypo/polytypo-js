import { runAnalyze, runPipeline } from "./engine/pipeline.js";
import type { Change } from "./engine/origin.js";
import type { Options } from "./types.js";

export function transform(input: string, options: Options): string {
  return runPipeline(input, options);
}

/**
 * The same pipeline as `transform`, reporting what it would do instead of doing it
 * (spec/rules/analyze.md). Offsets are code-point offsets into `input` in every mode.
 *
 * What it guarantees: the list is empty exactly when `transform` would return the input
 * unchanged, every `ruleId` was enabled for the call, and every offset is inside the input.
 * What it does not: the list is a report, not a patch — two rules may touch the same original
 * range, so replaying it is not guaranteed to reproduce `transform`'s output. Call `transform`
 * for the text (analyze.md §4, §5).
 */
export function analyze(input: string, options: Options): Change[] {
  return runAnalyze(input, options);
}

export { PolytypoError } from "./errors.js";
export type { PolytypoErrorCode } from "./errors.js";
export type { Change } from "./engine/origin.js";
export type {
  Dialect,
  Edit,
  LocaleData,
  LocaleSource,
  Mode,
  Options,
  QuotePair,
  Rule,
  RuleContext,
  RuleId,
} from "./types.js";
