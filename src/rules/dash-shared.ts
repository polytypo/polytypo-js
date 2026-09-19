import { LINE_MARKER, NONE } from "../engine/sentinels.js";
import type { LocaleData } from "../types.js";

/**
 * Structural primitives shared by `dashes` (spec/rules/dashes.md) and `ranges`
 * (spec/rules/ranges.md), spec 0.5.0. Both rules scan the same DASH-token shape and share the
 * same symmetry/isolation/cluster/joiner guards (dashes.md 3.2, 3.2a, 3.2b) — this module is the
 * single source of truth for that shared machinery, so the two rules cannot drift apart the way
 * two independent re-derivations could. Each rule adds only its own branch-specific guards
 * (P1/P4 for `dashes`; G1-G5 for `ranges`) and its own locale style (`dash.parenthetical` vs
 * `dash.range`) on top of what `findDashTokens` returns.
 *
 * Not a `Rule` itself and not registered in `registry.ts` — an internal engine module, exactly
 * like `spans.ts` is to the mode adapters.
 */

export const HYPHEN_MINUS = 0x2d;
export const HYPHEN = 0x2010;
const FIGURE_DASH = 0x2012;
export const EN_DASH = 0x2013;
export const EM_DASH = 0x2014;
const HORIZONTAL_BAR = 0x2015;
export const MINUS_SIGN = 0x2212;
const SMALL_EM_DASH = 0xfe58;
const SMALL_HYPHEN_MINUS = 0xfe63;
const FULLWIDTH_HYPHEN_MINUS = 0xff0d;
export const SPACE = 0x20;
const FULL_STOP = 0x2e;
const COMMA = 0x2c;
const DIGIT_ZERO = 0x30;
const DIGIT_NINE = 0x39;
/** dashes.md 3.1 JOINER — U+2060, emitted only around a tight range dash (ranges.md 3.3.1). */
export const WORD_JOINER = 0x2060;

/** dashes.md 3.1 DASH. See dashes.ts's historical note; unchanged by the ranges split. */
export function isDash(cp: number): boolean {
  return (
    cp === HYPHEN_MINUS || cp === HYPHEN || cp === EN_DASH || cp === EM_DASH || cp === MINUS_SIGN
  );
}

/** dashes.md 3.1 INERT-DASH: never a candidate, never produced, by either rule. */
export function isInertDash(cp: number): boolean {
  return (
    cp === 0x00ad ||
    cp === FIGURE_DASH ||
    cp === 0x2011 ||
    cp === HORIZONTAL_BAR ||
    cp === SMALL_EM_DASH ||
    cp === SMALL_HYPHEN_MINUS ||
    cp === FULLWIDTH_HYPHEN_MINUS
  );
}

/** dashes.md 3.1 DIGIT: ASCII only, deliberately — see dashes.md 7.1. */
export function isDigit(cp: number): boolean {
  return cp >= DIGIT_ZERO && cp <= DIGIT_NINE;
}

/** `BREAK` — including `LINE_MARKER`, a member for every rule everywhere (modes.md 3.2). */
export function isBreak(cp: number): boolean {
  return (
    cp === 0x0a ||
    cp === 0x0d ||
    cp === 0x0b ||
    cp === 0x0c ||
    cp === 0x85 ||
    cp === 0x2028 ||
    cp === 0x2029 ||
    cp === LINE_MARKER
  );
}

export function isNoBreakSpace(cp: number): boolean {
  return cp === 0x00a0 || cp === 0x202f;
}

export type DashStyle = LocaleData["dash"]["parenthetical"];

export function dashCodePoint(style: DashStyle): number {
  return style === "em-tight" || style === "em-spaced" ? EM_DASH : EN_DASH;
}

export function isSpaced(style: DashStyle): boolean {
  return style === "em-spaced" || style === "en-spaced";
}

