import { describe, expect, it } from "vitest";
import { yamlSpans } from "../../src/modes/yaml";
import { transform } from "../../src/index";
import type { PolytypoError } from "../../src/index";

const PROSE_KEYS = ["description", "summary", "title", "a", "b", "c", "k", "n"];

const yaml = (input: string, locale = "en-US", keys: readonly string[] = PROSE_KEYS): string =>
  transform(input, { locale, mode: "yaml", keys });

function spanText(source: string, keys: readonly string[] = PROSE_KEYS): string[] {
  return yamlSpans(source, keys).map((span) => source.slice(span.start, span.end));
}

describe("yaml keys option (spec/rules/modes.md 3.8.2)", () => {
  it("is required, with no default, and throws the general option code without it", () => {
    const codeOf = (options: unknown): string => {
      try {
        transform("a: one two\n", options as never);
        return "NO THROW";
      } catch (error) {
        return (error as PolytypoError).code;
      }
    };
    expect(codeOf({ locale: "en-US", mode: "yaml" })).toBe("POLYTYPO_INVALID_OPTION");
    expect(codeOf({ locale: "en-US", mode: "yaml", keys: "description" })).toBe(
      "POLYTYPO_INVALID_OPTION",
    );
    expect(codeOf({ locale: "en-US", mode: "yaml", keys: ["ok", 7] })).toBe(
      "POLYTYPO_INVALID_OPTION",
    );
  });

  it("accepts an empty list and then processes nothing", () => {
    expect(yaml("description: one...two\n", "en-US", [])).toBe("description: one...two\n");
  });

  it("processes a listed key and leaves an unlisted one byte for byte", () => {
    const source = "description: one...two\nrun: three...four\n";
    expect(yaml(source, "en-US", ["description"])).toBe(
      "description: one…two\nrun: three...four\n",
    );
  });

  it("matches the same key name at any depth and in any sequence entry", () => {
    const source = "description: one...\nnested:\n  description: two...\n- description: three...\n";
    expect(yaml(source, "en-US", ["description"])).toBe(
      "description: one…\nnested:\n  description: two…\n- description: three…\n",
    );
  });

  it("matches code point for code point, with no case folding", () => {
    expect(spanText("Description: one two\n", ["description"])).toEqual([]);
    expect(spanText("Description: one two\n", ["Description"])).toEqual(["one two"]);
  });

  it("ignores trailing spaces between the key and its colon", () => {
    expect(spanText("description  : one two\n", ["description"])).toEqual(["one two"]);
  });

  it("never matches a quoted key, which step 5 has already declined", () => {
    expect(spanText('"description": one two\n', ["description"])).toEqual([]);
  });

  it("reads a colon not followed by a space as an ordinary key character", () => {
    expect(spanText("a:b: one two\n", ["a:b"])).toEqual(["one two"]);
    expect(spanText("a:b: one two\n", ["a"])).toEqual([]);
  });

  it("is ignored in the other three modes", () => {
    expect(transform("a...b", { locale: "en-US", keys: ["a"] })).toBe("a…b");
  });
});

describe("yaml scan: what is processable (spec/rules/modes.md 3.8.4)", () => {
  it("processes a plain, a quoted and a block scalar value", () => {
    expect(spanText('a: one two\nb: "three four"\nc: |\n  five six\n')).toEqual([
      "one two",
      "three four",
      "five six",
    ]);
  });

  it("never processes a key, at any depth or in any sequence entry", () => {
    const source = "a...b: one...two\n- c...d: three...four\n";
    expect(yaml(source, "en-US", ["a...b", "c...d"])).toBe("a...b: one…two\n- c...d: three…four\n");
  });

  it("consumes block sequence entries rather than skipping them, including nested ones", () => {
    expect(spanText("- a: one two\n- - b: three four\n")).toEqual(["one two", "three four"]);
  });

  it("leaves comments, directives and both document-marker forms alone", () => {
    expect(spanText("%YAML 1.2\n---\n# a comment\na: one two\n...\n")).toEqual(["one two"]);
    expect(spanText("--- a: one two\n")).toEqual([]);
  });

  it("scans a nested block under an empty value, but not an inline value's continuation", () => {
    expect(spanText("a:\n  b: one two\n")).toEqual(["one two"]);
    expect(spanText("a: inline value\n  b: one two\n")).toEqual([]);
  });
});

