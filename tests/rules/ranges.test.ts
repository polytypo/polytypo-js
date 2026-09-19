import { describe, it, expect } from "vitest";
import { transform } from "../../src/index";
import { LOCALES } from "../../src/generated/locales";
import { fromCodePoints, toCodePoints } from "../../src/engine/codepoints";
import { applyEdits } from "../../src/engine/edits";
import { rangesRule } from "../../src/rules/ranges";
import { dashesRule } from "../../src/rules/dashes";
import type { LocaleData } from "../../src/types";

const WJ = "⁠"; // ranges.md §3.3.1 word joiner, emitted around a tight range dash
const EN = "–";
const EM = "—";

function localeOf(tag: string): LocaleData {
  const data = LOCALES[tag];
  if (data === undefined) throw new Error(`missing locale ${tag}`);
  return data;
}

/** The rule is exercised directly rather than through `transform`, mirroring dashes.test.ts. */
function run(input: string, locale: LocaleData): string {
  const cp = toCodePoints(input);
  const edits = rangesRule.apply({ cp, locale, mode: "text" });
  return fromCodePoints(applyEdits(cp, edits, "ranges"));
}

const enUS = localeOf("en-US"); // range en-tight
const deDE = localeOf("de-DE"); // range en-tight
const ru = localeOf("ru"); // range em-tight
const fr = localeOf("fr"); // range none

describe("ranges — option resolution: absent, false and true", () => {
  it("absent `rules` leaves ranges off (spec 0.5.0 default)", () => {
    expect(transform("5-10", { locale: "en-US" })).toBe("5-10");
    expect(transform("Figure 5-10", { locale: "en-US" })).toBe("Figure 5-10");
    expect(transform("7-11", { locale: "en-US" })).toBe("7-11");
    expect(transform("9-11", { locale: "en-US" })).toBe("9-11");
  });

  it("explicit `ranges: false` leaves ranges off, same as absent", () => {
    expect(transform("5-10", { locale: "en-US", rules: { ranges: false } })).toBe("5-10");
    expect(transform("5-10", { locale: "en-US", rules: { ranges: false } })).toBe(
      transform("5-10", { locale: "en-US" }),
    );
  });

  it("explicit `ranges: true` turns the rule on", () => {
    expect(transform("5-10", { locale: "en-US", rules: { ranges: true } })).toBe(
      `5${WJ}${EN}${WJ}10`,
    );
  });

  it("explicit `true` on a default-on rule remains a no-op (unchanged since spec 0.4.1)", () => {
    expect(transform("word - word", { locale: "en-US", rules: { spaces: true } })).toBe(
      transform("word - word", { locale: "en-US" }),
    );
  });

  it("enabling ranges does not change any other rule's default", () => {
    const withRanges = transform("Don't -- 5-10", {
      locale: "en-US",
      rules: { ranges: true },
    });
    expect(withRanges).toBe(`Don’t${EM}5${WJ}${EN}${WJ}10`);
  });
});

describe("ranges — safe default: bare numeric forms and compound labels are all no-ops", () => {
  it("bare numeric forms are untouched with default options, in every locale", () => {
    for (const tag of Object.keys(LOCALES)) {
      for (const input of ["5-10", "7-11", "9-11", "0-60", "€30-80", "4-8×"]) {
        expect(transform(input, { locale: tag })).toBe(input);
      }
    }
  });

  it("compound labels are untouched with default options, in every locale", () => {
    for (const tag of Object.keys(LOCALES)) {
      for (const input of ["Figure 5-10", "Figure 3-7", "Table 3-12", "Section 2-14"]) {
        expect(transform(input, { locale: tag })).toBe(input);
      }
    }
  });

  it("`dashes` alone never touches a digit-flanked token, regardless of `ranges`", () => {
    for (const tag of Object.keys(LOCALES)) {
      const locale = localeOf(tag);
      for (const input of ["5-10", "Figure 5-10", "7-11", "9-11"]) {
        const cp = toCodePoints(input);
        expect(dashesRule.apply({ cp, locale, mode: "text" })).toEqual([]);
      }
    }
  });
});

