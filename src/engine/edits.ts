import { PolytypoError } from "../errors.js";
import type { Edit, RuleId } from "../types.js";
import { isValidCodePoint } from "./codepoints.js";

function reject(message: string): never {
  throw new PolytypoError("POLYTYPO_RULE_CONTRACT", message);
}

/**
 * Rules are community-contributed, so the contract is enforced rather than trusted: edits must
 * be in bounds, ascending, non-overlapping, and made of real code points.
 */
export function validateEdits(edits: readonly Edit[], length: number, ruleId?: RuleId): void {
  let previousEnd = 0;
  let i = -1;
  for (const edit of edits) {
    i += 1;
    const where = ruleId === undefined ? `edit ${i}` : `rule "${ruleId}" edit ${i}`;

    if (!Number.isInteger(edit.start) || !Number.isInteger(edit.end)) {
      reject(`${where} has non-integer bounds (${edit.start}, ${edit.end})`);
    }
    if (edit.start < 0 || edit.end > length) {
      reject(`${where} is out of bounds (${edit.start}, ${edit.end}) for length ${length}`);
    }
    if (edit.end < edit.start) {
      reject(`${where} has end ${edit.end} before start ${edit.start}`);
    }
    if (edit.start < previousEnd) {
      reject(`${where} starts at ${edit.start}, which overlaps or precedes the previous edit`);
    }
    if (ruleId !== undefined && edit.ruleId !== ruleId) {
      reject(`${where} is tagged "${edit.ruleId}" but was produced by rule "${ruleId}"`);
    }
    for (const value of edit.replacement) {
      if (!isValidCodePoint(value)) {
        reject(`${where} contains an invalid code point (${value})`);
      }
    }
    previousEnd = edit.end;
  }
}

/**
 * Applies validated edits left to right, producing a code-point array. With no edits the input
 * array itself comes back, not a copy: a rule never mutates `RuleContext.cp`, nor does anything
 * downstream of the pipeline, so sharing it is safe and saves a whole-array copy per rule.
 */
export function applyEdits(
  cp: readonly number[],
  edits: readonly Edit[],
  ruleId?: RuleId,
): readonly number[] {
  validateEdits(edits, cp.length, ruleId);
  if (edits.length === 0) return cp;

  let newLength = cp.length;
  for (const edit of edits) newLength += edit.replacement.length - (edit.end - edit.start);
  const out = new Array<number>(newLength);
  let cursor = 0;
  let w = 0;
  for (const edit of edits) {
    for (let k = cursor; k < edit.start; k += 1) out[w++] = cp[k] as number;
    for (const value of edit.replacement) out[w++] = value;
    cursor = edit.end;
  }
  for (let k = cursor; k < cp.length; k += 1) out[w++] = cp[k] as number;
  return out;
}
