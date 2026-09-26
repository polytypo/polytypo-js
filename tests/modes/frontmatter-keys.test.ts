// spec/rules/modes.md 3.7.4 — `markdown` mode's optional `frontmatterKeys`, spec 1.7.0.
//
// The conformance fixtures cover what the option converts. This file covers what a fixture
// cannot express (3.7.4: the option throw, the ignored-elsewhere rule, the validation order) and
// the one claim the section asks a port to test directly: the option cannot change a byte
// outside the frontmatter block, because that block is a text unit of its own.
//
// Since spec 1.8.0 it also covers 3.7.3a — where the block begins and ends, the masking rule that
// hands the parser a document with the block blanked out, and step 1's leading U+FEFF. The locator
// fixtures pin the extent through what comes out; what a fixture cannot see is that the scan, and
// not the frontmatter extension still sitting in the parse path, is what decided it — nor that the
// mark changes nothing about any document shape rather than just the one a fixture happens to hold.

import { describe, expect, it, vi } from "vitest";
import { transform, analyze } from "../../src/index";
import {
  extensionsFor,
  frontmatterSpans,
  locateFrontmatter,
  markdownSpans,
} from "../../src/modes/markdown";
import { parse, postprocess, preprocess } from "micromark";
import type * as Micromark from "micromark";
import type { PolytypoError } from "../../src/index";
import type { Dialect, Options } from "../../src/types";

// polytypo/polytypo#59, closed by spec 1.8.0 §3.7.3a: locating the block is a scan, so the option
// no longer buys a second parse of the whole document. Counting `parse` calls is the only honest
// way to assert that — the output is identical either way. A named ESM export cannot be spied on,
// hence the module mock, which calls straight through and only counts.
const parseCalls = vi.hoisted(() => ({ count: 0 }));

vi.mock("micromark", async (importOriginal) => {
  const actual = await importOriginal<typeof Micromark>();
  return {
    ...actual,
    parse: (...args: Parameters<typeof actual.parse>) => {
      parseCalls.count += 1;
      return actual.parse(...args);
    },
  };
});

const md = (input: string, options: Partial<Options> = {}): string =>
  transform(input, {
    locale: "en-US",
    mode: "markdown",
    dialect: "commonmark",
    ...options,
  } as Options);

const codeOf = (input: string, options: unknown): string => {
  try {
    transform(input, options as never);
    return "NO THROW";
  } catch (error) {
    return (error as PolytypoError).code;
  }
};

const DOC = '---\ntitle: He said "hello" once\nslug: "a - b"\n---\n\nBody "quotes" - here.\n';

