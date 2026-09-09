import { describe, it, expect } from "vitest";
import { toCodePoints } from "../../src/engine/codepoints";
import {
  computeAmbiguousShapeIndices,
  computeIdiomMatchedIndices,
} from "../../src/rules/quote-ambiguity";
import { LOCALES } from "../../src/generated/locales";

const enUS = LOCALES["en-US"]!;
const enGB = LOCALES["en-GB"]!;

function indicesOf(text: string): number[] {
  return [...computeAmbiguousShapeIndices(toCodePoints(text))].sort((a, b) => a - b);
}

describe("quote-ambiguity — computeAmbiguousShapeIndices (quotes.md §3.2, spec 1.1.0)", () => {
  it("matches a medial n, in either case, space-flanked on both sides", () => {
    expect(indicesOf("rock 'n' roll")).toEqual([5, 7]);
    expect(indicesOf("rock 'N' roll")).toEqual([5, 7]);
    expect(indicesOf("fish 'n' chips")).toEqual([5, 7]);
  });

  it("does not match any other enclosed letter — spec 1.1.0's narrowing from the 0.5.0 shape", () => {
    // Through spec 0.5.0 the predicate admitted any 1-3 LETTER code points and preserved them,
    // which declined every short nested quotation in every locale. These four are now ordinary
    // quotations resolved by `quotes` — see spec/fixtures/en-US.json's en-us-quotes-ambiguous-*
    // cases, which flipped role rather than being deleted.
    expect(indicesOf("She chose 'A' today")).toEqual([]);
    expect(indicesOf("say 'no' now")).toEqual([]);
    expect(indicesOf("say 'yes' now")).toEqual([]);
    expect(indicesOf("say '\u{10400}' now")).toEqual([]);
  });

  it("does not match more than one enclosed code point, even when every one is n", () => {
    expect(indicesOf("say 'nn' now")).toEqual([]);
  });

  it("does not match 4 or more enclosed code points", () => {
    expect(indicesOf("say 'like' now")).toEqual([]);
  });

  it("does not match digit or punctuation content", () => {
    expect(indicesOf("say '12' now")).toEqual([]);
    expect(indicesOf("say '@' now")).toEqual([]);
  });

  it("does not match a leading elision (no left INLINE-SPACE, or at document start)", () => {
    expect(indicesOf("'Tis the season")).toEqual([]);
    expect(indicesOf("Back in the '90s")).toEqual([]);
  });

  it("does not match a trailing possessive (only one mark, not a pair)", () => {
    expect(indicesOf("the dogs' bowls")).toEqual([]);
  });

  it("MATCHES already-curly marks — the whole NARROW class, not straight ASCII only", () => {
    // spec 1.1.0's idempotency obligation, and the direct opposite of 0.5.0's rule. This veto's
    // marks are converted to U+2019 by `apostrophe`, so a straight-ASCII-only predicate would not
    // recognise its own output and pass 2 would pair `rock ’n’ roll` as an ordinary NARROW
    // quotation on the next run — measured as `rock «n» roll` in ru and `rock ”n” roll` in fi.
    // Pinned as fixtures: ru-quotes-rock-n-roll-already-curly, fi-quotes-rock-n-roll-already-curly.
    expect(indicesOf("rock ’n’ roll")).toEqual([5, 7]);
    expect(indicesOf("rock ‘n’ roll")).toEqual([5, 7]);
    expect(indicesOf("rock ’N’ roll")).toEqual([5, 7]);
  });

  it("requires no INLINE-SPACE at all does not match (comma directly after the mark)", () => {
    // No space before the closing word ("roll," directly, comma not space after 'n'):
    expect(indicesOf("rock 'n',roll")).toEqual([]);
  });

  it("requires AT LEAST ONE INLINE-SPACE, not exactly one — a doubled or longer run still matches", () => {
    // Only the single code point immediately adjacent to each mark is tested; a longer run of
    // inline spaces further out does not invalidate the match (spec 0.5.0 correction, retained
    // through 1.1.0 — narrowing this to "exactly one" would let a doubled-space `rock 'n' roll`
    // fall through to ordinary quote-pairing).
    expect(indicesOf("rock  'n' roll")).toEqual([6, 8]); // doubled space, left side
    expect(indicesOf("rock 'n'  roll")).toEqual([5, 7]); // doubled space, right side
    expect(indicesOf("rock  'n'  roll")).toEqual([6, 8]); // doubled space, both sides
    expect(indicesOf("rock   'n' roll")).toEqual([7, 9]); // tripled space
  });
});

describe("quote-ambiguity — computeIdiomMatchedIndices (quotes.md §3.2, spec 0.4.0)", () => {
  it("matches en-US's cited rock/n/roll idiom", () => {
    const cp = toCodePoints("rock 'n' roll");
    expect([...computeIdiomMatchedIndices(cp, enUS.quotes.elisionIdioms)].sort()).toEqual([5, 7]);
  });

  it("does not match when en-GB has no elisionIdioms entry", () => {
    expect(enGB.quotes.elisionIdioms).toEqual([]);
    const cp = toCodePoints("rock 'n' roll");
    expect(computeIdiomMatchedIndices(cp, enGB.quotes.elisionIdioms).size).toBe(0);
  });

  it("does not match a non-idiom left/right context", () => {
    const cp = toCodePoints("The letter 'n' is common.");
    expect(computeIdiomMatchedIndices(cp, enUS.quotes.elisionIdioms).size).toBe(0);
  });

  it("MAY remain stricter than the universal veto on doubled spaces — this is not a contradiction", () => {
    // The listed-idiom matcher's word-boundary test (wordEndsAt/wordStartsAt) expects the cited
    // word to occupy the code points immediately adjacent to the single tested INLINE-SPACE; a
    // doubled space puts a gap between the word and that tested position, so the word is not found
    // there and the idiom does not match. This is fine: the universal medial-n veto still fires on
    // the same input, so `quotes` still declines the pairing and `apostrophe` still converts.
    const cp = toCodePoints("rock  'n' roll");
    expect(computeIdiomMatchedIndices(cp, enUS.quotes.elisionIdioms).size).toBe(0);
  });
});

describe("quote-ambiguity — the two mechanisms agree wherever they overlap (spec 1.1.0)", () => {
  // spec 0.5.0 had a third export here, computePreserveIndices — the ambiguous-shaped positions
  // minus the idiom-matched ones — which `apostrophe` consulted to avoid converting marks 0.5.0
  // wanted preserved. It is withdrawn: conversion is now the specified outcome for every position
  // either mechanism vetoes, so `apostrophe` needs no knowledge of them at all (apostrophe.md
  // §3.4). What remains worth asserting is that the two never disagree about a shared position.
  it("every position the cited en-US idiom matches is also matched by the universal veto", () => {
    for (const text of ["rock 'n' roll", "I love rock 'n' roll.", "Rock 'n' roll is great."]) {
      const cp = toCodePoints(text);
      const idiom = computeIdiomMatchedIndices(cp, enUS.quotes.elisionIdioms);
      const universal = computeAmbiguousShapeIndices(cp);
      expect(idiom.size).toBeGreaterThan(0);
      for (const index of idiom) expect(universal.has(index)).toBe(true);
    }
  });

  it("the universal veto covers en-GB, where no citation exists, on the same input", () => {
    const cp = toCodePoints("rock 'n' roll");
    expect(computeIdiomMatchedIndices(cp, enGB.quotes.elisionIdioms).size).toBe(0);
    expect([...computeAmbiguousShapeIndices(cp)].sort((a, b) => a - b)).toEqual([5, 7]);
  });
});
