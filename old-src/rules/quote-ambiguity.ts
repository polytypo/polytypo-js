import { toCodePoints } from "../engine/codepoints.js";
import { isLetter } from "../engine/unicode.js";
import { MARKER, NONE } from "../engine/sentinels.js";
import type { ElisionClitics, ElisionIdiom } from "../types.js";

/**
 * The structural predicates `quotes` (order 40) reads to decline a pairing — quotes.md 3.2.
 *
 * Two mechanisms, both decline-only, both with the same outcome: the marks survive pass 2
 * unmatched and `apostrophe` (order 50) converts each by its own case ladder (apostrophe.md 3.3
 * cases 4 then 3), giving `rock ’n’ roll`.
 *
 * {@link computeIdiomMatchedIndices} is the locale-cited mechanism (spec 0.4.0): an exact
 * `left`/`elided`/`right` context match against `quotes.elisionIdioms`.
 *
 * {@link computeAmbiguousShapeIndices} is the universal medial-`n` veto (spec 1.1.0): a pair of
 * `NARROW` marks enclosing exactly one code point, U+006E `n` or U+004E `N`, with at least one
 * `INLINE-SPACE` code point immediately outside each mark. It needs no citation because the
 * operator ruled the idiom international (quotes.md 3.2, 2026-09-09), and it vetoes a superset of
 * what the cited en-US entry does.
 *
 * {@link computeSpanBoundaryVetoIndices} is the span-boundary elision veto (spec 1.4.0): a
 * `NARROW` mark whose literal left or right neighbour IS modes.md 3.2's inline boundary marker,
 * with a cited `quotes.elisionClitics` fragment attaching on its other side. It exists because
 * the two mechanisms above both need a real code point on each side, so a possessive or elision
 * written flush against a span (`` `x`'s ``, `l'<em>idée</em>`) escaped both and was paired as a
 * quotation, inverting the enclosing pair (canonical issue #53).
 *
 * Only `quotes` consumes this module. Spec 0.5.0 had `apostrophe` consume it too, through a
 * preserve set that stopped its case ladder from converting marks 0.5.0 wanted preserved;
 * conversion is now the specified outcome, so that set is withdrawn (apostrophe.md 3.4) and
 * `apostrophe` reads no locale data again.
 */

/** quotes.md 3.2 — the one code point this veto's span may enclose, in either case. */
const LOWER_N = 0x6e;
const UPPER_N = 0x4e;

/** quotes.md 3.1 NARROW — the quote-mark glyphs an elision idiom's marks may appear as across
 * pipeline passes (straight, or already curled by an earlier pass). Canonical definition, shared
 * so `quotes` and `apostrophe` cannot define two slightly different NARROW sets. */
export const NARROW: ReadonlySet<number> = new Set([
  0x27, 0x2018, 0x2019, 0x201a, 0x201b, 0x2039, 0x203a,
]);

/** quotes.md 3.1 INLINE-SPACE — deliberately excludes BREAK, so this shape never crosses a
 * line/span boundary (modes.md 3.3), matching the existing elisionIdioms anchor exactly. */
const INLINE_SPACE: ReadonlySet<number> = new Set([
  0x20, 0x09, 0xa0, 0x202f, 0x2007, 0x2009, 0x200a,
]);

/** Out-of-range reads yield `NONE`, the spec's own boundary value. */
function at(cp: readonly number[], i: number): number {
  const value = cp[i];
  return value === undefined ? NONE : value;
}

/**
 * Case-insensitive-first-code-point comparison, ASCII-only — the same convention
 * `nbsp.afterShortWords` and the existing idiom matcher use (quotes.ts's own `asciiLower`,
 * relocated here so both consumers share one definition).
 */
function asciiLower(cp: number): number {
  return cp >= 0x41 && cp <= 0x5a ? cp + 0x20 : cp;
}

function isAlnum(cp: number): boolean {
  const DIGIT_ZERO = 0x30;
  const DIGIT_NINE = 0x39;
  return (cp >= DIGIT_ZERO && cp <= DIGIT_NINE) || isLetter(cp);
}