describe("ranges — explicit opt-in: genuine ranges convert", () => {
  it("en-US: numeric ranges become en dashes, bound and joined", () => {
    expect(run("1914-1918 and pp. 34-36", enUS)).toBe(
      `1914${WJ}${EN}${WJ}1918 and pp. 34${WJ}${EN}${WJ}36`,
    );
  });

  it("de-DE: a page range", () => {
    expect(run("Seiten 34-36", deDE)).toBe(`Seiten 34${WJ}${EN}${WJ}36`);
  });

  it("ru: an em dash for ranges (spec's own cited convention)", () => {
    expect(ru.dash.range).toBe("em-tight");
    expect(run("Годы 1914-1918 были тяжёлыми", ru)).toBe(
      `Годы 1914${WJ}${EM}${WJ}1918 были тяжёлыми`,
    );
  });

  it("fr: `dash.range: none` still substitutes nothing, even when explicitly enabled", () => {
    expect(fr.dash.range).toBe("none");
    expect(run("p. 123-125", fr)).toBe("p. 123-125");
    expect(run("Les années 1914-1918", fr)).toBe("Les années 1914-1918");
  });

  it("an increasing score converts (dashes.md §7.4's unresolved miss, still true under ranges)", () => {
    expect(run("Final score 0-5", enUS)).toBe(`Final score 0${WJ}${EN}${WJ}5`);
  });

  it("DOCUMENTED LIMITATION (not portable conformance evidence): a compound label converts identically to a genuine range when `ranges` is explicitly enabled", () => {
    // This test characterizes a known, accepted semantic limitation of an aggressive opt-in
    // rule — it does NOT assert that the output below is the correct interpretation of the
    // input. `Figure 5-10` means "chapter 5, figure 10" (a compound label), not a range, and
    // `ranges` converts it exactly as it would a genuine range because the two are structurally
    // identical (digit-hyphen-digit) and separating them needs the preceding word, which this
    // portable, structural rule deliberately does not consult (ranges.md §1, §5). Canonical
    // conformance fixtures (spec/fixtures/*.json) never assert this converted form as a
    // successful expected output, under any option set — only this implementation-level test
    // does, specifically to pin the boundary of the documented tradeoff. `Figure 3-7` converts
    // too (ranges.md §5's "pre-existing exposure" — it was never gated even by the old
    // combined-rule design pre-0.5.0).
    expect(run("Figure 5-10", enUS)).toBe(`Figure 5${WJ}${EN}${WJ}10`);
    expect(run("Figure 3-7", enUS)).toBe(`Figure 3${WJ}${EN}${WJ}7`);
    expect(run("Table 3-12", deDE)).toBe(`Table 3${WJ}${EN}${WJ}12`);
  });
});

