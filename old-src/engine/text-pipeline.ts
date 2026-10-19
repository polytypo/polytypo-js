import type { Options } from "../types.js";
import { fromCodePoints, toCodePoints } from "./codepoints.js";
import type { Change } from "./origin.js";
import { getLocaleData } from "./locale.js";
import { resolveNarrowTarget } from "./narrow-target.js";
import { planRules, runRules, runRulesRecording } from "./rule-runner.js";

/**
 * `text` mode only. Deliberately imports nothing from `../modes/html.js` or
 * `../modes/markdown.js` (or their parser dependencies) — this is what makes `polytypo/text`'s
 * module graph exclude `parse5` and the Micromark stack (AUDIT_REMEDIATION_AND_RELEASE_PLAN.md
 * 5.1).
 *
 * Validation order — `planRules` before `getLocaleData` — mirrors the pre-Stage-5 aggregate
 * `runPipeline` exactly (an unknown-rule error must win over an unknown-locale error when both
 * are present, since that is public, tested behaviour, not an implementation detail this
 * refactor was authorised to change).
 */
export function runTextPipeline(input: string, options: Partial<Options>): string {
  const narrowTarget = resolveNarrowTarget(options.narrowNbsp);
  const planned = planRules(options.rules);
  const locale = getLocaleData(options.locale);
  return fromCodePoints(runRules(toCodePoints(input), planned, locale, "text", narrowTarget));
}

/** analyze.md §1: the same pipeline as `runTextPipeline`, reporting instead of applying. */
export function analyzeTextPipeline(input: string, options: Partial<Options>): Change[] {
  const narrowTarget = resolveNarrowTarget(options.narrowNbsp);
  const planned = planRules(options.rules);
  const locale = getLocaleData(options.locale);
  const cp = toCodePoints(input);
  const origin = cp.map((_value, index) => index);
  return runRulesRecording(cp, planned, locale, "text", narrowTarget, origin, cp.length);
}