export function sameContent(
  cp: readonly number[],
  start: number,
  end: number,
  next: readonly number[],
): boolean {
  if (end - start !== next.length) return false;
  for (let i = 0; i < next.length; i += 1) {
    if (cp[start + i] !== next[i]) return false;
  }
  return true;
}

/**
 * dashes.md 3.6: every replacement is built from U+0020 alone. `bind` is meaningful only for
 * `ranges` (dashes.md 3.6 / ranges.md 3.3.1) — `dashes`' parenthetical branch always calls this
 * with `bind = false`, since a parenthetical dash never binds (an interrupting dash is exactly
 * where a line may break).
 */
export function buildReplacement(style: DashStyle, bind: boolean): number[] {
  if (!isSpaced(style)) {
    return bind ? [WORD_JOINER, dashCodePoint(style), WORD_JOINER] : [dashCodePoint(style)];
  }
  return [SPACE, dashCodePoint(style), SPACE];
}

/** dashes.md 3.2 step 9 (T2) — the positions `spaces` (order 10) deletes a U+0020 from. */
export function isStripBeforeOrCloseBracket(cp: number): boolean {
  return (
    cp === COMMA ||
    cp === FULL_STOP ||
    cp === 0x3b ||
    cp === 0x3a ||
    cp === 0x21 ||
    cp === 0x3f ||
    cp === 0x2026 ||
    cp === 0x29 ||
    cp === 0x5d ||
    cp === 0x7d
  );
}

export function isOpenBracket(cp: number): boolean {
  return cp === 0x28 || cp === 0x5b || cp === 0x7b;
}

/**
 * dashes.md 3.2 step 7: the cluster alphabet is DASH ∪ INERT-DASH ∪ DIGIT ∪ JOINER ∪
 * CLOSED-SYMBOL. Shared between `dashes` and `ranges` because a cluster like `2026-08-15` or
 * `known-5-10` can contain runs that belong to either rule, and the whole cluster must be inert
 * to both if it holds two or more dash runs (dashes.md 3.2 step 7).
 *
 * CLOSED-SYMBOL joined the alphabet in spec 1.3.0, when ranges.md 3.2a made a symbol adjacent to
 * a digit run part of a range token's own territory. Without it `a—$15-$20` is two clusters where
 * `a—15-20` is one, so `dashes` converts the em dash, that edit moves the range's `before` from a
 * dash to a space, and the range converts on the NEXT pass — a transform idempotency defect in
 * every locale whose parenthetical form is spaced.
 */
function isClusterMember(cp: number): boolean {
  return isDash(cp) || isInertDash(cp) || isDigit(cp) || cp === WORD_JOINER;
}

export function isDashUnion(cp: number): boolean {
  return isDash(cp) || isInertDash(cp);
}

/** dashes.md 3.2 step 7 — cluster guard. */
function isClusterInert(cp: readonly number[], s: number, e: number): boolean {
  const n = cp.length;
  let start = s;
  while (start > 0 && isClusterMember(cp[start - 1] as number)) start -= 1;
  let end = e;
  while (end < n && isClusterMember(cp[end] as number)) end += 1;

  let runs = 0;
  let i = start;
  while (i < end) {
    if (!isDashUnion(cp[i] as number)) {
      i += 1;
      continue;
    }
    runs += 1;
    if (runs >= 2) return true;
    while (i < end && isDashUnion(cp[i] as number)) i += 1;
  }
  return false;
}

/**
 * dashes.md 3.2b — effective neighbour. Step outward across a maximal run of JOINER and return
 * the index of the first code point that is not one, or -1 if the walk leaves the array. Every
 * guard in either rule that inspects a code point outside its own token's dash run must read one
 * of these — see dashes.md 3.2b for why this is forced rather than chosen (CO-S,
 * pipeline-idempotency.md 5.1a).
 */
export function effectiveIndex(cp: readonly number[], from: number, step: number): number {
  let i = from;
  while (i >= 0 && i < cp.length && cp[i] === WORD_JOINER) i += step;
  return i >= 0 && i < cp.length ? i : -1;
}

