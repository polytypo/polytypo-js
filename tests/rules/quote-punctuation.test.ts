import { describe, it, expect } from "vitest";
import { analyze, transform } from "../../src/index";
import { LOCALES } from "../../src/generated/locales";
import { getLocaleData } from "../../src/engine/locale";
import { RULE_DEFAULTS, RULE_ORDER } from "../../src/rules/registry";

// spec/rules/quote-punctuation.md. The rule sits behind `rules: { "quote-punctuation": true }`,
// so every call below opts in unless it says it does not. Inputs are the author's text; outputs
// are the whole pipeline's, so `quotes`' conversion and this rule's move are seen together.
const on = { "quote-punctuation": true };
const US = { locale: "en-US", rules: on };

describe("quote-punctuation — registration and data", () => {
  it("sits between quotes and apostrophe and defaults to off", () => {
    expect(RULE_ORDER.indexOf("quote-punctuation")).toBe(RULE_ORDER.indexOf("quotes") + 1);
    expect(RULE_ORDER.indexOf("apostrophe")).toBe(RULE_ORDER.indexOf("quote-punctuation") + 1);
    expect(RULE_DEFAULTS["quote-punctuation"]).toBe(false);
  });

  it("only en-US declares inside", () => {
    const inside = Object.keys(LOCALES).filter(
      (tag) => getLocaleData(tag).quotes.punctuationPlacement === "inside",
    );
    expect(inside).toEqual(["en-US"]);
  });
});

describe("quote-punctuation — worked examples (spec 6)", () => {
  it("moves a comma and a full stop inside the closing mark", () => {
    expect(transform('She said "hello", then left.', US)).toBe("She said “hello,” then left.");
    expect(transform('He called it "done". Then he left.', US)).toBe(
      "He called it “done.” Then he left.",
    );
    expect(transform('Call it "ready".', US)).toBe("Call it “ready.”");
    expect(transform('Call it "ready".\nNext', US)).toBe("Call it “ready.”\nNext");
    expect(transform('The "first", the "second".', US)).toBe("The “first,” the “second.”");
    expect(transform('Both "a", "b" and "c".', US)).toBe("Both “a,” “b” and “c.”");
  });

  it("does not treat a complete sentence in the quotation as special", () => {
    expect(transform('"Go home".', US)).toBe("“Go home.”");
  });

  it("leaves text that is already inside alone", () => {
    expect(transform("She said “hello,” then left.", US)).toBe("She said “hello,” then left.");
  });

  it("moves for an unpaired curly closing mark (accepted cost)", () => {
    expect(transform("Broken pair”, then", US)).toBe("Broken pair,” then");
  });

  it("declines after a non-letter, and for every other punctuation mark", () => {
    expect(transform('"Stop!".', US)).toBe("“Stop!”.");
    expect(transform('It said "wait…".', US)).toBe("It said “wait…”.");
    expect(transform('Use "e.g.", then', US)).toBe("Use “e.g.”, then");
    expect(transform('"Route 66".', US)).toBe("“Route 66”.");
    expect(transform("\"He said 'hi'\".", US)).toBe("“He said ‘hi’”.");
    expect(transform('Say "a"; say "b": say "c"?', US)).toBe("Say “a”; say “b”: say “c”?");
  });

  it("declines unless the punctuation ends its clause", () => {
    expect(transform('"file".txt', US)).toBe("“file”.txt");
    expect(transform('He said ("hi".)', US)).toBe("He said (“hi”.)");
    expect(transform('He said "wait"...', US)).toBe("He said “wait”…");
    expect(transform("a “b”,”c”", US)).toBe("a “b”,”c”");
  });

  it("does not read the secondary close or the apostrophe", () => {
    expect(transform("Check the dogs’, bowls and cats.", US)).toBe(
      "Check the dogs’, bowls and cats.",
    );
  });

  it("does nothing unless asked", () => {
    expect(transform('She said "hello", then left.', { locale: "en-US" })).toBe(
      "She said “hello”, then left.",
    );
    expect(transform('She said "hello", then left.', { locale: "en-US", rules: {} })).toBe(
      "She said “hello”, then left.",
    );
  });

  it("is a no-op in a locale whose placement is none", () => {
    expect(transform('She said "hello", then left.', { locale: "en-GB", rules: on })).toBe(
      "She said ‘hello’, then left.",
    );
    expect(transform("Er sagte „Hallo“, dann ging er.", { locale: "de-DE", rules: on })).toBe(
      "Er sagte „Hallo“, dann ging er.",
    );
  });

  it("is idempotent when it moves", () => {
    const once = transform('The "first", the "second".', US);
    expect(transform(once, US)).toBe(once);
  });
});

describe("quote-punctuation — modes, protect, analyze", () => {
  const html = { ...US, mode: "html" as const };
  const markdown = { ...US, mode: "markdown" as const, dialect: "commonmark" as const };

  it("html: one text node moves, a span boundary on any of the three sides declines", () => {
    expect(transform('<p>She said "hello", then left.</p>', html)).toBe(
      "<p>She said “hello,” then left.</p>",
    );
    expect(transform('<p>She said <em>"hello"</em>, then left.</p>', html)).toBe(
      "<p>She said <em>“hello”</em>, then left.</p>",
    );
    expect(transform('<p>She said "<em>hello</em>", then left.</p>', html)).toBe(
      "<p>She said “<em>hello</em>”, then left.</p>",
    );
    expect(transform('<p>She said "hello".</p><p>Next.</p>', html)).toBe(
      "<p>She said “hello”.</p><p>Next.</p>",
    );
  });

  it("html: the end of the document is not a boundary", () => {
    expect(transform('<p>Call it "ready".</p>', html)).toBe("<p>Call it “ready.”</p>");
  });

  it("markdown: a delimiter after the stop is a boundary", () => {
    expect(transform('She said "hello", then left.\n', markdown)).toBe(
      "She said “hello,” then left.\n",
    );
    expect(transform('*He said "hi".* Next', markdown)).toBe("*He said “hi”.* Next");
  });

  it("yaml: a processable scalar is one span", () => {
    expect(
      transform('title: She said "hello", then left.', {
        ...US,
        mode: "yaml",
        keys: ["title"],
      }),
    ).toBe("title: She said “hello,” then left.");
  });

  it("text protect: a protected run on either side blocks the move, one elsewhere does not", () => {
    const protect = (input: string, needle: string): { start: number; end: number }[] => {
      const start = [...input.slice(0, input.indexOf(needle))].length;
      return [{ start, end: start + [...needle].length }];
    };
    const a = 'Set "file".${ext} now';
    expect(transform(a, { ...US, protect: protect(a, "${ext}") })).toBe("Set “file”.${ext} now");
    const b = 'Use "${name}", then stop.';
    expect(transform(b, { ...US, protect: protect(b, "${name}") })).toBe(
      "Use “${name}”, then stop.",
    );
    const c = 'Say "hi", then ${x}.';
    expect(transform(c, { ...US, protect: protect(c, "${x}") })).toBe("Say “hi,” then ${x}.");
  });

  it("analyze reports one change per move, tagged with the rule", () => {
    const changes = analyze('The "first", the "second".', US);
    const moves = changes.filter((change) => change.ruleId === "quote-punctuation");
    expect(moves).toHaveLength(2);
  });

  it("analyze reports nothing for the rule when it is not enabled", () => {
    const changes = analyze('The "first", the "second".', { locale: "en-US" });
    expect(changes.some((change) => change.ruleId === "quote-punctuation")).toBe(false);
  });
});