describe("frontmatterKeys — what it processes (modes.md 3.7.4)", () => {
  it("processes a listed key's scalar and nothing else in the block", () => {
    expect(md(DOC, { frontmatterKeys: ["title"] })).toBe(
      '---\ntitle: He said “hello” once\nslug: "a - b"\n---\n\nBody “quotes”—here.\n',
    );
  });

  it("absent means the pre-1.7.0 skip, byte for byte", () => {
    expect(md(DOC)).toBe(
      '---\ntitle: He said "hello" once\nslug: "a - b"\n---\n\nBody “quotes”—here.\n',
    );
  });

  it("an empty list is legal and yields no spans", () => {
    expect(md(DOC, { frontmatterKeys: [] })).toBe(md(DOC));
    expect(frontmatterSpans(DOC, [])).toEqual([]);
  });

  it("matches a bare name at any depth, and only a bare name", () => {
    const nested = '---\nseo:\n  title: a "b"\ntitle: c "d"\nother:\n  slug: e "f"\n---\n\nx\n';
    expect(md(nested, { frontmatterKeys: ["title"] })).toBe(
      '---\nseo:\n  title: a “b”\ntitle: c “d”\nother:\n  slug: e "f"\n---\n\nx\n',
    );
  });

  it("leaves a TOML block alone, with the option or without it", () => {
    const toml = '+++\ntitle = "a - b"\n+++\n\nBody - here.\n';
    expect(md(toml, { frontmatterKeys: ["title"] })).toBe(
      '+++\ntitle = "a - b"\n+++\n\nBody—here.\n',
    );
    expect(frontmatterSpans(toml, ["title"])).toEqual([]);
  });

  it("adds no spans where there is no block: unterminated, or not at the start", () => {
    for (const doc of ['---\ntitle: a "b"\n\nBody\n', '\n---\ntitle: a "b"\n---\n\nBody\n']) {
      expect(md(doc, { frontmatterKeys: ["title"] })).toBe(md(doc));
      expect(frontmatterSpans(doc, ["title"])).toEqual([]);
    }
  });

  it("keeps both delimiters and every line terminator outside every span, CRLF included", () => {
    const crlf = '---\r\ntitle: a "b"\r\n---\r\n\r\nBody\r\n';
    const spans = frontmatterSpans(crlf, ["title"]);
    expect(spans.map((s) => crlf.slice(s.start, s.end))).toEqual(['a "b"']);
    expect(md(crlf, { frontmatterKeys: ["title"] })).toBe(
      "---\r\ntitle: a “b”\r\n---\r\n\r\nBody\r\n",
    );
  });

  it("applies to both dialects", () => {
    const doc = '---\ntitle: a "b"\n---\n\n<Callout>c "d"</Callout>\n';
    expect(md(doc, { dialect: "mdx", frontmatterKeys: ["title"] })).toBe(
      "---\ntitle: a “b”\n---\n\n<Callout>c “d”</Callout>\n",
    );
  });
});

describe("frontmatterKeys — the block is its own text unit (modes.md 3.7.4)", () => {
  it("an unbalanced mark in the block cannot pair with one in the body", () => {
    const doc = '---\ntitle: He said "hello\n---\n\nworld" she said\n';
    expect(md(doc, { frontmatterKeys: ["title"] })).toBe(doc);
    // The discriminator: as one unit those two marks do pair, which is what this rule refuses.
    expect(transform('title: He said "hello\n\nworld" she said\n', { locale: "en-US" })).toBe(
      "title: He said “hello\n\nworld” she said\n",
    );
  });

  it("cannot change a byte outside the block, whatever the option is set to", () => {
    const docs = [
      DOC,
      '---\ntitle: "x"\n---\n\nBody - one "two" three...\n',
      '---\nsummary: |\n  a - b\n  c - d\n---\n\nBody - e "f"...\n',
      '---\ntitle: a\n---\nAbutting body "x" - y\n',
    ];
    const allKeys = ["title", "slug", "summary", "seo", "other"];
    // The block's own length can change, so the body is located in each result rather than at one
    // offset taken from the input.
    const bodyOf = (s: string): string => s.slice(s.indexOf("\n---", 3) + "\n---".length);
    for (const doc of docs) {
      for (const keys of [[], ["title"], allKeys]) {
        const out = md(doc, { frontmatterKeys: keys });
        expect(
          bodyOf(out),
          `body of ${JSON.stringify(doc)} with keys ${JSON.stringify(keys)}`,
        ).toBe(bodyOf(md(doc)));
      }
    }
  });

  it("is idempotent under its own options, block and body together", () => {
    const docs = [DOC, '---\ntitle: a -- b "c"\nx: keep -- me\n---\n\nBody -- "d"\n'];
    for (const locale of ["en-US", "de-DE", "fr", "ru"]) {
      for (const doc of docs) {
        const options = { locale, frontmatterKeys: ["title", "summary"] };
        const once = md(doc, options);
        expect(md(once, options), `${locale} ${JSON.stringify(doc)}`).toBe(once);
      }
    }
  });
});