export function effectiveNeighbour(cp: readonly number[], from: number, step: number): number {
  const i = effectiveIndex(cp, from, step);
  return i < 0 ? NONE : (cp[i] as number);
}

/**
 * ranges.md 3.2a CLOSED-SYMBOL (spec 1.3.0) — the symbols conventionally written closed up to a
 * number, as a literal code-point set. Not a Unicode category test: a category makes the verdict
 * depend on which Unicode version a runtime was built against, and the five runtimes must agree
 * (the same argument ranges.md 7.1 makes for DIGIT being ASCII-only). The Currency Symbols block
 * is enumerated by its bounds, which never move.
 */
export function isClosedUpSymbol(cp: number): boolean {
  return (
    cp === 0x0024 || // DOLLAR SIGN
    (cp >= 0x00a2 && cp <= 0x00a5) || // CENT, POUND, CURRENCY, YEN
    (cp >= 0x20a0 && cp <= 0x20bf) || // Currency Symbols block
    cp === 0x0025 || // PERCENT SIGN
    cp === 0x2030 || // PER MILLE SIGN
    cp === 0x2031 || // PER TEN THOUSAND SIGN
    cp === 0x00b0 // DEGREE SIGN
  );
}

/** ranges.md 3.2a — a token's flanks after the closed-up-symbol walk, with the digit runs the
 * guards and the replacement then read. */
export interface RangeFlanks {
  /** Index of the DIGIT on each flank: `L\u2032`/`R\u2032` in ranges.md 3.2a. */
  readonly left: number;
  readonly right: number;
  /** First index of Lrun and last index of Rrun. */
  readonly a: number;
  readonly b: number;
  /** Index of the matched outer symbol on each side, or -1. `before`/`after` read past these
   * (ranges.md 3.2a), so that G1-G3 judge the text in front of the whole member. */
  readonly outerLeft: number;
  readonly outerRight: number;
}

/**
 * ranges.md 3.2 and 3.2a — is this token a range candidate, and where are its digit runs?
 * Returns undefined when it is not one, which is the signal that the token belongs to `dashes`.
 *
 * A side consumes a closed-up symbol only when the opposite member repeats the same code point
 * (`$15-$20`, `35%-50%`). An unmatched symbol leaves the flank a non-DIGIT, so `$15-\u20ac20` and
 * `15-$20` are not candidates and do not change hands.
 */
export function rangeFlanks(
  cp: readonly number[],
  left: number,
  right: number,
): RangeFlanks | undefined {
  const n = cp.length;
  const innerRight =
    isClosedUpSymbol(cp[right] as number) && right + 1 < n && isDigit(cp[right + 1] as number)
      ? (cp[right] as number)
      : undefined;
  const innerLeft =
    isClosedUpSymbol(cp[left] as number) && left > 0 && isDigit(cp[left - 1] as number)
      ? (cp[left] as number)
      : undefined;

  const l = innerLeft === undefined ? left : left - 1;
  const r = innerRight === undefined ? right : right + 1;
  if (!isDigit(cp[l] as number) || !isDigit(cp[r] as number)) return undefined;

  let a = l;
  while (a > 0 && isDigit(cp[a - 1] as number)) a -= 1;
  let b = r;
  while (b + 1 < n && isDigit(cp[b + 1] as number)) b += 1;

  let outerLeft = -1;
  if (innerRight !== undefined) {
    outerLeft = effectiveIndex(cp, a - 1, -1);
    if (outerLeft < 0 || cp[outerLeft] !== innerRight) return undefined;
  }
  let outerRight = -1;
  if (innerLeft !== undefined) {
    outerRight = effectiveIndex(cp, b + 1, 1);
    if (outerRight < 0 || cp[outerRight] !== innerLeft) return undefined;
  }

  return { left: l, right: r, a, b, outerLeft, outerRight };
}

