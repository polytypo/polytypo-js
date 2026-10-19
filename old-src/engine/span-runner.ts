import {
  concatenateSpans,
  filterBoundaryEdits,
  normalizeSpans,
  originOfSpans,
  spanRangesOf,
  splitOnMarker,
  type Span,
} from "../modes/spans.js";
import { RULES } from "../rules/registry.js";
import type { LocaleData, Mode, RuleId } from "../types.js";
import { applyEdits } from "./edits.js";
import { fromCodePoints, toCodePoints } from "./codepoints.js";
import type { Change } from "./origin.js";
import { runRulesRecording } from "./rule-runner.js";

/**
 * The same sequence as `runRules` (`./rule-runner.js`), with the two boundary filters of
 * modes.md 3.4 interposed. The span extents are recomputed after every rule, because applying
 * an edit shifts every index after it; the markers themselves always survive, since no edit may
 * contain one.
 */
function runRulesOverSpans(
  cp: readonly number[],
  planned: readonly RuleId[],
  locale: LocaleData,
  mode: Mode,
  narrowTarget: number,
): readonly number[] {
  let current = cp;
  for (const id of planned) {
    const rule = RULES[id];
    if (rule === undefined) continue;
    const edits = rule.apply({ cp: current, locale, mode, narrowTarget });
    current = applyEdits(current, filterBoundaryEdits(current, edits, spanRangesOf(current)), id);
  }
  return current;
}

/**
 * modes.md 3.5. The pipeline runs **once**, over the marker-separated concatenation of every
 * processable span — not per span, which would pair quotation marks in isolation, and not over a
 * naive concatenation, which would manufacture adjacencies the document does not have.
 *
 * The output is the input with a set of disjoint substring replacements applied and nothing else
 * (modes.md 4). A span whose content the rules did not change contributes no replacement, so a
 * document needing no changes comes back byte-identical; the parser located the spans and was
 * then discarded, and the document is never serialised.
 */
interface Replacement {
  readonly span: Span;
  readonly text: string;
}

/** One text unit: the marker-separated concatenation, the pipeline, and the pieces it produced. */
function replacementsOfUnit(
  source: string,
  spans: readonly Span[],
  planned: readonly RuleId[],
  locale: LocaleData,
  mode: Mode,
  narrowTarget: number,
): Replacement[] {
  const normalized = normalizeSpans(spans);
  if (normalized.length === 0) return [];
  const transformed = runRulesOverSpans(
    concatenateSpans(source, normalized),
    planned,
    locale,
    mode,
    narrowTarget,
  );
  const pieces = splitOnMarker(transformed, normalized.length);
  return normalized.map((span, i) => ({ span, text: fromCodePoints(pieces[i] as number[]) }));
}

/** modes.md 4: the source with disjoint replacements applied at recorded offsets, nothing else. */
function emit(source: string, replacements: readonly Replacement[]): string {
  let out = "";
  let cursor = 0;
  for (const { span, text } of replacements) {
    const original = source.slice(span.start, span.end);
    out += source.slice(cursor, span.start);
    out += text === original ? original : text;
    cursor = span.end;
  }
  return out + source.slice(cursor);
}

export function runOverSpans(
  source: string,
  spans: readonly Span[],
  planned: readonly RuleId[],
  locale: LocaleData,
  mode: Mode,
  narrowTarget: number,
): string {
  return emit(source, replacementsOfUnit(source, spans, planned, locale, mode, narrowTarget));
}

/**
 * modes.md 3.1 and 3.5 step 3 (spec 1.7.0). A document has one text unit, except in `markdown`
 * with `frontmatterKeys`, where the frontmatter block's spans form a unit of their own. The
 * pipeline runs once per unit, and the two edit sets are disjoint because no span of one unit lies
 * inside the other — which is exactly what `markdownSpans` skipping the block guarantees.
 *
 * Only step 5 is shared: the source is emitted once, with every unit's replacements in document
 * order.
 */
export function runOverUnits(
  source: string,
  units: readonly (readonly Span[])[],
  planned: readonly RuleId[],
  locale: LocaleData,
  mode: Mode,
  narrowTarget: number,
): string {
  const replacements = units
    .flatMap((spans) => replacementsOfUnit(source, spans, planned, locale, mode, narrowTarget))
    .sort((a, b) => a.span.start - b.span.start);
  return emit(source, replacements);
}

/**
 * `runOverSpans`, reporting instead of applying (analyze.md §1). The span table supplies the
 * origin map, so every change comes back in DOCUMENT coordinates — analyze.md §6 names a
 * runtime that reports span-local offsets here as the mistake that passes every text-mode test.
 */
/** `analyzeOverSpans` per text unit (modes.md 3.1), reported in document order. */
export function analyzeOverUnits(
  source: string,
  units: readonly (readonly Span[])[],
  planned: readonly RuleId[],
  locale: LocaleData,
  mode: Mode,
  narrowTarget: number,
): Change[] {
  return units
    .flatMap((spans) => analyzeOverSpans(source, spans, planned, locale, mode, narrowTarget))
    .sort((a, b) => a.start - b.start);
}

export function analyzeOverSpans(
  source: string,
  spans: readonly Span[],
  planned: readonly RuleId[],
  locale: LocaleData,
  mode: Mode,
  narrowTarget: number,
): Change[] {
  const normalized = normalizeSpans(spans);
  if (normalized.length === 0) return [];
  return runRulesRecording(
    concatenateSpans(source, normalized),
    planned,
    locale,
    mode,
    narrowTarget,
    originOfSpans(source, normalized),
    toCodePoints(source).length,
    (current, edits) => filterBoundaryEdits(current, edits, spanRangesOf(current)),
  );
}
