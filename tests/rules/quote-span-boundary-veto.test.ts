// quotes' span-boundary elision veto — quotes.md §3.2, spec 1.4.0, canonical issue #53.
//
// The predicate is tested directly against a synthetic clitic list rather than against whatever
// the shipped locales happen to carry, so these assertions state the MECHANISM and stay true when
// a locale's cited list changes. The end-to-end outputs live in the conformance fixtures.
import { describe, expect, it } from "vitest";

import { toCodePoints } from "../../src/engine/codepoints";
import { MARKER } from "../../src/engine/sentinels";
import { computeSpanBoundaryVetoIndices } from "../../src/rules/quote-ambiguity";
import type { ElisionClitics } from "../../src/types";

/** `⟦` in a template stands for one boundary marker (the integer −1), as in quotes.test.ts. */
function cps(template: string): number[] {
  return toCodePoints(template).map((c) => (c === 0x27e6 ? MARKER : c));
}

const EN: ElisionClitics = { before: [], after: ["s", "t", "ll"] };
const FR: ElisionClitics = { before: ["l", "d", "qu"], after: [] };
const NONE_: ElisionClitics = { before: [], after: [] };

const veto = (template: string, clitics: ElisionClitics): number[] =>
  [...computeSpanBoundaryVetoIndices(cps(template), clitics)].sort((a, b) => a - b);

describe("span-boundary elision veto — the shape it fires on", () => {
  it("vetoes a possessive flush after a span boundary", () => {
    // ⟦'s — the marker stands where the attaching word would be, so the medial veto cannot see it.
    expect(veto("He says 'avoid ⟦'s printer.' Done.", EN)).toEqual([16]);
  });

  it("vetoes a contraction as readily as a possessive, and a multi-letter fragment", () => {
    expect(veto("⟦'t", EN)).toEqual([1]);
    expect(veto("⟦'ll", EN)).toEqual([1]);
  });

  it("vetoes the mirror shape — an elision flush BEFORE a span boundary", () => {
    // l'⟦ : French elision against an emphasised word. Read from `before`, not `after`.
    expect(veto("Il dit 'l'⟦idee⟦ est bonne.' Fin.", FR)).toEqual([9]);
    expect(veto("qu'⟦", FR)).toEqual([2]);
  });

  it("reads each side from its own list, never the other", () => {
    expect(veto("⟦'s", FR), "`s` is an `after` fragment; FR lists none").toEqual([]);
    expect(veto("l'⟦", EN), "`l` is a `before` fragment; EN lists none").toEqual([]);
  });

  it("is a total no-op for a locale with both lists empty", () => {
    for (const t of ["⟦'s printer", "l'⟦idee⟦", "⟦'t", "qu'⟦"]) {
      expect(veto(t, NONE_), t).toEqual([]);
    }
  });
});

describe("span-boundary elision veto — the shapes it must NOT fire on", () => {
  it("does not touch a mark with a real code point on both sides", () => {
    // The medial-elision veto already owns this; adding it here would be a second mechanism for
    // one shape, and in text mode there is no marker at all.
    expect(veto("x's printer", EN)).toEqual([]);
  });

  it("compares the whole LETTER run, never a prefix", () => {
    // `sure` is not an entry. A prefix test would have matched `s` and eaten a real quotation.
    expect(veto("He said ⟦'sure'⟦ loudly.", EN)).toEqual([]);
    expect(veto("He said ⟦'ta'⟦ loudly.", EN)).toEqual([]);
  });

  it("declines when a digit continues the word past the LETTER run", () => {
    // `outer ∉ ALNUM` is what makes the run the whole fragment: `⟦'s1` is not a possessive.
    expect(veto("⟦'s1", EN)).toEqual([]);
  });

  it("declines an empty run — the plural possessive this veto cannot reach", () => {
    // `` `xs`' printer `` is byte-identical to a closing mark after a span (quotes.md §4).
    expect(veto("He says 'avoid ⟦' printer.' Done.", EN)).toEqual([]);
  });

  it("leaves a quotation that begins or ends at a span boundary alone", () => {
    // modes.md §3.3's own normative rows. Letting the MARKER satisfy the medial veto's ALNUM
    // test broke exactly these; the clitic list is narrower than the marker on purpose.
    expect(veto("\"He said ⟦'fine'⟦ loudly\"", EN)).toEqual([]);
    expect(veto("'a'⟦x⟦'b'", EN)).toEqual([]);
  });
});

describe("span-boundary elision veto — case folding (quotes.md §3.2)", () => {
  it("folds the run's first code point, ASCII A–Z only", () => {
    expect(veto("L'⟦", FR), "sentence-initial French elision").toEqual([1]);
    expect(veto("⟦'S", EN), "a capitalised possessive").toEqual([1]);
  });

  it("does not fold past the first code point, so an all-caps fragment misses", () => {
    // Accepted limitation, shared with the listed-idiom matcher: quotes.md §7 item 10.
    expect(veto("QU'⟦", FR)).toEqual([]);
    expect(veto("⟦'LL", EN)).toEqual([]);
  });

  it("an entry authored uppercase can never match, by construction", () => {
    // The run folds down before comparison, so the entry has no uppercase form to meet. Both
    // canonical validators reject such an entry at the data boundary; this pins the consequence.
    expect(veto("⟦'s", { before: [], after: ["S"] })).toEqual([]);
  });
});

describe("span-boundary elision veto — idempotency obligation (quotes.md §5)", () => {
  it("matches an already-curled mark, so a vetoed position is vetoed again on pass 2", () => {
    // `apostrophe` emits U+2019 in place of the vetoed U+0027. U+2019 is NARROW, so the next
    // pipeline pass must reach the same verdict or the fix would not be a fixed point.
    expect(veto("⟦’s", EN)).toEqual([1]);
    expect(veto("l’⟦", FR)).toEqual([1]);
  });
});