describe("frontmatterKeys — validation (modes.md 3.7.4)", () => {
  it("throws the general option code when given and not a list of strings", () => {
    const base = { locale: "en-US", mode: "markdown", dialect: "commonmark" };
    expect(codeOf(DOC, { ...base, frontmatterKeys: "title" })).toBe("POLYTYPO_INVALID_OPTION");
    expect(codeOf(DOC, { ...base, frontmatterKeys: ["title", 7] })).toBe("POLYTYPO_INVALID_OPTION");
    expect(codeOf(DOC, { ...base, frontmatterKeys: null })).toBe("POLYTYPO_INVALID_OPTION");
    expect(codeOf(DOC, { ...base, frontmatterKeys: ["title"] })).toBe("NO THROW");
  });

  it("is checked after the dialect", () => {
    expect(codeOf(DOC, { locale: "en-US", mode: "markdown", frontmatterKeys: "bad" })).toBe(
      "POLYTYPO_INVALID_DIALECT",
    );
    expect(
      codeOf(DOC, { locale: "en-US", mode: "markdown", dialect: "nope", frontmatterKeys: "bad" }),
    ).toBe("POLYTYPO_INVALID_DIALECT");
  });

  it("is checked before the parse, so a broken MDX document still reports the option", () => {
    const broken = "---\ntitle: a\n---\n\ntext with {an unterminated expression\n";
    expect(codeOf(broken, { locale: "en-US", mode: "markdown", dialect: "mdx" })).toBe(
      "POLYTYPO_MALFORMED_INPUT",
    );
    expect(
      codeOf(broken, {
        locale: "en-US",
        mode: "markdown",
        dialect: "mdx",
        frontmatterKeys: "bad",
      }),
    ).toBe("POLYTYPO_INVALID_OPTION");
  });

  it("is ignored, and not validated, in the other three modes", () => {
    const text = 'title: a "b"\n';
    for (const options of [
      { locale: "en-US", frontmatterKeys: "bad" },
      { locale: "en-US", mode: "html", frontmatterKeys: ["title"] },
      { locale: "en-US", mode: "yaml", keys: ["title"], frontmatterKeys: "bad" },
    ]) {
      expect(codeOf(text, options), JSON.stringify(options)).toBe("NO THROW");
    }
    // and it changes nothing in them
    expect(transform(text, { locale: "en-US", frontmatterKeys: ["title"] } as Options)).toBe(
      transform(text, { locale: "en-US" }),
    );
  });
});

describe("frontmatterKeys — analyze (analyze.md 6)", () => {
  it("reports block and body changes in document offsets, in order", () => {
    const changes = analyze(DOC, {
      locale: "en-US",
      mode: "markdown",
      dialect: "commonmark",
      frontmatterKeys: ["title"],
    } as Options);
    expect(changes.length).toBeGreaterThan(1);
    expect(changes.map((c) => c.start)).toEqual(
      [...changes.map((c) => c.start)].sort((a, b) => a - b),
    );
    for (const change of changes) {
      expect(change.start).toBeGreaterThanOrEqual(0);
      expect(change.end).toBeLessThanOrEqual([...DOC].length);
    }
    // the first change is inside the block, which is what the option added
    expect(changes[0]?.start).toBeLessThan(DOC.indexOf("\n---", 3));
  });
});

describe("frontmatterKeys — one parse per document (modes.md 3.7.3a, polytypo/polytypo#59)", () => {
  const countParses = (run: () => unknown): number => {
    parseCalls.count = 0;
    run();
    return parseCalls.count;
  };

  it("costs no second parse in transform", () => {
    const withoutOption = countParses(() => md(DOC));
    const withOption = countParses(() => md(DOC, { frontmatterKeys: ["title"] }));
    expect(withoutOption).toBe(1);
    expect(withOption).toBe(withoutOption);
  });

  it("costs no second parse in analyze", () => {
    const options = {
      locale: "en-US",
      mode: "markdown",
      dialect: "commonmark",
    } as Options;
    const withoutOption = countParses(() => analyze(DOC, options));
    const withOption = countParses(() =>
      analyze(DOC, { ...options, frontmatterKeys: ["title"] } as Options),
    );
    expect(withoutOption).toBe(1);
    expect(withOption).toBe(withoutOption);
  });
});