function wordEndsAt(arr: readonly number[], end: number, word: readonly number[]): boolean {
  const start = end - word.length;
  if (start < 0) return false;
  for (let k = 0; k < word.length; k += 1) {
    const c = at(arr, start + k);
    const matches = k === 0 ? asciiLower(c) === asciiLower(word[k] as number) : c === word[k];
    if (!matches) return false;
  }
  const before = start > 0 ? at(arr, start - 1) : NONE;
  return before === NONE || !isAlnum(before);
}

function wordStartsAt(arr: readonly number[], start: number, word: readonly number[]): boolean {
  const n = arr.length;
  for (let k = 0; k < word.length; k += 1) {
    const c = at(arr, start + k);
    const matches = k === 0 ? asciiLower(c) === asciiLower(word[k] as number) : c === word[k];
    if (!matches) return false;
  }
  const after = start + word.length < n ? at(arr, start + word.length) : NONE;
  return after === NONE || !isAlnum(after);
}

interface CompiledIdiom {
  readonly left: readonly number[];
  readonly elided: readonly number[];
  readonly right: readonly number[];
}

/**
 * Listed elision veto (quotes.md 3.2, spec 0.4.0), locale data `quotes.elisionIdioms`. Bounded
 * literal scan for `left, NARROW, elided, NARROW, right` (`rock 'n' roll`'s `{left: "rock",
 * elided: "n", right: "roll"}`). Both marks of a match are returned. Matches on NARROW quote
 * marks generally (U+0027 and already-curly U+2018/U+2019), not only straight ASCII — this is
 * `quotes`' own idempotency requirement (an idiom must still veto pairing on a second pipeline
 * pass, after `apostrophe` has curled the marks) and is unchanged from spec 0.4.0/0.4.1.
 */
export function computeIdiomMatchedIndices(
  arr: readonly number[],
  idioms: readonly ElisionIdiom[],
): ReadonlySet<number> {
  const vetoed = new Set<number>();
  if (idioms.length === 0) return vetoed;

  const n = arr.length;
  const compiled: readonly CompiledIdiom[] = idioms.map((idiom) => ({
    left: toCodePoints(idiom.left),
    elided: toCodePoints(idiom.elided),
    right: toCodePoints(idiom.right),
  }));

  for (let i = 0; i < n; i += 1) {
    const g = at(arr, i);
    if (!NARROW.has(g)) continue;

    const lLit = i > 0 ? at(arr, i - 1) : NONE;
    if (lLit === NONE || !INLINE_SPACE.has(lLit)) continue;

    for (const idiom of compiled) {
      const k = idiom.elided.length;
      const j = i + 1 + k;
      if (j >= n) continue;

      let elidedMatches = true;
      for (let w = 0; w < k; w += 1) {
        if (at(arr, i + 1 + w) !== idiom.elided[w]) {
          elidedMatches = false;
          break;
        }
      }
      if (!elidedMatches) continue;
      if (!NARROW.has(at(arr, j))) continue;

      const rLit = j + 1 < n ? at(arr, j + 1) : NONE;
      if (rLit === NONE || !INLINE_SPACE.has(rLit)) continue;

      if (!wordEndsAt(arr, i - 1, idiom.left)) continue;
      if (!wordStartsAt(arr, j + 2, idiom.right)) continue;

      vetoed.add(i);
      vetoed.add(j);
    }
  }

  return vetoed;
}

/**
 * The universal medial-`n` elision shape, locale-independent (spec 1.1.0, quotes.md 3.2): a pair
 * of `NARROW` marks enclosing exactly one code point, U+006E `n` or U+004E `N`, with **at least
 * one** `INLINE-SPACE` code point immediately outside each mark. A longer run of inline spaces
 * (`rock  'n'  roll`) still matches, since only the single adjacent code point is tested; the
 * "exactly one" variant would let a doubled-space `rock 'n' roll` fall through to ordinary
 * quote-pairing. Both mark positions are returned for every match.
 *
 * **`NARROW`, not `SQ`, and that is an idempotency obligation rather than a preference.** This
 * veto's marks are converted to U+2019 by `apostrophe`, so a straight-ASCII-only predicate would
 * not recognise its own output and pass 2 would pair `rock ’n’ roll` as an ordinary `NARROW`
 * quotation on the next pipeline run — measured, with a straight-only predicate, as
 * `rock «n» roll` in `ru` and `rock ”n” roll` in `fi`. Spec 0.5.0's predicate was straight-only,
 * correctly for its own preserve-then-stop outcome; inverting the outcome forces the widening.
 * `apostrophe` emits U+2019 only in place of U+0027, so a span already written with real marks is
 * matched and then left exactly as the author typed it.
 *
 * A superset of {@link computeIdiomMatchedIndices}'s output for every idiom whose `elided` field
 * is a single `n`, which is every idiom shipped so far, but computed independently rather than
 * assumed — a future idiom's `elided` field is not required to be that short.
 */
