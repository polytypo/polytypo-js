// spec/rules/modes.md 3.7.4 — `markdown` mode's optional `frontmatterKeys`, spec 1.7.0.
//
// The conformance fixtures cover what the option converts. This file covers what a fixture
// cannot express (3.7.4: the option throw, the ignored-elsewhere rule, the validation order) and
// the one claim the section asks a port to test directly: the option cannot change a byte
// outside the frontmatter block, because that block is a text unit of its own.

import { describe, expect, it } from "vitest";
import { transform, analyze } from "../../src/index";
import { frontmatterSpans } from "../../src/modes/markdown";
import type { PolytypoError } from "../../src/index";
import type { Options } from "../../src/types";

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
    expect(md(DOC)).toBe('---\ntitle: He said "hello" once\nslug: "a - b"\n---\n\nBody “quotes”—here.\n');
  });

  it("an empty list is legal and yields no spans", () => {
    expect(md(DOC, { frontmatterKeys: [] })).toBe(md(DOC));
    expect(frontmatterSpans(DOC, "commonmark", [])).toEqual([]);
  });

  it("matches a bare name at any depth, and only a bare name", () => {
    const nested = '---\nseo:\n  title: a "b"\ntitle: c "d"\nother:\n  slug: e "f"\n---\n\nx\n';
    expect(md(nested, { frontmatterKeys: ["title"] })).toBe(
      '---\nseo:\n  title: a “b”\ntitle: c “d”\nother:\n  slug: e "f"\n---\n\nx\n',
    );
  });

  it("leaves a TOML block alone, with the option or without it", () => {
    const toml = '+++\ntitle = "a - b"\n+++\n\nBody - here.\n';
    expect(md(toml, { frontmatterKeys: ["title"] })).toBe('+++\ntitle = "a - b"\n+++\n\nBody—here.\n');
    expect(frontmatterSpans(toml, "commonmark", ["title"])).toEqual([]);
  });

  it("adds no spans where there is no block: unterminated, or not at the start", () => {
    for (const doc of ['---\ntitle: a "b"\n\nBody\n', '\n---\ntitle: a "b"\n---\n\nBody\n']) {
      expect(md(doc, { frontmatterKeys: ["title"] })).toBe(md(doc));
      expect(frontmatterSpans(doc, "commonmark", ["title"])).toEqual([]);
    }
  });

  it("keeps both delimiters and every line terminator outside every span, CRLF included", () => {
    const crlf = '---\r\ntitle: a "b"\r\n---\r\n\r\nBody\r\n';
    const spans = frontmatterSpans(crlf, "commonmark", ["title"]);
    expect(spans.map((s) => crlf.slice(s.start, s.end))).toEqual(['a "b"']);
    expect(md(crlf, { frontmatterKeys: ["title"] })).toBe('---\r\ntitle: a “b”\r\n---\r\n\r\nBody\r\n');
  });

  it("applies to both dialects", () => {
    const doc = '---\ntitle: a "b"\n---\n\n<Callout>c "d"</Callout>\n';
    expect(md(doc, { dialect: "mdx", frontmatterKeys: ["title"] })).toBe(
      '---\ntitle: a “b”\n---\n\n<Callout>c “d”</Callout>\n',
    );
  });
});

describe("frontmatterKeys — the block is its own text unit (modes.md 3.7.4)", () => {
  it("an unbalanced mark in the block cannot pair with one in the body", () => {
    const doc = '---\ntitle: He said "hello\n---\n\nworld" she said\n';
    expect(md(doc, { frontmatterKeys: ["title"] })).toBe(doc);
    // The discriminator: as one unit those two marks do pair, which is what this rule refuses.
    expect(transform('title: He said "hello\n\nworld" she said\n', { locale: "en-US" })).toBe(
      'title: He said “hello\n\nworld” she said\n',
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
    for (const doc of docs) {
      const blockEnd = doc.indexOf("\n---", 3) + "\n---".length;
      for (const keys of [[], ["title"], allKeys]) {
        const out = md(doc, { frontmatterKeys: keys });
        const bodyOf = (s: string): string => s.slice(s.indexOf("\n---", 3) + "\n---".length);
        expect(bodyOf(out), `body of ${JSON.stringify(doc)} with keys ${JSON.stringify(keys)}`).toBe(
          doc.slice(blockEnd) === "" ? "" : bodyOf(md(doc)),
        );
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
    expect(changes.map((c) => c.start)).toEqual([...changes.map((c) => c.start)].sort((a, b) => a - b));
    for (const change of changes) {
      expect(change.start).toBeGreaterThanOrEqual(0);
      expect(change.end).toBeLessThanOrEqual([...DOC].length);
    }
    // the first change is inside the block, which is what the option added
    expect(changes[0]?.start).toBeLessThan(DOC.indexOf("\n---", 3));
  });
});
