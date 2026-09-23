import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { LOCALES } from "../../src/generated/locales";
import { PolytypoError, transform } from "../../src/index";
import { RULE_ORDER } from "../../src/rules/registry";
import type { Dialect, Mode, Options, RuleId } from "../../src/types";

const locales = Object.keys(LOCALES);
const hasLocales = locales.length > 0;

/** `markdown` has no default dialect (modes.md 3.7.1), so both are swept. */
const CONFIGS: ReadonlyArray<{ label: string; mode: Mode; dialect?: Dialect }> = [
  { label: "html", mode: "html" },
  { label: "markdown/commonmark", mode: "markdown", dialect: "commonmark" },
  { label: "markdown/mdx", mode: "markdown", dialect: "mdx" },
];

/**
 * spec/rules/modes.md 5 extends the sweep obligation of `pipeline-idempotency.md` 6: the strings
 * must contain **span boundaries**, because the obligation modes add — that the span partition is
 * stable between runs — is invisible to a sweep that only ever produces one span.
 *
 * The alphabet is the spec's: the characters the rules consume *and* the ones they emit, since
 * idempotency is a statement about re-processing output.
 */
// `s` and `l` are here for quotes.md 3.2's span-boundary elision veto (spec 1.4.0), under
// pipeline-idempotency.md 6's standing obligation: a defect whose witness the committed bound
// cannot reach means the bound is wrong, and the alphabet is widened in the same change that
// fixes the defect. They are the two shipped fragments a marker-adjacent mark can carry — `s`
// from en-*/nl's `after`, `l` from fr/fr-CA/it's `before` — so without them no sweep can fire
// the veto at all. Measured, and both witnesses are INSIDE this sweep's own budget (MAX_LENGTH
// bounds |A|+|B|+|C|, not the rendered string): `<em>a</em>'s` fires the `after` test in en-*/nl
// and `l'<em>a</em>` the `before` test in fr/fr-CA/it. The widened sweep passes.
//
// Scope, so it is stated rather than assumed: this reaches the fragments `s` and `l` only. The
// other shipped entries — pt-*'s `d n pel m t lh sant`, nl's `t ns k m em r et`, it's `un` and
// `d` — are covered by fixtures, not by this sweep. pipeline-idempotency.md 6's obligation is
// reachability of the FOUND defect's witness, not an exhaustive walk of locale data.
//
// `)` is here for apostrophe.md 3.3's case 2a (spec 1.5.0), under the same standing obligation.
// It is the one CLOSEDELIM member the alphabet did not already contain: `”` was in it as an
// emitted quote glyph and covers the quotation half of the class, so `)'a` and `”'a` between them
// fire both halves. Three characters, so the witness is inside this sweep's own budget.
const SWEEP_ALPHABET = ['"', "'", "-", " ", ".", "1", "a", "s", "l", "«", "–", "”", ")"];
const MAX_LENGTH = 3;

/** `A<em>B</em>C` — the spec's own minimum template, with the alphabet distributed across A, B, C. */
function template(mode: Mode, a: string, b: string, c: string): string {
  return mode === "html" ? `${a}<em>${b}</em>${c}` : `${a}*${b}*${c}`;
}

function optionsFor(locale: string, config: { mode: Mode; dialect?: Dialect }): Options {
  return config.dialect === undefined
    ? { locale, mode: config.mode }
    : { locale, mode: config.mode, dialect: config.dialect };
}

function* alphabetStrings(maxLength: number): Generator<string> {
  let frontier = [""];
  yield "";
  for (let length = 1; length <= maxLength; length += 1) {
    const next: string[] = [];
    for (const prefix of frontier) {
      for (const char of SWEEP_ALPHABET) {
        next.push(prefix + char);
        yield prefix + char;
      }
    }
    frontier = next;
  }
}

/** Every (A, B, C) with |A| + |B| + |C| ≤ MAX_LENGTH, so every boundary position is exercised. */
function* splits(): Generator<[string, string, string]> {
  for (const whole of alphabetStrings(MAX_LENGTH)) {
    for (let i = 0; i <= whole.length; i += 1) {
      for (let j = i; j <= whole.length; j += 1) {
        yield [whole.slice(0, i), whole.slice(i, j), whole.slice(j)];
      }
    }
  }
}

describe.skipIf(!hasLocales)("bounded exhaustive idempotency sweep across span boundaries", () => {
  for (const config of CONFIGS) {
    for (const locale of locales) {
      it(`every ${config.label} document up to ${MAX_LENGTH} swept characters is idempotent in ${locale}`, () => {
        const options = optionsFor(locale, config);
        const broken: string[] = [];
        for (const [a, b, c] of splits()) {
          const input = template(config.mode, a, b, c);
          const once = transform(input, options);
          if (transform(once, options) !== once) {
            broken.push(JSON.stringify(input));
            if (broken.length >= 10) break;
          }
        }
        expect(broken, `first non-idempotent ${config.label} inputs in ${locale}`).toEqual([]);
      });
    }
  }
});

/**
 * `yaml` gets its own alphabet and templates rather than joining CONFIGS: modes.md 5 requires
 * `:`, `#` and `-` in the sweep alphabet for this mode specifically, because those are the
 * characters whose adjacency to an emitted U+0020 the span-stability argument turns on — and
 * putting them in the shared alphabet would grow every other config's sweep for nothing.
 */
const YAML_SWEEP_ALPHABET = ['"', "'", "-", ":", "#", " ", ".", "a", "–", "”"];

/** A block scalar puts a line marker between every pair of spans; a plain scalar exercises the
 * `:`/`#` split, which puts an inline marker between them instead. */