describe("ranges — G4 run lengths, spec ranges.md §3.2 (cases 3a-3j)", () => {
  it("3a. `Takes 5-10 days` converts", () => {
    expect(run("Takes 5-10 days", enUS)).toBe(`Takes 5${WJ}${EN}${WJ}10 days`);
  });

  it("3b. `aged 9-10 years` converts — the largest 1-digit against the smallest 2-digit", () => {
    expect(run("aged 9-10 years", enUS)).toBe(`aged 9${WJ}${EN}${WJ}10 years`);
  });

  it("3c. `chapters 1-12` converts", () => {
    expect(run("chapters 1-12", enUS)).toBe(`chapters 1${WJ}${EN}${WJ}12`);
  });

  it("3d. `0-60 in six seconds` converts — the leading-zero clause constrains Rrun only", () => {
    expect(run("0-60 in six seconds", enUS)).toBe(`0${WJ}${EN}${WJ}60 in six seconds`);
  });

  it("the (1,2) branch never reaches G5's equal-length comparison", () => {
    for (let l = 0; l <= 9; l += 1) {
      for (let r = 10; r <= 99; r += 1) {
        const input = `x ${l}-${r} y`;
        expect(run(input, enUS)).toBe(`x ${l}${WJ}${EN}${WJ}${r} y`);
      }
    }
  });

  it("3e. `won 10-7` does not convert — the new branch is directional", () => {
    expect(run("won 10-7", enUS)).toBe("won 10-7");
  });

  it("3f. `code 9-05` does not convert — the leading zero is load-bearing", () => {
    expect(run("code 9-05", enUS)).toBe("code 9-05");
    for (let l = 0; l <= 9; l += 1) {
      for (let r = 0; r <= 9; r += 1) {
        const input = `x ${l}-0${r} y`;
        expect(run(input, enUS)).toBe(input);
      }
    }
  });

  it("3g. `Call 555-1234` does not convert", () => {
    expect(run("Call 555-1234", enUS)).toBe("Call 555-1234");
  });

  it("3h. `Call 1-800 now` does not convert — Rrun must be exactly 2 digits", () => {
    expect(run("Call 1-800 now", enUS)).toBe("Call 1-800 now");
  });

  it("3i. `the 2020-24 season` does not convert — still a recorded miss (dashes.md §7.3)", () => {
    expect(run("the 2020-24 season", enUS)).toBe("the 2020-24 season");
  });

  it("the equal-length branch and G5 are unchanged", () => {
    expect(run("1914-1918", enUS)).toBe(`1914${WJ}${EN}${WJ}1918`);
    expect(run("1234-5678", enUS)).toBe(`1234${WJ}${EN}${WJ}5678`);
    expect(run("20-10", enUS)).toBe("20-10");
    expect(run("5-0", enUS)).toBe("5-0");
    expect(run("99-99", enUS)).toBe(`99${WJ}${EN}${WJ}99`);
  });

  it("the widening holds end to end through `transform`, with explicit opt-in", () => {
    for (const tag of Object.keys(LOCALES)) {
      const dash = localeOf(tag).dash.range;
      const opts = { locale: tag, rules: { ranges: true } } as const;
      if (dash === "none") {
        expect(transform("Takes 5-10 days", opts)).toBe("Takes 5-10 days");
        continue;
      }
      const glyph = dash === "em-tight" || dash === "em-spaced" ? EM : EN;
      const bound = dash === "em-spaced" || dash === "en-spaced" ? glyph : `${WJ}${glyph}${WJ}`;
      const once = transform("Takes 5-10 days", opts);
      expect(once).toBe(`Takes 5${bound}10 days`);
      expect(transform(once, opts)).toBe(once);
      for (const input of ["won 10-7", "code 9-05", "Call 555-1234", "Call 1-800 now"]) {
        const out = transform(input, opts);
        expect(out).toBe(input);
        expect(transform(out, opts)).toBe(out);
      }
    }
  });
});

describe("ranges — binding a tight range (ranges.md §3.3.1, spec cases 43-44)", () => {
  it("43. an authored range converts and binds exactly when the edit is not invisible-only", () => {
    expect(run(`1914${EN}1918`, enUS)).toBe(`1914${EN}1918`); // en-tight, already correct
    expect(run(`1914${EN}1918`, ru)).toBe(`1914${WJ}${EM}${WJ}1918`); // em-tight: length differs
    expect(run(`1941${EM}1945`, deDE)).toBe(`1941${WJ}${EN}${WJ}1945`); // en-tight: length differs
    expect(run(`1941${EM}1945`, ru)).toBe(`1941${EM}1945`); // em-tight, already correct
  });

  it("44. the hyphen-typed range still converts and still binds", () => {
    expect(run("1914-1918", enUS)).toBe(`1914${WJ}${EN}${WJ}1918`);
    expect(run("Годы 1941-1945", ru)).toBe(`Годы 1941${WJ}${EM}${WJ}1945`);
    expect(run(`1914${EN}1918`, enUS)).toBe(`1914${EN}1918`);
  });
});