// modes.md 3.7.3a, spec 1.8.0. The block's extent is the scan's, and the parser is handed the
// block masked out. `micromark-extension-frontmatter` is still in the parse path, so "it never
// disagrees with the scan" is a claim about this runtime that has to be asserted rather than
// assumed — it is what makes keeping the extension inert rather than a second opinion.
const EDGE_DOCUMENTS: Record<string, string> = {
  plain: '---\ntitle: "x"\n---\n\nBody\n',
  "opener trailing space": '--- \ntitle: "x"\n---\n\nBody\n',
  "closer trailing space": '---\ntitle: "x"\n--- \n\nBody\n',
  "opener trailing tab": '---\t\ntitle: "x"\n---\n\nBody\n',
  "closer trailing tab": '---\ntitle: "x"\n---\t\n\nBody\n',
  "several trailing spaces": '---   \ntitle: "x"\n---   \n\nBody\n',
  "dots closer": '---\ntitle: "x"\n...\n\nBody\n',
  "after a blank line": '\n---\ntitle: "x"\n---\n\nBody\n',
  "opener with text": '--- yaml\ntitle: "x"\n---\n\nBody\n',
  unterminated: '---\ntitle: "x"\n\nBody\n',
  CRLF: '---\r\ntitle: "x"\r\n---\r\n\r\nBody\r\n',
  "no trailing newline": '---\ntitle: "x"\n---',
  "closer trailing space, no trailing newline": '---\ntitle: "x"\n--- ',
  "four-dash opener": '----\ntitle: "x"\n---\n\nBody\n',
  "four-dash closer": '---\ntitle: "x"\n----\n\nBody\n',
  "indented opener": ' ---\ntitle: "x"\n---\n\nBody\n',
  "indented closer, then a real one": '---\ntitle: "x"\n  ---\n---\n\nBody\n',
  "indented closer only": '---\ntitle: "x"\n  ---\n\nBody\n',
  "tab-indented closer, then a real one": '---\ntitle: "x"\n\t---\n---\n\nBody\n',
  "delimiter inside a block scalar": '---\nsummary: |\n  ---\ntitle: "x"\n---\n\nBody\n',
  "empty block": "---\n---\n\nBody\n",
  "blank line for content": "---\n\n---\n\nBody\n",
  "opener alone": "---",
  "opener alone, with a terminator": "--- \n",
  "mixed delimiters": '---\ntitle: "x"\n+++\n\nBody\n',
  TOML: '+++\ntitle = "x"\n+++\n\nBody\n',
  "TOML, opener trailing space": '+++ \ntitle = "x"\n+++\n\nBody\n',
  "TOML, unterminated": '+++\ntitle = "x"\n\nBody\n',
  // 3.7.3a step 5: CommonMark's line model, not 3.8.4's.
  "lone CR line endings": '---\rtitle: "x"\r---\r\rBody\r',
  "final CR, no newline": '---\ntitle: "x"\n---\r',
  "final CRLF fence, no newline": '---\r\ntitle: "x"\r\n---\r',
  "a lone CR inside the block": "---\ntitle: a\r---\nmore: b - c\n---\n\nBody\n",
  // 3.7.3a step 1: one U+FEFF is stepped over, and only one.
  "byte-order mark": '﻿---\ntitle: "x"\n---\n\nBody\n',
  "byte-order mark, opener trailing space": '﻿--- \ntitle: "x"\n---\n\nBody\n',
  "two byte-order marks": '﻿﻿---\ntitle: "x"\n---\n\nBody\n',
  "byte-order mark, no block": '﻿title: "x"\n',
  // 3.7.3a's own worked example: a fence inside a metadata value.
  "a fence inside a value": '---\nx: |\n  ```\n---\n\n```\ncode "q"\n```\n\nBody "q".\n',
};

const DIALECTS: readonly Dialect[] = ["commonmark", "mdx"];

