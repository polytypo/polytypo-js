import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { transform } from "../../src/index";

// nbsp.md §3.7: N5 inserts for `spacedUnits` and deletes for `closedUnits`. Every such edit changes
// what a later pass sees, so the claim worth proving is the fixed point: a second call returns the
// first call's output, in every locale that carries the lists and in every mode.

const NBSP = " ";
const LOCALES = ["de-DE", "en-US", "en-GB", "ru", "el", "nl", "fr-CA", "hu", "cs", "sr"];

describe("nbsp units: examples (spec 1.22.0)", () => {
  it("inserts U+00A0 for spacedUnits and deletes the space for closedUnits", () => {
    expect(transform("Es sind 20km", { locale: "de-DE", mode: "text" })).toBe(
      `Es sind 20${NBSP}km`,
    );
    expect(transform("Rose 5 %", { locale: "en-US", mode: "text" })).toBe("Rose 5%");
    expect(transform(`Rose 5${NBSP}%`, { locale: "ru", mode: "text" })).toBe("Rose 5%");
  });

  it("leaves beforeUnits to conversion only", () => {
    expect(transform("14 % nebo 20%", { locale: "cs", mode: "text" })).toBe(`14${NBSP}% nebo 20%`);
  });

  it("leaves compounds, file names, identifiers and operations alone", () => {
    for (const input of ["15cm-Norm", "foto-5kg.png", "/5km", "x_5kg", "H2km", "A4kg"]) {
      expect(transform(input, { locale: "de-DE", mode: "text" })).toBe(input);
    }
    expect(transform("10 % 3", { locale: "en-US", mode: "text" })).toBe("10 % 3");
  });
});

const ATOMS = ["5", "0", " ", NBSP, "%", "km", "°C", "kg", "-", ".", ",", "a", "_", "(", "–", "×"];

describe("nbsp units: idempotency", () => {
  for (const locale of LOCALES) {
    it(`every string of up to 4 atoms is a fixed point after one pass (${locale}, text)`, () => {
      const run = (input: string): string => transform(input, { locale, mode: "text" });
      let checked = 0;
      const walk = (prefix: string, depth: number): void => {
        if (prefix !== "") {
          const once = run(prefix);
          if (run(once) !== once) {
            throw new Error(
              `not idempotent in ${locale}: ${JSON.stringify(prefix)} -> ${JSON.stringify(once)}`,
            );
          }
          checked += 1;
        }
        if (depth === 0) return;
        for (const atom of ATOMS) walk(prefix + atom, depth - 1);
      };
      walk("", 4);
      expect(checked).toBeGreaterThan(60_000);
    });

    it(`multiplication chains beside units are fixed points (${locale})`, () => {
      const atoms = ["2", "3", " ", NBSP, "\u202f", "x", "х", "kg", "км", "%"];
      const run = (input: string): string => transform(input, { locale, mode: "text" });
      const walk = (prefix: string, depth: number): void => {
        if (prefix !== "") {
          const once = run(prefix);
          if (run(once) !== once) {
            throw new Error(
              `not idempotent in ${locale}: ${JSON.stringify(prefix)} -> ${JSON.stringify(once)}`,
            );
          }
        }
        if (depth === 0) return;
        for (const atom of atoms) walk(prefix + atom, depth - 1);
      };
      walk("", 6);
    });

    it(`dash and range shapes are fixed points with ranges on (${locale})`, () => {
      const rangeAtoms = ["1", "5", "%", "°C", "$", " ", NBSP, "-", "--", "–", "—", "km", "a"];
      fc.assert(
        fc.property(
          fc.array(fc.constantFrom(...rangeAtoms), { minLength: 4, maxLength: 16 }),
          (parts) => {
            const input = parts.join("");
            const options = { locale, mode: "text", rules: { ranges: true } } as const;
            const once = transform(input, options);
            expect(transform(once, options)).toBe(once);
          },
        ),
        { numRuns: 6000 },
      );
    });

    it(`random longer strings are fixed points (${locale}, text and html)`, () => {
      fc.assert(
        fc.property(
          fc.array(fc.constantFrom(...ATOMS, "<b>", "</b>", " ", "word"), { maxLength: 14 }),
          (parts) => {
            const input = parts.join("");
            const text = transform(input, { locale, mode: "text" });
            expect(transform(text, { locale, mode: "text" })).toBe(text);
            const html = transform(input, { locale, mode: "html" });
            expect(transform(html, { locale, mode: "html" })).toBe(html);
          },
        ),
        { numRuns: 400 },
      );
    });
  }
});
