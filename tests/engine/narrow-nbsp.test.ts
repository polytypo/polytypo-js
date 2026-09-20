import { describe, expect, it } from "vitest";
import { transform, PolytypoError } from "../../src/index";
import { transform as transformText } from "../../src/index.text";

const NBSP = " ";
const NNBSP = " ";

/** spec/rules/nbsp.md §3.1a — `narrowNbsp` moves NARROW-TARGET, it does not post-process. */
describe("narrowNbsp (nbsp.md §3.1a)", () => {
  describe("what it changes", () => {
    it("writes U+00A0 where N2 would have written U+202F", () => {
      const input = "Un délai ? Vraiment ! Et puis ; voilà.";
      expect(transform(input, { locale: "fr" })).toBe(
        `Un délai${NNBSP}? Vraiment${NNBSP}! Et puis${NNBSP}; voilà.`,
      );
      expect(transform(input, { locale: "fr", narrowNbsp: "nbsp" })).toBe(
        `Un délai${NBSP}? Vraiment${NBSP}! Et puis${NBSP}; voilà.`,
      );
    });

    it("normalises an authored U+202F at a claimed index", () => {
      // The rule normalises a claimed index to its target, and the target has moved — the same
      // normalisation it already performs on an authored U+00A0 by default.
      expect(transform(`Oui${NNBSP}?`, { locale: "fr", narrowNbsp: "nbsp" })).toBe(`Oui${NBSP}?`);
      expect(transform(`Oui${NNBSP}?`, { locale: "fr" })).toBe(`Oui${NNBSP}?`);
    });

    it("leaves an authored U+202F alone where no sub-rule claims the index", () => {
      expect(transform(`mot${NNBSP}mot`, { locale: "fr", narrowNbsp: "nbsp" })).toBe(
        `mot${NNBSP}mot`,
      );
    });
  });

  describe("what it does not change", () => {
    it("claims the same indices under the same guards", () => {
      // The right-context guard still protects a time and a URL; the option is about what is
      // written, never about what is read.
      expect(transform("12:30 et http://x ; oui", { locale: "fr", narrowNbsp: "nbsp" })).toBe(
        `12:30 et http://x${NBSP}; oui`,
      );
    });

    it("does not touch a sub-rule whose target was already U+00A0", () => {
      // N1 (the colon) and N8 (fr's primary pair, innerSpace "nbsp") do not move.
      expect(transform("Il a dit : « oui » ; puis ?", { locale: "fr", narrowNbsp: "nbsp" })).toBe(
        `Il a dit${NBSP}: «${NBSP}oui${NBSP}»${NBSP}; puis${NBSP}?`,
      );
    });

    it("is a no-op in a locale that never emits U+202F", () => {
      for (const locale of ["en-US", "de-DE", "ru"] as const) {
        const input = "She said “hi” — really...";
        expect(transform(input, { locale, narrowNbsp: "nbsp" })).toBe(transform(input, { locale }));
      }
    });
  });

  describe("idempotency — the property a caller's replaceAll cannot have", () => {
    it("is a fixed point under the option", () => {
      for (const input of ["Un délai ? Vraiment !", `Oui${NNBSP}?`, "Il a dit : « oui » ;"]) {
        const once = transform(input, { locale: "fr", narrowNbsp: "nbsp" });
        expect(transform(once, { locale: "fr", narrowNbsp: "nbsp" })).toBe(once);
      }
    });

    it("shows why: post-processing the default output is not one", () => {
      // transform(...).replaceAll is stable only as long as it always runs. Feed its output back
      // through the default pipeline and N2 converts the U+00A0 straight back to U+202F.
      const postProcessed = transform("Un délai ?", { locale: "fr" }).replaceAll(NNBSP, NBSP);
      expect(postProcessed).toBe(`Un délai${NBSP}?`);
      expect(transform(postProcessed, { locale: "fr" })).toBe(`Un délai${NNBSP}?`);
    });
  });

  describe("validation (ARCHITECTURE.md §4.6, nbsp.md §3.1a)", () => {
    it("raises POLYTYPO_INVALID_OPTION for an unknown value", () => {
      try {
        transform("x", { locale: "fr", narrowNbsp: "wide" as never });
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(PolytypoError);
        expect((error as PolytypoError).code).toBe("POLYTYPO_INVALID_OPTION");
      }
    });

    it("is checked after mode and before rules and locale", () => {
      const codeOf = (options: unknown): string => {
        try {
          transform("x", options as never);
          return "NO THROW";
        } catch (error) {
          return (error as PolytypoError).code;
        }
      };
      expect(codeOf({ locale: "fr", mode: "asciidoc", narrowNbsp: "wide" })).toBe(
        "POLYTYPO_INVALID_MODE",
      );
      expect(codeOf({ locale: "fr", narrowNbsp: "wide", rules: { nope: true } })).toBe(
        "POLYTYPO_INVALID_OPTION",
      );
      expect(codeOf({ locale: "xx", narrowNbsp: "wide" })).toBe("POLYTYPO_INVALID_OPTION");
    });

    it("raises even when nbsp is disabled, because the check belongs to the call", () => {
      try {
        transform("x", { locale: "fr", narrowNbsp: "wide" as never, rules: { nbsp: false } });
        expect.unreachable();
      } catch (error) {
        expect((error as PolytypoError).code).toBe("POLYTYPO_INVALID_OPTION");
      }
    });

    it("accepts the explicit default", () => {
      expect(transform("Un délai ?", { locale: "fr", narrowNbsp: "narrow" })).toBe(
        `Un délai${NNBSP}?`,
      );
    });
  });

  it("reaches the subpath entries too", () => {
    expect(transformText("Un délai ?", { locale: "fr", narrowNbsp: "nbsp" })).toBe(
      `Un délai${NBSP}?`,
    );
  });

  it("applies in html and markdown mode", () => {
    expect(transform("<p>Un délai ?</p>", { locale: "fr", mode: "html", narrowNbsp: "nbsp" })).toBe(
      `<p>Un délai${NBSP}?</p>`,
    );
    expect(
      transform("Un délai ?\n", {
        locale: "fr",
        mode: "markdown",
        dialect: "commonmark",
        narrowNbsp: "nbsp",
      }),
    ).toBe(`Un délai${NBSP}?\n`);
  });
});