/** The block `micromark-extension-frontmatter` finds in a document, if any. */
function extensionExtent(source: string, dialect: Dialect): [number, number] | null {
  const events = postprocess(
    parse({ extensions: extensionsFor(dialect) })
      .document()
      .write(preprocess()(source, null, true)),
  );
  for (const [kind, token] of events) {
    // The extension's own token types, which `micromark-util-types` does not declare.
    const type = token.type as string;
    if (kind === "enter" && (type === "yaml" || type === "toml")) {
      return [token.start.offset, token.end.offset];
    }
  }
  return null;
}

describe("the frontmatter locator (modes.md 3.7.3a)", () => {
  it("never disagrees with the extension still in the parse path, in either dialect", () => {
    for (const [name, source] of Object.entries(EDGE_DOCUMENTS)) {
      for (const dialect of DIALECTS) {
        const block = locateFrontmatter(source);
        const where = `${name} / ${dialect}: ${JSON.stringify(source)}`;
        // micromark's `preprocess` drops a leading U+FEFF without adjusting the offsets it then
        // reports, so on a BOM document the extension names the same block one code unit to the
        // left. That is the extension's own defect, recorded rather than accommodated — the scan
        // is what 3.7.3a makes normative, and the mask is taken from the scan.
        const shift = source.charCodeAt(0) === 0xfeff ? 1 : 0;
        const scanned: [number, number] | null =
          block === null ? null : [block.start - shift, block.end - shift];
        expect(scanned, where).toEqual(extensionExtent(source, dialect));
      }
    }
  });

  it("gives the body no span inside the block, because the parser never sees one", () => {
    for (const [name, source] of Object.entries(EDGE_DOCUMENTS)) {
      const block = locateFrontmatter(source);
      if (block === null) continue;
      for (const dialect of DIALECTS) {
        for (const span of markdownSpans(source, dialect)) {
          expect(span.start, `${name} / ${dialect}`).toBeGreaterThanOrEqual(block.end);
        }
      }
    }
  });

  it("names the matter, and puts both delimiter lines outside the content", () => {
    expect(locateFrontmatter('---   \ntitle: "x"\n---   \n\nBody\n')).toEqual({
      matter: "yaml",
      start: 0,
      end: 24,
      contentStart: 7,
      contentEnd: 18,
    });
    expect(locateFrontmatter('+++\ntitle = "x"\n+++\n')?.matter).toBe("toml");
    // Step 1: the mark is stepped over, so the block starts at 1 and the content with it.
    expect(locateFrontmatter('﻿---\ntitle: "x"\n---\n')).toEqual({
      matter: "yaml",
      start: 1,
      end: 19,
      contentStart: 5,
      contentEnd: 16,
    });
  });

  // The locator fixtures pin the extent through the body's skip. These pin it through the option,
  // where a wrong extent costs an offset rather than some prose: a locator missing the
  // trailing-whitespace clause finds no block here, so the title would come back untouched, and
  // one that assumed a bare fence would start the content one code point short.
  it("is what decides the block: whitespace on either fence still converts", () => {
    for (const [name, doc] of [
      ["opener space", "--- \ntitle: it's here\n---\n\nBody\n"],
      ["opener tab", "---\t\ntitle: it's here\n---\n\nBody\n"],
      ["closer space", "---\ntitle: it's here\n--- \n\nBody\n"],
      ["closer tab", "---\ntitle: it's here\n---\t\n\nBody\n"],
      ["both, several", "---  \ntitle: it's here\n---\t \n\nBody\n"],
      ["byte-order mark", "﻿---\ntitle: it's here\n---\n\nBody\n"],
      ["byte-order mark and a space", "﻿--- \ntitle: it's here\n---\n\nBody\n"],
      ["final CR, no newline", "---\ntitle: it's here\n---\r"],
    ] as const) {
      expect(md(doc, { frontmatterKeys: ["title"] }), name).toBe(doc.replace("it's", "it’s"));
      expect(md(doc), `${name} without the option`).toBe(doc);
    }
  });

  it("finds no block where 3.7.3a says there is none, so the option adds nothing", () => {
    for (const [name, doc] of [
      ["opener with text", '--- yaml\ntitle: "x"\n---\n\nBody\n'],
      ["four-dash opener", '----\ntitle: "x"\n---\n\nBody\n'],
      ["four-dash closer", '---\ntitle: "x"\n----\n\nBody\n'],
      ["indented closer", '---\ntitle: "x"\n  ---\n\nBody\n'],
      ["dots closer", '---\ntitle: "x"\n...\n\nBody\n'],
      ["mixed delimiters", '---\ntitle: "x"\n+++\n\nBody\n'],
      ["after a blank line", '\n---\ntitle: "x"\n---\n\nBody\n'],
      ["indented opener", ' ---\ntitle: "x"\n---\n\nBody\n'],
      ["two byte-order marks", '﻿﻿---\ntitle: "x"\n---\n\nBody\n'],
      ["opener alone", "--- \n"],
    ] as const) {
      expect(locateFrontmatter(doc), name).toBeNull();
      expect(frontmatterSpans(doc, ["title"]), name).toEqual([]);
      expect(md(doc, { frontmatterKeys: ["title"] }), name).toBe(md(doc));
    }
  });
});

