import * as YAML from "yaml";
import { describe, expect, it } from "vitest";
import { LOCALES } from "../../src/generated/locales";
import { transform } from "../../src/index";

/**
 * The differential guard behind spec/rules/modes.md 3.8.6, kept as a test rather than left as a
 * one-off measurement. **`yaml` mode must never change what a document means** — only how its
 * prose reads — and the reported bug that motivated the mode (modes.md 3.8.1) was precisely a
 * document that stayed syntactically valid and became semantically wrong.
 *
 * `yaml` is a **devDependency only**. It is the reference oracle here and is never imported by
 * `src/` — scripts/lib/entry-reach.mjs forbids it in every published entry, so the "no parser"
 * claim of 3.8.1 is enforced against the real module graph rather than asserted.
 */

const locales = Object.keys(LOCALES);

/** Every key these documents use, so the guard measures the mode at its widest, not at its safest. */
const KEYS = [
  "summary",
  "description",
  "k",
  "z",
  "a",
  "b",
  "c",
  "d",
  "e",
  "base",
  "n",
  "use",
  "tags",
  "map",
  "name",
];
const hasLocales = locales.length > 0;

/** The document's shape and every non-string leaf; string leaves are what the mode may change. */
function shape(value: unknown): unknown {
  if (Array.isArray(value)) return ["A", ...value.map(shape)];
  if (value !== null && typeof value === "object") {
    return [
      "M",
      ...Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, shape((value as Record<string, unknown>)[k])]),
    ];
  }
  if (typeof value === "string") return "S";
  return ["V", String(value)];
}

function parsed(source: string): unknown {
  return YAML.parseAllDocuments(source).map((d) => d.toJS({ maxAliasCount: -1 }));
}

const DOCUMENTS: ReadonlyArray<readonly [string, string]> = [
  ["plain prose", "summary: Get the rates -- all of them...\n"],
  ["quoted prose", 'summary: "Get the rates -- all of them..."\n'],
  ["literal block", "description: |\n  He said 'hi' -- loudly\n  and then left...\n"],
  ["folded block, kept", "description: >+\n  He said 'hi'...\n\n\nnext: 1\n"],
  ["folded block, stripped", "description: >-\n  He said 'hi'...\nnext: 1\n"],
  ["colon inside a scalar", "k: a:--b\nz: 1\n"],
  ["hash inside a scalar", "k: a--#b\nz: 1\n"],
  ["non-string leaves", "a: true\nb: 8080\nc: 4.8\nd: null\ne: 2026-09-20\n"],
  ["anchors and aliases", "base: &b\n  n: one two...\nuse: *b\n"],
  ["flow collections", "tags: [one -- two, three]\nmap: {a: one -- two}\n"],
  ["sequence of mappings", "- name: One -- two...\n- name: Three...\n"],
  ["nested indentation", "a:\n  b:\n    c: one -- two...\n"],
  ["multi-document stream", "---\na: one -- two...\n---\nb: three...\n"],
  ["escaped double quote", 'a: "say \\"hi\\" -- now..."\n'],
  ["escaped single quote", "a: 'it''s -- here...'\n"],
  ["trailing comment", "a: one -- two...  # a note -- here\n"],
];

describe.skipIf(!hasLocales)(
  "yaml mode never changes what a document means (modes.md 3.8.6)",
  () => {
    for (const [label, source] of DOCUMENTS) {
      it(`preserves structure and every non-string leaf: ${label}`, () => {
        const before = JSON.stringify(shape(parsed(source)));
        for (const locale of locales) {
          const out = transform(source, { locale, mode: "yaml", keys: KEYS });
          expect(() => parsed(out), `${label} in ${locale} must stay parseable`).not.toThrow();
          expect(JSON.stringify(shape(parsed(out))), `${label} in ${locale}`).toBe(before);
          expect(
            transform(out, { locale, mode: "yaml", keys: KEYS }),
            `${label} in ${locale}`,
          ).toBe(out);
        }
      });
    }

    it("changes at least one of them, so the guard is not vacuous", () => {
      const changed = DOCUMENTS.filter(
        ([, source]) => transform(source, { locale: "en-US", mode: "yaml", keys: KEYS }) !== source,
      );
      expect(changed.length).toBeGreaterThan(5);
    });
  },
);
