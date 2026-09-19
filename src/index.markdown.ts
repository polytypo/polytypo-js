import { assertFixedMode } from "./engine/assert-fixed-mode.js";
import { analyzeMarkdownPipeline, runMarkdownPipeline } from "./engine/markdown-pipeline.js";
import type { Change } from "./engine/origin.js";
import type { Dialect, Options } from "./types.js";

/**
 * `polytypo/markdown` — Markdown-only entry point. Its module graph includes the Micromark/MDX
 * stack and `parse5` (the latter via `./modes/markdown.js` importing `./modes/html.js` for
 * normative embedded-HTML handling, modes.md 3.7) — both are legitimately reachable here
 * (AUDIT_REMEDIATION_AND_RELEASE_PLAN.md 5.1). It imports `./engine/markdown-pipeline.js`
 * directly and never `./engine/pipeline.js`.
 *
 * `mode` is absent from `MarkdownOptions`, since this entry only ever runs `markdown` mode.
 * `dialect` keeps the aggregate entry's contract: required, no default (types.ts).
 */
export type MarkdownOptions = Omit<Options, "mode"> & {
  dialect: Dialect;
};

export function transform(input: string, options: MarkdownOptions): string {
  const given = (options ?? {}) as Partial<Options>;
  assertFixedMode(given.mode, "markdown", "polytypo/markdown");
  return runMarkdownPipeline(input, given);
}

/**
 * The same pipeline as this entry's `transform`, reporting instead of applying
 * (spec/rules/analyze.md). Offsets are code-point offsets into `input` — into the document,
 * not into a span (analyze.md §6).
 */
export function analyze(input: string, options: MarkdownOptions): Change[] {
  const given = (options ?? {}) as Partial<Options>;
  assertFixedMode(given.mode, "markdown", "polytypo/markdown");
  return analyzeMarkdownPipeline(input, given);
}

export { PolytypoError } from "./errors.js";
export type { PolytypoErrorCode } from "./errors.js";
export type {
  Dialect,
  LocaleData,
  LocaleSource,
  NarrowNbsp,
  QuotePair,
  Rule,
  RuleContext,
  RuleId,
} from "./types.js";
