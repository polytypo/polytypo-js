import type { Edit, RuleId } from "../types.js";
import { fromCodePoints } from "./codepoints.js";

/**
 * analyze.md §2: every reported offset is a code-point offset into the input the caller passed,
 * in every mode. The rules, however, run over an array that is not the input — in `text` mode
 * edits from earlier rules have already shifted it, and in `html`/`markdown` mode it is the
 * marker-joined concatenation of the processable spans (modes.md §3.5). This module carries the
 * one structure that bridges the two: an origin map, parallel to the current code-point array,
 * holding the input offset each code point came from, or NO_ORIGIN for one the pipeline itself
 * produced.
 */
export const NO_ORIGIN = -1;

/**
 * The input offset an edit boundary at `index` addresses. Synthetic code points have no origin
 * of their own, so the scan runs forward to the first that has one — an insertion between two
 * earlier insertions still lands where the next real character is. Falling off the end means the
 * boundary is at the end of the input.
 */
export function originAt(origin: readonly number[], index: number, inputLength: number): number {
  for (let i = index; i < origin.length; i += 1) {
    const value = origin[i] as number;
    if (value !== NO_ORIGIN) return value;
  }
  return inputLength;
}

/**
 * The origin map for the array `applyEdits` is about to produce. A replacement of equal length
 * keeps its origins position by position, which is what makes a conversion (U+0020 → U+00A0)
 * still point at the character it converted; anything longer is synthetic beyond the positions
 * it covers.
 */
export function applyEditsToOrigin(origin: readonly number[], edits: readonly Edit[]): number[] {
  if (edits.length === 0) return origin.slice();
  const out: number[] = [];
  let cursor = 0;
  for (const edit of edits) {
    for (let i = cursor; i < edit.start; i += 1) out.push(origin[i] as number);
    for (let k = 0; k < edit.replacement.length; k += 1) {
      const source = edit.start + k;
      out.push(source < edit.end ? (origin[source] as number) : NO_ORIGIN);
    }
    cursor = edit.end;
  }
  for (let i = cursor; i < origin.length; i += 1) out.push(origin[i] as number);
  return out;
}

/** One entry of `analyze`'s result, in input coordinates (analyze.md §2). */
export interface Change {
  readonly ruleId: RuleId;
  readonly start: number;
  readonly end: number;
  readonly before: string;
  readonly after: string;
}

/**
 * One rule's edits, in the coordinates that rule saw, rendered as Changes in input coordinates.
 * `before` is the text this rule replaced and `after` what it replaced it with (analyze.md §2),
 * so on a text two rules have both touched, `before` is what the second rule saw rather than
 * what the caller typed — §5 says so and shows the French case where it matters.
 */
export function recordChanges(
  cp: readonly number[],
  edits: readonly Edit[],
  origin: readonly number[],
  inputLength: number,
  ruleId: RuleId,
): Change[] {
  return edits.map((edit) => ({
    ruleId,
    start: originAt(origin, edit.start, inputLength),
    end: originAt(origin, edit.end, inputLength),
    before: fromCodePoints(cp.slice(edit.start, edit.end)),
    after: fromCodePoints(edit.replacement),
  }));
}