describe("a leading byte-order mark (modes.md 3.7.3a step 1)", () => {
  // micromark's `preprocess` drops the mark and then reports offsets against the shortened string,
  // so every span in a mark-carrying document used to land a code unit to the left. That ate each
  // span's last code point, and `en-us-markdown-commonmark-byte-order-mark-no-block` came back
  // untouched — the whole document, with no option set, `...` and `"` alike. Measured across the
  // four runtimes implementing the mode, three converted it and this one did not.
  it("converts a document that carries a mark and has no block", () => {
    expect(md('﻿Wait for it... he said "hi"\n')).toBe("﻿Wait for it… he said “hi”\n");
  });

  // The sharper claim, and the one a fixture per shape could not carry: the mark is not content,
  // so it changes nothing at all. Block or no block, and in either dialect.
  it("leaves every other byte of every document shape exactly as it was", () => {
    for (const doc of [
      'Wait for it... he said "hi"\n',
      '# Heading\n\nBody -- "q" here...\n',
      '---\ntitle: a\n---\n\nWait for it... "q"\n',
      '--- \ntitle: a\n---\n\nWait for it... "q"\n',
      '```\ncode "q"...\n```\n\nBody "q"...\n',
      '- item "a"...\n- item "b"...\n',
      '<div>inner "q"...</div>\n',
    ]) {
      for (const dialect of DIALECTS) {
        expect(md("﻿" + doc, { dialect }), `${dialect}: ${JSON.stringify(doc)}`).toBe(
          "﻿" + md(doc, { dialect }),
        );
      }
    }
  });

  it("steps over one mark and no more", () => {
    expect(locateFrontmatter("﻿﻿---\ntitle: a\n---\n")).toBeNull();
    const twoMarks = '﻿﻿---\ntitle: a\n---\n\nWait for it... "q"\n';
    expect(md(twoMarks, { frontmatterKeys: ["title"] })).toBe(md(twoMarks));
  });
});

