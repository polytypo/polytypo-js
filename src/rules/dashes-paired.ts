import { isLetter } from "../engine/unicode.js";
import { isMarker } from "../engine/sentinels.js";
import type { Edit } from "../types.js";
import {
  EM_DASH,
  EN_DASH,
  HYPHEN,
  HYPHEN_MINUS,
  MINUS_SIGN,
  SPACE,
  WORD_JOINER,
  isBreak,
  isClusterInert,
  isDash,
  isDigit,
  isInertDash,
  isNoBreakSpace,
  isRomanFlanked,
  isSpacingTransitionBlockedLeft,
  isSpacingTransitionBlockedRight,
  rangeFlanks,
  sameContent,
} from "./dash-shared.js";

/**
 * `dash.parenthetical = "em-paired"` — spec/rules/dashes.md 3.4a. The pair is written with a
 * space outside it and none inside (`Llegó —por fin— a casa`), which no per-token rule can
 * express: which stroke opens and which closes is a property of the sentence, not of the token.
 * A sentence is converted only when it holds exactly two counted strokes and both are eligible;
 * anything else is left as typed.
 */

interface Run {
  readonly s: number;
  readonly e: number;
  readonly lsp: 0 | 1;
  readonly rsp: 0 | 1;
  readonly left: number;
  readonly right: number;
  readonly eligible: boolean;
}

function isTerminal(cp: number): boolean {
  return cp === 0x2e || cp === 0x3f || cp === 0x21 || cp === 0x2026;
}

/**
 * A terminal ends a segment only before a space (U+0020 or a no-break space, which `nbsp` puts
 * there later), a line break, a marker or the end of input.
 */
function endsSegment(cp: readonly number[], i: number): boolean {
  if (!isTerminal(cp[i] as number)) return false;
  if (i + 1 >= cp.length) return true;
  const next = cp[i + 1] as number;
  return next === SPACE || isNoBreakSpace(next) || isBreak(next) || isMarker(next);
}

function classify(cp: readonly number[], s: number, e: number): Run | undefined {
  const n = cp.length;
  const k = e - s;
  if (k > 3) return undefined;

  const lsp = s > 0 && cp[s - 1] === SPACE ? 1 : 0;
  const rsp = e < n && cp[e] === SPACE ? 1 : 0;
  const first = cp[s] as number;
  const isHyphenShaped = first === HYPHEN_MINUS || first === HYPHEN || first === MINUS_SIGN;
  // A hyphen inside a word is a compound, not a stroke.
  if (k === 1 && isHyphenShaped && lsp === 0 && rsp === 0) return undefined;
  // The hyphen of `+/-`, which `symbols` (order 80) turns into `±`: counting it would let that
  // later rule change the number of strokes in the segment.
  if (k === 1 && first === HYPHEN_MINUS && s >= 2 && cp[s - 1] === 0x2f && cp[s - 2] === 0x2b) {
    return undefined;
  }

  const counted = (eligible: boolean, left: number, right: number): Run => ({
    s,
    e,
    lsp: lsp as 0 | 1,
    rsp: rsp as 0 | 1,
    left,
    right,
    eligible,
  });

  let left = s - 1 - lsp;
  let right = e + rsp;
  if (left < 0 || right >= n) return counted(false, left, right);

  const joinStart = left + 1;
  const joinEnd = right;
  while (left >= 0 && cp[left] === WORD_JOINER) left -= 1;
  while (right < n && cp[right] === WORD_JOINER) right += 1;
  if (left < 0 || right >= n) return counted(false, left, right);
  const crossedJoiner = left + 1 !== joinStart || right !== joinEnd;

  if (rangeFlanks(cp, left, right) !== undefined) return undefined;
  if (crossedJoiner) return counted(false, left, right);

  const leftCp = cp[left] as number;
  const rightCp = cp[right] as number;
  if (isBreak(leftCp) || isBreak(rightCp)) return counted(false, left, right);
  if (isInertDash(leftCp) || isInertDash(rightCp)) return counted(false, left, right);
  if (isDash(leftCp) || isDash(rightCp)) return counted(false, left, right);
  if (leftCp === SPACE || isNoBreakSpace(leftCp)) return counted(false, left, right);
  if (rightCp === SPACE || isNoBreakSpace(rightCp)) return counted(false, left, right);
  if (isClusterInert(cp, s, e)) return counted(false, left, right);

  // A stroke spaced on one side only is eligible solely as the one em dash that is already half
  // of the target form; `-mente`, `pre-`, `--force` and `- item` are not dashes.
  if (lsp !== rsp && !(k === 1 && first === EM_DASH)) return counted(false, left, right);
  // P4: a tight stroke between two Roman numerals is a range already in its correct form.
  if (lsp === 0 && rsp === 0 && isRomanFlanked(cp, left, right)) return counted(false, left, right);
  // P5: an authored lone en dash is declined in every locale.
  if (k === 1 && first === EN_DASH) return counted(false, left, right);
  return counted(true, left, right);
}

function wantsSpace(cp: number): boolean {
  return isLetter(cp) || isDigit(cp);
}

export function scanPaired(cp: readonly number[]): Edit[] {
  const n = cp.length;
  const edits: Edit[] = [];

  let segment: Run[] = [];
  let i = 0;

  const flush = (): void => {
    if (segment.length === 2) emitPair(cp, segment[0] as Run, segment[1] as Run, edits);
    segment = [];
  };

  while (i < n) {
    if (isDash(cp[i] as number)) {
      const s = i;
      let e = s;
      while (e < n && isDash(cp[e] as number)) e += 1;
      i = e;
      const run = classify(cp, s, e);
      if (run !== undefined) segment.push(run);
      continue;
    }
    if (endsSegment(cp, i)) flush();
    i += 1;
  }
  flush();

  return edits;
}

function emitPair(cp: readonly number[], a: Run, b: Run, edits: Edit[]): void {
  if (!a.eligible || !b.eligible) return;
  if (a.lsp === 0 && a.rsp === 1) return; // the first stroke is shaped like a closer
  if (b.lsp === 1 && b.rsp === 0) return; // the second stroke is shaped like an opener
  for (let j = a.e; j < b.s; j += 1) {
    if (isBreak(cp[j] as number)) return;
  }

  const insertBefore = a.lsp === 0 && wantsSpace(cp[a.left] as number);
  const insertAfter = b.rsp === 0 && wantsSpace(cp[b.right] as number);
  if (insertBefore && isSpacingTransitionBlockedLeft(cp, a.left)) return;
  if (insertAfter && isSpacingTransitionBlockedRight(cp, b.right)) return;

  const opener = a.lsp === 1 || insertBefore ? [SPACE, EM_DASH] : [EM_DASH];
  const closer = b.rsp === 1 || insertAfter ? [EM_DASH, SPACE] : [EM_DASH];

  const pairs: [Run, number[]][] = [
    [a, opener],
    [b, closer],
  ];
  for (const [run, replacement] of pairs) {
    const start = run.s - run.lsp;
    const end = run.e + run.rsp;
    if (sameContent(cp, start, end, replacement)) continue;
    edits.push({ start, end, replacement, ruleId: "dashes" });
  }
}
