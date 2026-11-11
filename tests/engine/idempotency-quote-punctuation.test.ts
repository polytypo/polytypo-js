import fc from "fast-check";
import { describe, it, expect } from "vitest";
import { transform } from "../../src/index";
import { LOCALES } from "../../src/generated/locales";

// `quote-punctuation` is off by default, so tests/engine/idempotency.test.ts never runs it.
// These repeat the release-blocking invariant with the rule enabled (spec/rules/
// quote-punctuation.md 5): transform(transform(x)) === transform(x), the second call given the
// same options. The alphabet is the one the rule's conditions and its neighbours compete over:
// closing marks, stops, letters, digits, spaces, brackets, dashes and the apostrophe.

const locales = Object.keys(LOCALES);
const options = (locale: string) => ({ locale, rules: { "quote-punctuation": true } });

const ALPHABET = [
  '"',
  "'",
  "“",
  "”",
  "‘",
  "’",
  "«",
  "»",
  "a",
  "B",
  "1",
  ",",
  ".",
  ";",
  "!",
  "…",
  " ",
  " ",
  "\n",
  "(",
  ")",
  "-",
  "—",
];

function assertIdempotent(input: string, locale: string): void {
  const once = transform(input, options(locale));
  const twice = transform(once, options(locale));
  expect(twice, `not idempotent for locale ${locale}, input ${JSON.stringify(input)}`).toBe(once);
}

describe("idempotency with quote-punctuation enabled", () => {
  it("holds over a biased alphabet, in every locale", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...locales),
        fc.string({ unit: fc.constantFrom(...ALPHABET), maxLength: 24 }),
        (locale, input) => {
          assertIdempotent(input, locale);
        },
      ),
      { numRuns: 20_000 },
    );
  });

  it("holds over arbitrary Unicode, in every locale", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...locales),
        fc.string({ unit: "binary", maxLength: 200 }),
        (locale, input) => {
          assertIdempotent(input, locale);
        },
      ),
      { numRuns: 5_000 },
    );
  });

  // Enumeration in the one locale that declares `inside`; every other locale is a no-op for this
  // rule and is covered by the sampled properties above.
  it("every string up to 6 characters over the rule's own alphabet is idempotent in en-US", () => {
    const sweep = ['"', "”", "“", "’", "a", "1", ",", ".", " "];
    const broken: string[] = [];
    let moved = 0;
    let frontier = [""];
    for (let length = 1; length <= 6; length += 1) {
      const next: string[] = [];
      for (const prefix of frontier) {
        for (const char of sweep) {
          const input = prefix + char;
          next.push(input);
          const once = transform(input, options("en-US"));
          if (once !== transform(input, { locale: "en-US" })) moved += 1;
          if (transform(once, options("en-US")) !== once && broken.length < 10) {
            broken.push(JSON.stringify(input));
          }
        }
      }
      frontier = next;
    }
    expect(broken, "first non-idempotent inputs in en-US").toEqual([]);
    // A sweep that never fires proves nothing.
    expect(moved).toBeGreaterThan(1000);
  });
});