/**
 * dashes.md 3.2 step 8 (T1) — spacing-transition guard. Shared because a `dashes` token
 * becoming spaced can insert a space next to a `ranges` token's digit run (or vice versa is
 * structurally impossible, since `ranges` styles are never `-spaced` in any v1 locale, but the
 * guard is implemented for both regardless of what the current locale data happens to contain —
 * dashes.md 7.11 item 7 notes `dash.range` carries the same five-value enum as
 * `dash.parenthetical`).
 */
/**
 * T1's reach is transparent to one CLOSED-SYMBOL on either end of a digit run (spec 1.3.0). The
 * digit run this guard protects may be a range member carrying an outer symbol — `$1 - $1--a`,
 * `a--15% - 20%` — and reading the symbol as the neighbour would stop the walk one code point
 * short of the dash it exists to find.
 */
function skipClosedUpSymbol(cp: readonly number[], from: number, step: number): number {
  const i = effectiveIndex(cp, from, step);
  if (i < 0 || !isClosedUpSymbol(cp[i] as number)) return from;
  return i + step;
}

export function isSpacingTransitionBlocked(
  cp: readonly number[],
  left: number,
  right: number,
): boolean {
  const n = cp.length;

  // Spec 1.3.0: the reach steps over a CLOSED-SYMBOL that sits between the token and a digit
  // run, because ranges.md 3.2a made that shape a range token — the digit run whose verdict this
  // guard protects is one code point further out than it used to be.
  const l =
    isClosedUpSymbol(cp[left] as number) && left > 0 && isDigit(cp[left - 1] as number)
      ? left - 1
      : left;
  const r =
    isClosedUpSymbol(cp[right] as number) && right + 1 < n && isDigit(cp[right + 1] as number)
      ? right + 1
      : right;

  if (isDigit(cp[l] as number)) {
    let d = l;
    while (d > 0 && isDigit(cp[d - 1] as number)) d -= 1;
    const i1 = effectiveIndex(cp, skipClosedUpSymbol(cp, d - 1, -1), -1);
    const one = i1 < 0 ? NONE : (cp[i1] as number);
    const two = i1 < 0 ? NONE : effectiveNeighbour(cp, i1 - 1, -1);
    if (isDashUnion(one)) return true;
    if ((one === SPACE || isNoBreakSpace(one)) && isDashUnion(two)) return true;
  }

  if (isDigit(cp[r] as number)) {
    let d = r;
    while (d + 1 < n && isDigit(cp[d + 1] as number)) d += 1;
    const i1 = effectiveIndex(cp, skipClosedUpSymbol(cp, d + 1, 1), 1);
    const one = i1 < 0 ? NONE : (cp[i1] as number);
    const two = i1 < 0 ? NONE : effectiveNeighbour(cp, i1 + 1, 1);
    if (isDashUnion(one)) return true;
    if ((one === SPACE || isNoBreakSpace(one)) && isDashUnion(two)) return true;
  }

  return false;
}

export interface DashToken {
  /** Start/end (exclusive) of the DASH run itself, in input-array indices. */
  readonly s: number;
  readonly e: number;
  readonly lsp: 0 | 1;
  readonly rsp: 0 | 1;
  /** Index of the code point immediately left/right of the token's content, after walking
   * across any adjacent JOINER run (dashes.md 3.2a). */
  readonly left: number;
  readonly right: number;
  readonly leftCp: number;
  readonly rightCp: number;
  /** Start/end of the full edit span, including outer spacing and any joiner this token is
   * re-entering across (dashes.md 3.2a) — meaningful only when `crossedJoiner` is true, which
   * for a non-digit-flanked token always means "decline" (see `findDashTokens`'s own doc). */
  readonly spanStart: number;
  readonly spanEnd: number;
  readonly crossedJoiner: boolean;
}