describe("the mask handed to the parser (modes.md 3.7.3a)", () => {
  // The two `-masks-the-parser` fixtures take the skip path. This is the option path, where the
  // block's own fence is also a span the pipeline runs over.
  it("keeps a fence inside a metadata value from pairing with the body's", () => {
    const doc =
      '---\nx: |\n  ```\n  it\'s "code"\n---\n\n```\ncode "q" here\n```\n\nBody "q" here.\n';
    // The block scalar's content lines are spans of the frontmatter unit (3.8.5), so they convert;
    // the body's fenced code block does not, and the body's prose does. Without the mask the two
    // fences pair and those last two swap roles — the failure 3.7.3a measured in another runtime.
    expect(md(doc, { frontmatterKeys: ["x"] })).toBe(
      '---\nx: |\n  ```\n  it’s “code”\n---\n\n```\ncode "q" here\n```\n\nBody “q” here.\n',
    );
  });

  it("keeps every body offset where it was, whatever the block holds", () => {
    // The mask replaces code points, not bytes, and the block here carries an astral character.
    // A mask that shortened the source would shift every body offset after it, and the first
    // casualty is a span's own edge — which is what the trailing `...` catches.
    const doc = '---\ntitle: café \u{1F600} it\'s ok\n---\n\nBody "q" here...\n';
    expect(md(doc)).toBe("---\ntitle: café \u{1F600} it's ok\n---\n\nBody “q” here…\n");
    expect(md(doc, { frontmatterKeys: ["title"] })).toBe(
      "---\ntitle: café \u{1F600} it’s ok\n---\n\nBody “q” here…\n",
    );
    // And step 1's U+FEFF is masked with the block, which is what keeps the body's offsets right:
    // micromark's `preprocess` drops an unmasked mark without moving the offsets it then reports,
    // and the first thing that costs is a span's own last code point — the `.` of `here...`.
    const bom = "﻿" + doc;
    expect(md(bom)).toBe("﻿" + md(doc));
    expect(md(bom, { frontmatterKeys: ["title"] })).toBe(
      "﻿" + md(doc, { frontmatterKeys: ["title"] }),
    );
  });

  // 3.7.4 names its own arbiter: the option claims "3.8's scan applies verbatim", so the block's
  // content must come out of `markdown` mode exactly as those characters come out of `yaml` mode.
  // This is the test that catches a decline implemented by rewriting the content instead of by
  // dropping spans — substituting each lone U+000D for a character the scan already declines moves
  // it onto a line of its own, which ends a value run and converts a key the scan never saw.
  it("agrees with `yaml` mode on the same characters", () => {
    const keys = ["title", "slug", "summary", "date"];
    const contents = [
      'title: a "b"\nslug: c "d"\n\r',
      "summary: a\rb\n  title: c -- d\n",
      'title: a "b"\rslug: "x"\r',
      'title: "a\rb"\nslug: c "d"\n',
      'title: a "b"\n',
      'title: a "b"\r\nslug: c "d"\r\n',
      "title: a\rb\n",
      '\rtitle: a "b"\n',
      'title: a "b"\n\r\nslug: c "d"\n',
      'summary: |\n  a "b"\n  c\rd\n',
      'title: a "b"\n\r',
      'date: "2026-09-26"\rtitle: a "b"\n',
    ];
    for (const content of contents) {
      for (const locale of ["en-US", "fr"]) {
        const doc = `---\n${content}---\n\nBody "q" here.\n`;
        const out = md(doc, { locale, frontmatterKeys: keys });
        const blockOut = out.slice(4, out.indexOf("---\n\nBody"));
        expect(blockOut, `${locale}: ${JSON.stringify(content)}`).toBe(
          transform(content, { locale, mode: "yaml", keys } as Options),
        );
      }
    }
  });

  // The one reachable shape where 3.7.4's window sentence and that arbiter part, and no fixture
  // covers it. The content's last line ENDS in the lone U+000D rather than carrying one inside:
  // 3.8.4's own splitter strips a content-final U+000D, so `yaml` mode sees a clean line and
  // converts `slug` — while 3.7.4's window "runs to the start of the next line, not to the end of
  // this one", which puts that U+000D inside `slug`'s window and declines it. The window sentence
  // is the normative one and is what this runtime follows; it is also the safe direction. Pinned on
  // both sides so that a later canonical decision either way fails here rather than drifting.
  it("declines a line ending in a lone U+000D, where `yaml` mode does not", () => {
    const content = 'title: a "b"\nslug: c "d"\r';
    expect(md(`---\n${content}---\n\nBody "q".\n`, { frontmatterKeys: ["title", "slug"] })).toBe(
      '---\ntitle: a “b”\nslug: c "d"\r---\n\nBody “q”.\n',
    );
    expect(transform(content, { locale: "en-US", mode: "yaml", keys: ["title", "slug"] })).toBe(
      "title: a “b”\nslug: c “d”\r",
    );
  });

  // 3.7.4: a content LINE carrying a U+000D not followed by U+000A yields no spans. 3.7.3a step 5
  // finds the block by CommonMark's line model, 3.8.4 then reads the content by its LF-only one —
  // and the two do not compose. A lone-U+000D document is one 3.8.4 line, so it loses the whole
  // block however few keys it has; a document with one stray mark loses that line only.
  it("costs one stray U+000D its own line and no more", () => {
    // 3.7.4 is per LINE, not per block: a stray U+000D inside one value is something people produce
    // by accident, and it should cost that value rather than the whole block. The mechanism is
    // 3.8.4 step 1's own tab test, which is what makes it per line without a second reading of it.
    const keys = ["title", "slug", "other"];
    for (const doc of [
      '---\ntitle: a "b"\nslug: x\ry\nother: c "d"\n---\n\nBody "e".\n',
      // A CRLF document with one lone U+000D in it: still only that line.
      '---\r\ntitle: a "b"\r\nslug: x\ry\r\nother: c "d"\r\n---\r\n\r\nBody "e".\r\n',
    ]) {
      expect(
        frontmatterSpans(doc, keys).map((span) => doc.slice(span.start, span.end)),
        doc,
      ).toEqual(['a "b"', 'c "d"']);
      const out = md(doc, { frontmatterKeys: keys });
      expect(out, doc).toBe(
        doc.replace('a "b"', "a “b”").replace('c "d"', "c “d”").replace('Body "e"', "Body “e”"),
      );
      expect(md(out, { frontmatterKeys: keys }), `idempotent: ${doc}`).toBe(out);
    }
  });

  it("yields nothing for any lone-CR block, one key line or several", () => {
    for (const [doc, keys] of [
      ["---\rtitle: it's here\r---\r\rBody\r", ["title"]],
      ["---\rtitle: a\rslug: x - y\r---\r\rBody\r", ["title"]],
      ["---\rtitle: a\rslug: x - y\r---\r\rBody\r", ["slug"]],
      ['---\rtitle: it\'s\rdate: "2026-09-26"\r---\r\rBody\r', ["title"]],
      // A CRLF block with one stray lone U+000D in it: the same bail, not a CRLF exemption.
      ['---\r\ntitle: a "b"\rslug: c\r\n---\r\n\r\nBody\r\n', ["title"]],
    ] as const) {
      expect(frontmatterSpans(doc, keys), doc).toEqual([]);
      expect(md(doc, { frontmatterKeys: keys }), doc).toBe(md(doc));
    }
    // The block is still located and still skipped, so the body converts and the block does not.
    expect(
      md("---\rtitle: it's here\r---\r\rBody it's here.\r", { frontmatterKeys: ["title"] }),
    ).toBe("---\rtitle: it's here\r---\r\rBody it’s here.\r");
    // And a CRLF block, whose every U+000D is followed by U+000A, is not caught by it.
    expect(
      md("---\r\ntitle: it's here\r\n---\r\n\r\nBody\r\n", { frontmatterKeys: ["title"] }),
    ).toBe("---\r\ntitle: it’s here\r\n---\r\n\r\nBody\r\n");
  });

  it("leaves the option unable to split a document's output, on either line model", () => {
    // A lone U+000D inside the block: 3.7.3a step 5 ends the line there, so the block is the first
    // three lines and `more: b - c` is body prose. Every option value must agree about that, and
    // agree with the option being absent — a runtime whose body skip and whose block extent came
    // from two different line models emitted `more: b—cb—c` here, and one that suppressed
    // body spans in the block's range instead left `more: b - c` for some option values and not
    // others.
    const doc = "---\ntitle: a\r---\nmore: b - c\n---\n\nBody\n";
    const expected = "---\ntitle: a\r---\nmore: b—c\n---\n\nBody\n";
    for (const keys of [undefined, [], ["title"], ["more"], ["title", "more"]]) {
      const options = keys === undefined ? {} : { frontmatterKeys: keys };
      const once = md(doc, options);
      expect(once, JSON.stringify(keys)).toBe(expected);
      expect(md(once, options), `idempotent, ${JSON.stringify(keys)}`).toBe(once);
    }
  });
});