describe("ranges — joiner transparency, spec cases 45-47 (ranges.md §3.1, dashes.md §3.2b)", () => {
  it("45./47. an emitted joiner is transparent to a neighbouring token's G2", () => {
    for (const tag of Object.keys(LOCALES)) {
      const style = localeOf(tag).dash.range;
      if (style === "none") continue;
      const glyph = style === "em-tight" || style === "em-spaced" ? EM : EN;
      const once = run("1-1 - 1", localeOf(tag));
      expect(once).toBe(`1${WJ}${glyph}${WJ}1 - 1`);
      expect(run(once, localeOf(tag))).toBe(once);
      expect(run(run(once, localeOf(tag)), localeOf(tag))).toBe(once);
    }
  });

  it("46. the control: the first token is a fixed point only where its length already matches", () => {
    for (const tag of Object.keys(LOCALES)) {
      const range = localeOf(tag).dash.range;
      const target = range === "em-tight" || range === "em-spaced" ? EM : EN;
      const bound = `1${WJ}${target}${WJ}1 - 1`;

      expect(run(`1${EN}1 - 1`, localeOf(tag)), `${tag} EN`).toBe(
        range === "none" || target === EN ? `1${EN}1 - 1` : bound,
      );
      expect(run(`1${EM}1 - 1`, localeOf(tag)), `${tag} EM`).toBe(
        range === "none" || target === EM ? `1${EM}1 - 1` : bound,
      );
    }
  });

  it("the joiner is transparent to G1 and G3 too, not only G2", () => {
    expect(run(`MP3${WJ}-4`, enUS)).toBe(`MP3${WJ}-4`);
    expect(run(`1.5${WJ}-2.5`, enUS)).toBe(`1.5${WJ}-2.5`);
    expect(run(`1${WJ}/2-3${WJ}/4`, enUS)).toBe(`1${WJ}/2-3${WJ}/4`);
  });

  it("T1 does not fire when there is no far dash", () => {
    expect(run("Seiten 34-36", deDE)).toBe(`Seiten 34${WJ}${EN}${WJ}36`);
    expect(run(`${EM} 1914-1918 годы`, ru)).toBe(`${EM} 1914${WJ}${EM}${WJ}1918 годы`);
  });
});

describe("ranges — cluster guard, spec/rules/dashes.md §3.2 step 7", () => {
  it("a cluster with one dash run is still editable", () => {
    expect(run("pp. 34-36", enUS)).toBe(`pp. 34${WJ}${EN}${WJ}36`);
  });

  it("a space ends a cluster", () => {
    expect(run("1914-1918 and 34-36", enUS)).toBe(
      `1914${WJ}${EN}${WJ}1918 and 34${WJ}${EN}${WJ}36`,
    );
  });

  it("a cluster with two or more dash runs is inert to both dashes and ranges", () => {
    for (const input of ["a-5-10", "known-5-10-b", "2026-08-15"]) {
      expect(run(input, enUS)).toBe(input);
      const cp = toCodePoints(input);
      expect(dashesRule.apply({ cp, locale: enUS, mode: "text" })).toEqual([]);
    }
  });
});

describe("ranges — order: ranges runs before dashes (registry.ts §note, ranges.md §4)", () => {
  it("a parenthetical dash directly touching a range converts both, matching the pre-0.5.0 unified rule", () => {
    // ranges.md §4's worked example: dashes-before-ranges would decline the range here, because
    // dashes' own edit removes the space that separates the parenthetical dash from the range's
    // digit run, making ranges' G2 ("no chain") guard see a fresh, order-induced adjacency.
    expect(transform("a - 5-10", { locale: "en-US", rules: { ranges: true } })).toBe(
      `a${EM}5${WJ}${EN}${WJ}10`,
    );
    expect(transform("5-10 - a", { locale: "en-US", rules: { ranges: true } })).toBe(
      `5${WJ}${EN}${WJ}10${EM}a`,
    );
  });

  it("the combined result is idempotent", () => {
    for (const input of ["a - 5-10", "5-10 - a"]) {
      const once = transform(input, { locale: "en-US", rules: { ranges: true } });
      const twice = transform(once, { locale: "en-US", rules: { ranges: true } });
      expect(twice).toBe(once);
    }
  });
});