/**
 * dashes.md 3.2 steps 1-7 and 3.2a, exactly as they read before the `ranges` split — the common
 * prefix every DASH-run token must pass before either rule's own branch-specific guards run.
 * Returns every token that survives symmetry, content, joiner-crossing, isolation and cluster
 * guards; each rule then filters to the tokens it owns:
 *
 * - `ranges` only ever processes a token whose `leftCp`/`rightCp` are both DIGIT.
 * - `dashes` must decline every such token unconditionally (operator decision, spec 0.5.0) —
 *   never reinterpreting a digit-flanked stroke as a parenthetical dash, regardless of whether
 *   `ranges` is enabled.
 *
 * A token with `crossedJoiner = true` and non-digit flanks is **not** returned at all (declined
 * inline, exactly as dashes.md 3.2a specifies: "if a joiner was crossed in any other
 * configuration, emit nothing") — a joiner is `ranges`' own emission alphabet, and an author who
 * types one next to a dash meant it, exactly as with INERT-DASH.
 */
export function findDashTokens(cp: readonly number[]): DashToken[] {
  const n = cp.length;
  const tokens: DashToken[] = [];
  let i = 0;

  while (i < n) {
    if (!isDash(cp[i] as number)) {
      i += 1;
      continue;
    }

    const s = i;
    let e = s;
    while (e < n && isDash(cp[e] as number)) e += 1;
    i = e;

    // dashes.md 3.2 step 2 — a run longer than three is decoration, not a dash.
    if (e - s > 3) continue;

    const lsp = s > 0 && cp[s - 1] === SPACE ? 1 : 0;
    const rsp = e < n && cp[e] === SPACE ? 1 : 0;

    // dashes.md 3.2 step 4 — symmetry guard.
    if (lsp !== rsp) continue;

    // dashes.md 3.2 step 5 — content on both sides, on the same line.
    let left = s - 1 - lsp;
    let right = e + rsp;
    if (left < 0 || right >= n) continue;

    // dashes.md 3.2a — joiner neighbours.
    let joinStart = left + 1;
    let joinEnd = right;
    while (left >= 0 && cp[left] === WORD_JOINER) left -= 1;
    while (right < n && cp[right] === WORD_JOINER) right += 1;
    if (left < 0 || right >= n) continue;
    const crossedJoiner = left + 1 !== joinStart || right !== joinEnd;
    joinStart = left + 1;
    joinEnd = right;

    const leftCp = cp[left] as number;
    const rightCp = cp[right] as number;
    // dashes.md 3.2a — re-entry across a joiner is only ever a bound range `ranges` produced on
    // an earlier pass. As of spec 1.3.0 that shape includes a matched closed-up symbol on a
    // flank (ranges.md 3.2a), so `$15<J>-<J>$20` re-enters the same way `1914<J>-<J>1918` does;
    // without this a second pass would add a second joiner.
    if (crossedJoiner && rangeFlanks(cp, left, right) === undefined) continue;
    if (isBreak(leftCp) || isBreak(rightCp)) continue;

    // dashes.md 3.2 step 6 — isolation guard.
    if (isInertDash(leftCp) || isInertDash(rightCp)) continue;
    if (isDash(leftCp) || isDash(rightCp)) continue;
    if (leftCp === SPACE || isNoBreakSpace(leftCp)) continue;
    if (rightCp === SPACE || isNoBreakSpace(rightCp)) continue;

    // dashes.md 3.2 step 7 — cluster guard.
    if (isClusterInert(cp, s, e)) continue;

    const spanStart = Math.min(s - lsp, joinStart);
    const spanEnd = Math.max(e + rsp, joinEnd);

    tokens.push({
      s,
      e,
      lsp: lsp as 0 | 1,
      rsp: rsp as 0 | 1,
      left,
      right,
      leftCp,
      rightCp,
      spanStart,
      spanEnd,
      crossedJoiner,
    });
  }

  return tokens;
}