const YAML_TEMPLATES: ReadonlyArray<{
  label: string;
  of: (a: string, b: string, c: string) => string;
}> = [
  { label: "block scalar", of: (a, b, c) => `k: |\n  ${a}\n  ${b}\n  ${c}\n` },
  { label: "plain scalar", of: (a, b, c) => `k: ${a}${b}${c}\n` },
];

function* yamlSplits(): Generator<[string, string, string]> {
  let frontier = [""];
  const all: string[] = [""];
  for (let length = 1; length <= MAX_LENGTH; length += 1) {
    const next: string[] = [];
    for (const prefix of frontier) {
      for (const char of YAML_SWEEP_ALPHABET) {
        next.push(prefix + char);
        all.push(prefix + char);
      }
    }
    frontier = next;
  }
  for (const whole of all) {
    for (let i = 0; i <= whole.length; i += 1) {
      for (let j = i; j <= whole.length; j += 1) {
        yield [whole.slice(0, i), whole.slice(i, j), whole.slice(j)];
      }
    }
  }
}

describe.skipIf(!hasLocales)("bounded exhaustive idempotency sweep, yaml mode", () => {
  for (const tpl of YAML_TEMPLATES) {
    for (const locale of locales) {
      it(`every yaml ${tpl.label} document up to ${MAX_LENGTH} swept characters is idempotent in ${locale}`, () => {
        const options: Options = { locale, mode: "yaml", keys: ["k"] };
        const broken: string[] = [];
        for (const [a, b, c] of yamlSplits()) {
          const input = tpl.of(a, b, c);
          const once = transform(input, options);
          if (transform(once, options) !== once) {
            broken.push(JSON.stringify(input));
            if (broken.length >= 10) break;
          }
        }
        expect(broken, `first non-idempotent yaml ${tpl.label} inputs in ${locale}`).toEqual([]);
      });
    }
  }
});

describe.skipIf(!hasLocales)("idempotency over generated documents", () => {
  const DOCUMENT_PARTS = [
    '<p class="x">',
    "</p>",
    "<em>",
    "</em>",
    "<code>",
    "</code>",
    "&nbsp;",
    "&amp;",
    "<!-- c -->",
    "`code`",
    "```\nf\n```\n",
    "[t](u)",
    "\n\n",
    "\n",
    '"',
    "'",
    "-",
    " ",
    ".",
    "a",
    "1",
    "«",
    "–",
    "”",
    "…",
    "{/* c */}",
    "{x}",
    "<Callout>",
    "</Callout>",
  ];

  /**
   * modes.md 3.7.2: in `mdx` a document that does not parse throws `POLYTYPO_MALFORMED_INPUT`.
   * The full contract is therefore "throws that code, or is idempotent", and asserting both
   * halves keeps the generator honest — an HTML comment or a stray `{` is rejected in `mdx` and
   * is ordinary prose in the other two, so the same parts exercise every configuration.
   */
  const transformOrMalformed = (input: string, options: Options): string | null => {
    try {
      return transform(input, options);
    } catch (error) {
      expect(error).toBeInstanceOf(PolytypoError);
      expect((error as PolytypoError).code, JSON.stringify(input)).toBe("POLYTYPO_MALFORMED_INPUT");
      return null;
    }
  };

  for (const config of CONFIGS) {
    it(`holds over generated ${config.label} documents, in every locale`, () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...locales),
          fc.array(fc.constantFrom(...DOCUMENT_PARTS), { maxLength: 12 }),
          (locale, parts) => {
            const input = parts.join("");
            const options = optionsFor(locale, config);
            const once = transformOrMalformed(input, options);
            if (once === null) return;
            expect(
              transformOrMalformed(once, options),
              `not idempotent in ${config.label}/${locale} for ${JSON.stringify(input)}`,
            ).toBe(once);
          },
        ),
        { numRuns: 4_000 },
      );
    });
  }
});

/**
 * modes.md 4 as a mechanical check rather than a prose claim: with no rule enabled there is no
 * edit, so *every* byte of *every* document must come back untouched, however malformed.
 */
describe.skipIf(!hasLocales)("the round-trip prohibition (modes.md 4)", () => {
  const allRulesOff = Object.fromEntries(RULE_ORDER.map((id) => [id, false])) as Record<
    RuleId,
    boolean
  >;

  // `html` and `commonmark` are total functions of their input, so arbitrary bytes are fair
  // game. `mdx` is not (modes.md 3.7.2), so it is exercised over the same document parts as the
  // property above, where a rejection is asserted to carry the contractual code.
  for (const config of CONFIGS.filter((c) => c.label !== "markdown/mdx")) {
    it(`with every rule disabled, ${config.label} output is byte-identical to input`, () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...locales),
          fc.string({ unit: "binary", maxLength: 200 }),
          (locale, input) => {
            expect(transform(input, { ...optionsFor(locale, config), rules: allRulesOff })).toBe(
              input,
            );
          },
        ),
        { numRuns: 1_000 },
      );
    });
  }

  it("with every rule disabled, markdown/mdx output is byte-identical to input", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...locales),
        fc.string({ unit: "binary", maxLength: 200 }),
        (locale, input) => {
          const options = { locale, mode: "markdown", dialect: "mdx", rules: allRulesOff } as const;
          try {
            expect(transform(input, options)).toBe(input);
          } catch (error) {
            expect(error).toBeInstanceOf(PolytypoError);
            expect((error as PolytypoError).code).toBe("POLYTYPO_MALFORMED_INPUT");
          }
        },
      ),
      { numRuns: 1_000 },
    );
  });
});
