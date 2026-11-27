import { describe, expect, it } from "vitest";
import { toCodePoints } from "../../src/engine/codepoints";
import { LOCALES } from "../../src/generated/locales";
import { findUnit, prepare } from "../../src/rules/nbsp";

// findUnit reads units bucketed by first code point. It must return exactly what a linear scan of
// the longest-first list returns, at every position, for every entry of every locale.

describe("nbsp unit index", () => {
  for (const [tag, locale] of Object.entries(LOCALES)) {
    it(`matches a linear scan at every position (${tag})`, () => {
      const prep = prepare(locale);
      const entries = [
        ...locale.nbsp.beforeUnits,
        ...locale.nbsp.spacedUnits,
        ...locale.nbsp.closedUnits,
      ];
      const probes = [
        ...entries,
        ...entries.map((e) => e.toUpperCase()),
        ...entries.map((e) => e.slice(0, -1)),
        ...entries.map((e) => `${e}x`),
        "5 km",
        "",
      ];
      const text = toCodePoints(probes.join(" "));
      for (let a = 0; a < text.length; a += 1) {
        const linear = prep.units.find((candidate) =>
          candidate.w.every((value, j) => text[a + j] === value),
        );
        expect(findUnit(text, a, prep)).toBe(linear);
      }
    });
  }
});