describe("ranges — closed-up symbols on both members (ranges.md §3.2a, spec 1.3.0)", () => {
  it("admits a repeated currency prefix", () => {
    expect(run("$15-$20", enUS)).toBe(`$15${WJ}${EN}${WJ}$20`);
    expect(run("€15-€20", deDE)).toBe(`€15${WJ}${EN}${WJ}€20`);
  });

  it("admits a repeated suffix — the mirror case, walking the left flank", () => {
    expect(run("35%-50%", enUS)).toBe(`35%${WJ}${EN}${WJ}50%`);
    expect(run("35%-50%", ru)).toBe(`35%${WJ}${EM}${WJ}50%`);
    expect(run("15°-20°", enUS)).toBe(`15°${WJ}${EN}${WJ}20°`);
  });

  it("requires the same code point on both members", () => {
    // A currency conversion, not a range. Declining it is the point: the symbols differ.
    expect(run("$15-€20", enUS)).toBe("$15-€20");
    expect(run("15-$20", enUS)).toBe("15-$20");
    expect(run("15%-20", enUS)).toBe("15%-20");
  });

  it("leaves the elided forms exactly as they were before §3.2a", () => {
    expect(run("$15-20", enUS)).toBe(`$15${WJ}${EN}${WJ}20`);
    expect(run("15-20%", enUS)).toBe(`15${WJ}${EN}${WJ}20%`);
  });

  it("consumes at most one code point per side", () => {
    // `US$` is three; G1 also declines it, since `before` reads past the matched $ and finds S.
    expect(run("US$15-US$20", enUS)).toBe("US$15-US$20");
    expect(run("15°C-20°C", enUS)).toBe("15°C-20°C");
  });

  it("still applies G1-G5 over the digit runs, which the symbols do not change", () => {
    expect(run("$8859-$1", enUS)).toBe("$8859-$1"); // G4 (4,1)
    expect(run("$20-$10", enUS)).toBe("$20-$10"); // G5 decreasing
    expect(run("$15-$20-$25", enUS)).toBe("$15-$20-$25"); // G2 chain
  });

  it("emits nothing in a locale whose range form is none", () => {
    expect(run("$15-$20", fr)).toBe("$15-$20");
  });

  it("is idempotent, including the re-entry across its own joiners", () => {
    for (const input of ["$15-$20", "35%-50%", "$15 - $20", `$15${WJ}${EN}${WJ}$20`]) {
      const once = run(input, enUS);
      expect(run(once, enUS)).toBe(once);
    }
  });

  it("takes the spaced token away from dashes — ranges.md §3.2a's accepted cost", () => {
    // Through spec 1.2.0 `dashes` converted this with DEFAULT options, because the right flank
    // was a symbol and not a digit. It is a range candidate now, so `dashes` declines it
    // unconditionally and nothing touches it unless the caller enables `ranges`.
    const cp = toCodePoints("$15 - $20");
    expect(dashesRule.apply({ cp, locale: enUS, mode: "text" })).toEqual([]);
    expect(transform("$15 - $20", { locale: "en-US" })).toBe("$15 - $20");
    expect(transform("$15 - $20", { locale: "en-US", rules: { ranges: true } })).toBe(
      `$15${WJ}${EN}${WJ}$20`,
    );
  });

  it("leaves an unmatched pair with dashes, which still converts it by default", () => {
    // The other half of the cost: only a *matched* symbol moves a token between rules.
    expect(transform("$15 - €20", { locale: "en-US" })).toBe("$15—€20");
  });
});