export function computeAmbiguousShapeIndices(cp: readonly number[]): ReadonlySet<number> {
  const ambiguous = new Set<number>();
  const n = cp.length;

  for (let i = 0; i < n; i += 1) {
    if (!NARROW.has(at(cp, i))) continue;

    const lLit = i > 0 ? at(cp, i - 1) : NONE;
    if (lLit === NONE || !INLINE_SPACE.has(lLit)) continue;

    const enclosed = at(cp, i + 1);
    if (enclosed !== LOWER_N && enclosed !== UPPER_N) continue;

    const j = i + 2;
    if (!NARROW.has(at(cp, j))) continue;

    const rLit = j + 1 < n ? at(cp, j + 1) : NONE;
    if (rLit === NONE || !INLINE_SPACE.has(rLit)) continue;

    ambiguous.add(i);
    ambiguous.add(j);
  }

  return ambiguous;
}

/**
 * Span-boundary elision veto (quotes.md 3.2, spec 1.4.0), locale data `quotes.elisionClitics`.
 *
 * Fires only where one literal neighbour is the inline `MARKER`, which is why it is inert in
 * `text` and `yaml` modes — neither produces one. The attaching side is read as a MAXIMAL
 * `LETTER` run bounded by a non-`ALNUM` code point (or `NONE`) and compared whole: a prefix test
 * would match the entry `s` inside `sure` and eat `<em>'sure'</em>`, a genuine quotation.
 *
 * The comparison folds the run's first code point, ASCII A-Z only, and is exact thereafter —
 * the same convention the idiom matcher above uses, never a platform locale function
 * (ARCHITECTURE.md 4.4). Entries are authored lowercase, enforced at the data boundary.
 */
export function computeSpanBoundaryVetoIndices(
  arr: readonly number[],
  clitics: ElisionClitics | undefined,
): ReadonlySet<number> {
  const vetoed = new Set<number>();
  const before = clitics?.before ?? [];
  const after = clitics?.after ?? [];
  if (before.length === 0 && after.length === 0) return vetoed;

  const compiled = {
    before: before.map(toCodePoints),
    after: after.map(toCodePoints),
  };

  for (let i = 0; i < arr.length; i += 1) {
    if (!NARROW.has(at(arr, i))) continue;
    if (at(arr, i - 1) === MARKER && runMatches(arr, i, 1, compiled.after)) {
      vetoed.add(i);
      continue;
    }
    if (at(arr, i + 1) === MARKER && runMatches(arr, i, -1, compiled.before)) {
      vetoed.add(i);
    }
  }
  return vetoed;
}

/**
 * The maximal `LETTER` run adjacent to the mark at `i` in direction `dir`, compared against
 * `entries`. Returns false for an empty run, for a run the caller's own `ALNUM` bound continues
 * past (a digit directly beyond the letters is still a word character, so the run is not the
 * whole fragment), and for a run no entry equals.
 */
function runMatches(
  arr: readonly number[],
  i: number,
  dir: 1 | -1,
  entries: readonly (readonly number[])[],
): boolean {
  const run: number[] = [];
  let j = i + dir;
  for (; ; j += dir) {
    const cp = at(arr, j);
    if (cp === NONE || !isLetter(cp)) break;
    run.push(cp);
  }
  if (run.length === 0) return false;
  const outer = at(arr, j);
  if (outer !== NONE && isAlnum(outer)) return false;
  if (dir === -1) run.reverse();

  for (const entry of entries) {
    if (entry.length !== run.length) continue;
    let same = at(entry, 0) === asciiLower(at(run, 0));
    for (let k = 1; same && k < entry.length; k += 1) same = at(entry, k) === at(run, k);
    if (same) return true;
  }
  return false;
}
