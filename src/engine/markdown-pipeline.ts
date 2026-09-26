import { frontmatterSpans, markdownSpans, resolveDialect } from "../modes/markdown.js";
import type { Dialect, Options } from "../types.js";
import { getLocaleData } from "./locale.js";
import { resolveNarrowTarget } from "./narrow-target.js";
import { planRules } from "./rule-runner.js";
import { resolveFrontmatterKeys } from "./yaml-keys.js";
import { analyzeOverUnits, runOverUnits } from "./span-runner.js";
import type { Change } from "./origin.js";
import type { Span } from "../modes/spans.js";

/**
 * `markdown` mode only. Imports the Micromark/MDX stack and `parse5` (via `../modes/markdown.js`
 * importing `../modes/html.js` for normative embedded-HTML handling, modes.md 3.7) — both are
 * legitimately reachable from `polytypo/markdown` (AUDIT_REMEDIATION_AND_RELEASE_PLAN.md 5.1).
 *
 * Validation order — `planRules`, then `getLocaleData`, then `resolveDialect`/parsing — mirrors
 * the pre-Stage-5 aggregate `runPipeline` exactly: an unknown-rule error wins over an
 * unknown-locale error, which wins over a missing/invalid dialect, which wins over a parse
 * failure. All four are public, tested behaviour this refactor was not authorised to change.
 */
export function runMarkdownPipeline(input: string, options: Partial<Options>): string {
  const narrowTarget = resolveNarrowTarget(options.narrowNbsp);
  const planned = planRules(options.rules);
  const locale = getLocaleData(options.locale);
  const dialect = resolveDialect(options.dialect);
  const frontmatterKeys = resolveFrontmatterKeys(options.frontmatterKeys);
  const units = unitsOf(input, dialect, frontmatterKeys);
  return runOverUnits(input, units, planned, locale, "markdown", narrowTarget);
}

/**
 * modes.md 3.7.4: the body, and — only when the caller named frontmatter keys — the frontmatter
 * block as a second text unit. Without the option this is exactly the single unit every document
 * had before spec 1.7.0, which is why no released output can move.
 *
 * The two units must be **disjoint** — 3.7.4: "no source position can belong to both units". Since
 * spec 1.8.0 that is 3.7.3a's masking rule doing the work rather than a shared parser: the body is
 * read from a document whose block is blanked out, so it cannot emit a span the frontmatter unit
 * also claims, whatever the parser would have made of the block's characters.
 */
function unitsOf(
  input: string,
  dialect: Dialect,
  frontmatterKeys: readonly string[] | undefined,
): Span[][] {
  const body = markdownSpans(input, dialect);
  if (frontmatterKeys === undefined) return [body];
  return [frontmatterSpans(input, frontmatterKeys), body];
}

/** analyze.md §1, `markdown` mode. Dialect validation happens here exactly as it does for
 * `runMarkdownPipeline`, so an absent dialect throws POLYTYPO_INVALID_DIALECT from `analyze`
 * too (analyze.md §4 A1). */
export function analyzeMarkdownPipeline(input: string, options: Partial<Options>): Change[] {
  const narrowTarget = resolveNarrowTarget(options.narrowNbsp);
  const planned = planRules(options.rules);
  const locale = getLocaleData(options.locale);
  const dialect = resolveDialect(options.dialect);
  const frontmatterKeys = resolveFrontmatterKeys(options.frontmatterKeys);
  return analyzeOverUnits(
    input,
    unitsOf(input, dialect, frontmatterKeys),
    planned,
    locale,
    "markdown",
    narrowTarget,
  );
}