describe("yaml scan: continuation lines are consumed, never rescanned (3.8.4 step 7)", () => {
  const consumed: ReadonlyArray<readonly [string, string]> = [
    ["a multi-line quoted scalar", 'a: "hello\n  b: some prose "word" here"\n'],
    ["a multi-line flow mapping", "a: {\n  b: hello world,\n  c: x\n}\n"],
    ["a multi-line flow sequence", "a: [\n  one two...,\n  three\n]\n"],
    ["a multi-line plain scalar", "a: one two...\n  b: three four...\n"],
  ];

  for (const [name, source] of consumed) {
    it(`yields no spans anywhere inside ${name}`, () => {
      expect(spanText(source), name).toEqual([]);
      expect(yaml(source), name).toBe(source);
    });
  }

  it("never lets a span hold a quoted scalar's own closing delimiter", () => {
    // The defect this repairs: the continuation line was rescanned, its `b:` read as a key, and
    // the span then ran to the scalar's closing quote — which `quotes` could convert, leaving the
    // scalar unterminated and the document unparseable.
    for (const span of yamlSpans('a: "open\n  b: text here"\n', PROSE_KEYS)) {
      expect(span.end - span.start).toBeGreaterThan(0);
    }
    expect(spanText('a: "open\n  b: text here"\n')).toEqual([]);
  });
});

describe("yaml scan: skip by default (spec/rules/modes.md 3.8.3)", () => {
  const unclaimed: ReadonlyArray<readonly [string, string]> = [
    ["a bare sequence item", "- Some prose here...\n"],
    ["a flow sequence", "a: [one two..., three]\n"],
    ["a flow mapping", "a: {b: one two...}\n"],
    ["an anchor", "a: &anchor one two...\n"],
    ["an alias", "a: *anchor\n"],
    ["a tag", "a: !!str one two...\n"],
    ["a double-quoted scalar with an escape", 'a: "one \\"two\\"... three"\n'],
    ["a single-quoted scalar with an escaped quote", "a: 'it''s one two...'\n"],
    ["a tab anywhere on the line", "a:\tone two...\n"],
    ["a compact nested sequence", "a: - one two...\n"],
    ["a compact nested mapping", "a: one two .:\n"],
    ["an unterminated quoted scalar", 'a: "one two...\n'],
    ["a value that is only a comment", "a: # one two...\n"],
  ];

  for (const [name, source] of unclaimed) {
    it(`yields no spans for ${name}, and returns it byte for byte`, () => {
      expect(spanText(source), name).toEqual([]);
      expect(yaml(source), name).toBe(source);
    });
  }

  it("returns a file that is not YAML at all unchanged, and never throws on input", () => {
    const source = "{{ not yaml at all ... }}\n\t\tmixed\tindentation\n";
    expect(() => yaml(source)).not.toThrow();
    expect(yaml(source)).toBe(source);
  });
});

describe("yaml block scalars (spec/rules/modes.md 3.8.5)", () => {
  it("gives every chomping indicator identical spans and identical trailing bytes", () => {
    for (const header of ["|", "|-", "|+", ">", ">-", ">+"]) {
      const source = `a: ${header}\n  one two...\n\n\nz: 1\n`;
      expect(spanText(source), header).toEqual(["one two..."]);
      expect(yaml(source), header).toBe(`a: ${header}\n  one two…\n\n\nz: 1\n`);
    }
  });

  it("accepts a trailing comment on the header", () => {
    expect(spanText("a: | # note\n  one two\n")).toEqual(["one two"]);
  });

  it("keeps the indentation outside the span and extra indentation inside it", () => {
    expect(spanText("a: |\n  one two\n    three four\n")).toEqual(["one two", "  three four"]);
  });

  it("never collapses a content line's leading spaces, which border a line marker", () => {
    expect(yaml("a: |\n  one two\n    three  four\n")).toBe("a: |\n  one two\n    three four\n");
  });

  it("honours an explicit indentation indicator", () => {
    expect(spanText("a: |2\n   one two\n")).toEqual([" one two"]);
  });

  const bails: ReadonlyArray<readonly [string, string]> = [
    ["an explicit indicator disagreeing with the block", "a: |4\n  one two\n"],
    ["a tab on a content line", "a: |\n  one two\n  three\tfour\n"],
    ["a later content line dedented inside the block", "a: |\n    deep one two\n  shallow three\n"],
    ["an unrecognised header", "a: |x\n  one two\n"],
  ];

  for (const [name, source] of bails) {
    it(`yields no spans for the whole block when there is ${name}`, () => {
      expect(spanText(source), name).toEqual([]);
      expect(yaml(source), name).toBe(source);
    });
  }

  it("ends the block at the first line indented no more than the key", () => {
    expect(spanText("a: |\n  one two\nb: three four\n")).toEqual(["one two", "three four"]);
  });

  it("pairs quotation marks across a block scalar's lines through the line marker", () => {
    expect(yaml('a: |\n  He said "hi"\n  and left\n')).toBe("a: |\n  He said “hi”\n  and left\n");
  });
});