describe("closed-up symbols and T1 (dashes.md §3.2 step 8, spec 1.3.0)", () => {
  // Widening what counts as a range member widens what a `dashes` edit elsewhere can disturb.
  // Each of these produced a transform idempotency defect before T1 was amended:
  // pass 1 let `dashes` convert its own token, that edit replaced the range's `before`/`after`
  // with a U+0020, and the range converted on pass 2. All three are inert in the all-digit
  // shape, which is what the guards are supposed to guarantee.
  const witnesses = ["a—$15-$20", "35%-50%—b", "a--15% - 20%", "$1 - $1--a"];

  for (const locale of ["de-DE", "ru", "en-GB", "fi"] as const) {
    it(`is a fixed point on every witness in ${locale}`, () => {
      for (const input of witnesses) {
        const once = transform(input, { locale, rules: { ranges: true } });
        expect(transform(once, { locale, rules: { ranges: true } })).toBe(once);
      }
    });
  }

  it("composes both transparency positions on one side", () => {
    // p1 (between the token and the run) and p2 (at the far end of the run) at once. The
    // exhaustive sweep could not reach this shape — it needs about eleven tokens.
    for (const locale of ["de-DE", "ru"] as const) {
      for (const input of ["a--$15% - $20%", "$15% - $20%--a", "a--$15% - $20%--b"]) {
        const once = transform(input, { locale, rules: { ranges: true } });
        expect(transform(once, { locale, rules: { ranges: true } })).toBe(once);
      }
    }
  });

  it("leaves a tight-parenthetical locale untouched — the boundary of the cost", () => {
    // T1 only applies when the chosen form is spaced, which is why the repair is T1 and not the
    // cluster guard: that one is unconditional and would have taken en-US with it.
    expect(transform("price--$50--drop", { locale: "en-US" })).toBe("price—$50—drop");
    expect(transform("Anstieg--50%--war", { locale: "de-DE" })).toBe("Anstieg--50%--war");
    expect(transform("Anstieg--50--war", { locale: "de-DE" })).toBe("Anstieg--50--war");
  });

  it("makes the symbol shape behave exactly like its all-digit analogue", () => {
    const opts = { locale: "de-DE", rules: { ranges: true } } as const;
    expect(transform("a—15-20", opts)).toBe("a—15-20");
    expect(transform("a—$15-$20", opts)).toBe("a—$15-$20");
    expect(transform("a--1 - 1", opts)).toBe("a--1 - 1");
    expect(transform("a--$1 - $1", opts)).toBe("a--$1 - $1");
  });

  it("converts a hyphen an author typed between an existing joiner pair", () => {
    // The only input that separates dashes.md §3.2a's amended re-entry condition from the
    // unamended one: with a symbol on the flank the old condition fell through to
    // "joiner crossed in any other configuration: emit nothing".
    expect(transform(`$15${WJ}-${WJ}$20`, { locale: "en-US", rules: { ranges: true } })).toBe(
      `$15${WJ}${EN}${WJ}$20`,
    );
  });

  it("decides both flanks from the original indices, simultaneously", () => {
    // Both flanks in CLOSED-SYMBOL is the shape that makes evaluation order observable: a
    // left-then-right or right-then-left reading leaves one side's digit run undefined.
    expect(run("%15%-%20%", enUS)).toBe(`%15%${WJ}${EN}${WJ}%20%`);
  });

  it("admits a block member no other test names, and refuses a currency sign outside the set", () => {
    // CLOSED-SYMBOL is the whole U+20A0-U+20CF block by its bounds, so a port that enumerates
    // only the symbols it saw in tests fails the first line; U+058F and U+FFE5 are currency
    // signs in Unicode's own classification and deliberately outside the set, so a port using an
    // Sc category test — the implementation ranges.md §3.2a forbids — fails the second.
    expect(run("₹15-₹20", enUS)).toBe(`₹15${WJ}${EN}${WJ}₹20`);
    expect(run("₴100-₴200", enUS)).toBe(`₴100${WJ}${EN}${WJ}₴200`);
    expect(run("֏15-֏20", enUS)).toBe("֏15-֏20");
    expect(run("￥15-￥20", enUS)).toBe("￥15-￥20");
  });

  it("reads effective neighbours in T1's right branch, symbol or no symbol", () => {
    // dashes.md §3.2 step 8 disagreed with §3.2b in its own text through spec 1.2.0; the
    // implementation never did. The space ends the cluster, so step 7 does not cover this.
    expect(transform("a--15⁠ - 20", { locale: "de-DE", rules: { ranges: true } })).toBe(
      "a--15⁠ - 20",
    );
  });

  it("pins every member of CLOSED-SYMBOL, since it is an enumeration and not a category", () => {
    const pairs: Array<[string, string]> = [
      ["¢", "¢"],
      ["£", "£"],
      ["¤", "¤"],
      ["¥", "¥"],
      ["€", "€"],
      ["$", "$"],
    ];
    for (const [symbol] of pairs) {
      expect(run(`${symbol}15-${symbol}20`, enUS)).toBe(`${symbol}15${WJ}${EN}${WJ}${symbol}20`);
    }
    for (const suffix of ["%", "‰", "‱", "°"]) {
      expect(run(`15${suffix}-20${suffix}`, enUS)).toBe(`15${suffix}${WJ}${EN}${WJ}20${suffix}`);
    }
  });
});
