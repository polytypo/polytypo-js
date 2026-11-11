import { isLetter } from "../engine/unicode.js";
import { LINE_MARKER, NONE } from "../engine/sentinels.js";
import type { Edit, Rule, RuleContext } from "../types.js";

// spec/rules/quote-punctuation.md 3. Off by default. Reads one locale field,
// `quotes.punctuationPlacement`, and the primary close glyph; every other locale value is
// ignored, and `"none"` makes the rule a no-op.
const COMMA = 0x2c;
const FULL_STOP = 0x2e;

// spec 3.1: the classes are those of quotes.md 3.1. `SPACELIKE` = INLINE-SPACE ∪ BREAK, and the
// line-boundary marker is in BREAK for every rule (modes.md 3.2). The inline marker is in
// neither this set nor LETTER, so it fails C3 / C2 / C4 wherever it stands.
const SPACELIKE: ReadonlySet<number> = new Set([
  0x20,
  0x09,
  0xa0,
  0x202f,
  0x2007,
  0x2009,
  0x200a,
  0x0a,
  0x0d,
  0x0b,
  0x0c,
  0x85,
  0x2028,
  0x2029,
  LINE_MARKER,
]);

/** Out-of-range reads yield `NONE`, the spec's own boundary value. */
function at(cp: readonly number[], i: number): number {
  const value = cp[i];
  return value === undefined ? NONE : value;
}

export const quotePunctuationRule: Rule = {
  id: "quote-punctuation",
  apply(ctx: RuleContext): Edit[] {
    if (ctx.locale.quotes.punctuationPlacement !== "inside") return [];

    const close = ctx.locale.quotes.primary.close.codePointAt(0);
    if (close === undefined) return [];

    const cp = ctx.cp;
    const n = cp.length;
    const edits: Edit[] = [];
    let i = 0;

    // spec 3.2: C1–C4, one left-to-right scan; after an edit continue from i + 2.
    while (i + 1 < n) {
      const next = at(cp, i + 1);
      if (
        at(cp, i) === close &&
        (next === COMMA || next === FULL_STOP) &&
        i >= 1 &&
        isLetter(at(cp, i - 1)) &&
        (at(cp, i + 2) === NONE || SPACELIKE.has(at(cp, i + 2)))
      ) {
        edits.push({
          start: i,
          end: i + 2,
          replacement: [next, close],
          ruleId: "quote-punctuation",
        });
        i += 2;
        continue;
      }
      i += 1;
    }

    return edits;
  },
};