describe("yaml quoted and plain scalars (spec/rules/modes.md 3.8.6)", () => {
  it("does not apply the plain-scalar colon test to a quoted scalar", () => {
    expect(spanText('a: "Chapter 1: the beginning"\n')).toEqual(["Chapter 1: the beginning"]);
  });

  it("strips a trailing comment before testing the scalar for a colon", () => {
    expect(spanText("a: some prose # note: here\n")).toEqual(["some prose"]);
  });

  it("splits a plain scalar at a colon and at a hash", () => {
    expect(spanText("a: one:two three\n")).toEqual(["one", "two three"]);
    expect(spanText("a: one#two three\n")).toEqual(["one", "two three"]);
  });

  it("does not corrupt a scalar whose dash token sits against a colon", () => {
    // Without the split, a -spaced locale emits `a: – b`, which reparses as a nested mapping.
    expect(yaml("k: a:--b\n", "de-DE")).toBe("k: a:--b\n");
  });

  it("does not corrupt a scalar whose dash token sits against a hash", () => {
    // Without the split, a -spaced locale emits `a – #b`, and `#b` becomes a comment.
    expect(yaml("k: a--#b\n", "de-DE")).toBe("k: a--#b\n");
  });

  it("applies the em-tight contraction at the same position, which cannot emit U+0020", () => {
    // 2 → 1 is admitted by the edge-growth rule, and is safe precisely because U+0020 is the
    // whole of what the split protects: `a:—b` and `a—#b` reparse as the scalars they were.
    expect(yaml("k: a--#b\n", "en-US")).toBe("k: a—#b\n");
    expect(yaml("k: a:--b\n", "en-US")).toBe("k: a:—b\n");
  });

  it("converts the same token when the split leaves it interior to a span", () => {
    expect(yaml("k: one--two three#b\n", "en-US")).toBe("k: one—two three#b\n");
  });
});

describe("yaml span partition is stable between runs (spec/rules/modes.md 5)", () => {
  it("does not lose a span because a rule changed what is inside it", () => {
    // The defect this repairs: the first draft decided processability from the span's own text
    // (a space and a letter), and `spaces` deletes the space it read — one span on the first
    // run, none on the second, and §5's obligation falsified on one line.
    const source = "a: ${{ steps.pin.outputs.sha }}\n";
    const once = yaml(source);
    expect(yamlSpans(once, PROSE_KEYS).length).toBe(yamlSpans(source, PROSE_KEYS).length);
    expect(yaml(once)).toBe(once);
  });
});

describe("yaml round-trip guarantee (spec/rules/modes.md 4)", () => {
  it("returns a document needing no changes byte for byte", () => {
    const source = "a: one two\nb: 'it''s'\nc: [x, y]\n#comment\n";
    expect(yaml(source)).toBe(source);
  });

  it("preserves quoting style, indentation and non-ASCII content around an edit", () => {
    expect(yaml('a: "Une note... précise"\n', "fr")).toBe('a: "Une note… précise"\n');
  });

  it("is idempotent on a document it does change", () => {
    const source = 'a: The "book"... and more\nb: |\n  He said -- loudly\n';
    const once = yaml(source);
    expect(once).not.toBe(source);
    expect(yaml(once)).toBe(once);
  });
});

describe("yaml mode dispatch", () => {
  it("is reachable through the aggregate entry and rejects an unknown mode alongside it", () => {
    expect(yaml("a: one...two three\n")).toBe("a: one…two three\n");
    expect(() =>
      transform("a: b\n", { locale: "en-US", mode: "yamll" as never, keys: [] }),
    ).toThrow(/Unknown mode/);
  });
});
