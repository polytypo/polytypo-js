import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyze, transform, PolytypoError } from "../../src/index";
import { toCodePoints } from "../../src/engine/codepoints";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FIXTURES = path.join(ROOT, "spec/fixtures");

/** spec/rules/analyze.md — the contract is A1…A5; the decomposition is observation. */
describe("analyze (analyze.md)", () => {
  describe("A1 — accepts and rejects exactly what transform does", () => {
    it("throws POLYTYPO_UNKNOWN_LOCALE for an unknown locale", () => {
      expect(() => analyze("x", { locale: "xx" })).toThrow(PolytypoError);
    });

    it("throws POLYTYPO_UNKNOWN_RULE before it throws about the locale", () => {
      try {
        analyze("x", { locale: "xx", rules: { nope: true } as never });
        expect.unreachable();
      } catch (error) {
        expect((error as PolytypoError).code).toBe("POLYTYPO_UNKNOWN_RULE");
      }
    });

    it("throws POLYTYPO_INVALID_MODE for an unknown mode", () => {
      expect(() => analyze("x", { locale: "en-US", mode: "yaml" as never })).toThrow(PolytypoError);
    });

    it("requires a dialect in markdown mode, as transform does", () => {
      try {
        analyze("x", { locale: "en-US", mode: "markdown" });
        expect.unreachable();
      } catch (error) {
        expect((error as PolytypoError).code).toBe("POLYTYPO_INVALID_DIALECT");
      }
    });
  });

  describe("A2 — pure", () => {
    it("returns the same list for the same arguments", () => {
      const once = analyze(`She said "hi" -- really...`, { locale: "en-US" });
      const twice = analyze(`She said "hi" -- really...`, { locale: "en-US" });
      expect(twice).toEqual(once);
    });

    it("does not change what transform returns", () => {
      const input = `She said "hi" -- really...`;
      const before = transform(input, { locale: "en-US" });
      analyze(input, { locale: "en-US" });
      expect(transform(input, { locale: "en-US" })).toBe(before);
    });
  });

  describe("A3 — empty exactly when transform changes nothing", () => {
    it("is empty for text that needs nothing", () => {
      expect(analyze("Nothing to do here.", { locale: "en-US" })).toEqual([]);
    });

    it("is non-empty for text that needs something", () => {
      expect(analyze("Wait...", { locale: "en-US" }).length).toBeGreaterThan(0);
    });

    // analyze.md §6: the whole canonical corpus, which is the cheap strong version of A3.
    it("agrees with transform on every canonical fixture", () => {
      const offenders: string[] = [];
      for (const file of readdirSync(FIXTURES).filter((f) => f.endsWith(".json"))) {
        const data = JSON.parse(readFileSync(path.join(FIXTURES, file), "utf8")) as {
          locale?: string;
          cases?: Array<Record<string, unknown>>;
        };
        if (data.locale === undefined || data.cases === undefined) continue;
        for (const testCase of data.cases) {
          if (testCase.throws !== undefined) continue;
          if (testCase.dialect === "mdx") continue;
          const options = {
            locale: data.locale,
            ...(testCase.mode !== undefined ? { mode: testCase.mode } : {}),
            ...(testCase.dialect !== undefined ? { dialect: testCase.dialect } : {}),
            ...(testCase.rules !== undefined ? { rules: testCase.rules } : {}),
          } as never;
          const input = testCase.in as string;
          const changed = transform(input, options) !== input;
          const reported = analyze(input, options).length > 0;
          if (changed !== reported) offenders.push(`${data.locale}/${testCase.id as string}`);
        }
      }
      expect(offenders).toEqual([]);
    });
  });

  describe("A4 — only rules that were enabled for the call", () => {
    it("never reports a rule the caller disabled", () => {
      const input = `She said "hi"...`;
      const ids = analyze(input, { locale: "en-US", rules: { quotes: false } }).map(
        (c) => c.ruleId,
      );
      expect(ids).not.toContain("quotes");
      expect(ids).toContain("ellipsis");
    });

    it("never reports ranges unless it was turned on", () => {
      const input = "chapters 3-5";
      expect(analyze(input, { locale: "en-US" }).map((c) => c.ruleId)).not.toContain("ranges");
      expect(
        analyze(input, { locale: "en-US", rules: { ranges: true } }).map((c) => c.ruleId),
      ).toContain("ranges");
    });
  });

  describe("A5 — offsets are code points inside the input", () => {
    it("stays within bounds on a string with astral characters", () => {
      const input = `A 😀 says "hi" and waits...`;
      const length = toCodePoints(input).length;
      for (const change of analyze(input, { locale: "en-US" })) {
        expect(change.start).toBeGreaterThanOrEqual(0);
        expect(change.end).toBeLessThanOrEqual(length);
        expect(change.start).toBeLessThanOrEqual(change.end);
      }
    });

    it("reports code-point offsets, not UTF-16 offsets", () => {
      // The emoji is two UTF-16 units and one code point, so the opening quote sits at code
      // point 6 and at UTF-16 index 7. A runtime reporting native string offsets says 7.
      const input = `😀 and "this"`;
      const [change] = analyze(input, { locale: "en-US" });
      expect(change?.ruleId).toBe("quotes");
      expect(change?.start).toBe(6);
      expect(input.indexOf(`"`)).toBe(7);
    });

    // analyze.md §6: the mistake that passes every text-mode test.
    it("reports document offsets in html mode, not span-local ones", () => {
      const input = `<p class="x">Wait...</p>`;
      const [change] = analyze(input, { locale: "en-US", mode: "html" });
      expect(change?.ruleId).toBe("ellipsis");
      expect(change?.start).toBe(input.indexOf("..."));
      expect(change?.before).toBe("...");
      expect(change?.after).toBe("…");
    });

    it("reports document offsets in markdown mode too", () => {
      const input = `# Title\n\nWait... here\n`;
      const [change] = analyze(input, { locale: "en-US", mode: "markdown", dialect: "commonmark" });
      expect(change?.start).toBe(input.indexOf("..."));
    });
  });

  describe("§3 — pipeline order, and §5 — overlap", () => {
    it("reports rules in spec order", () => {
      const input = `She said "hi" -- wait...`;
      const ids = analyze(input, { locale: "en-US" }).map((c) => c.ruleId);
      expect(ids).toEqual([...ids].sort((a, b) => order(a) - order(b)));
    });

    // The French case analyze.md §5 is written around: two rules, one original index.
    it("reports both rules when they touch the same original range", () => {
      const changes = analyze("Oui : non", { locale: "fr" });
      expect(changes.map((c) => c.ruleId)).toEqual(["spaces", "nbsp"]);
      expect(changes[0]?.before).toBe(" ");
      expect(changes[0]?.after).toBe("");
      expect(changes[1]?.after).toBe(" ");
      // analyze.md §5's own table: `spaces` removes the space at 3–4 and `nbsp` inserts at
      // 4–4, in front of the colon the caller wrote at 4. Two changes, one visible edit, and
      // the second one's position is the colon's, not the deleted space's.
      expect([changes[0]?.start, changes[0]?.end]).toEqual([3, 4]);
      expect([changes[1]?.start, changes[1]?.end]).toEqual([4, 4]);
    });
  });
});

const ORDER = [
  "spaces",
  "ellipsis",
  "ranges",
  "dashes",
  "hyphen",
  "quotes",
  "apostrophe",
  "symbols",
  "nbsp",
];
function order(id: string): number {
  return ORDER.indexOf(id);
}
