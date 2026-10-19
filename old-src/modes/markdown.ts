import { parse, postprocess, preprocess } from "micromark";
import { frontmatter } from "micromark-extension-frontmatter";
import { gfm } from "micromark-extension-gfm";
import { mdxjs } from "micromark-extension-mdxjs";
import type { Event, Extension } from "micromark-util-types";
import { PolytypoError } from "../errors.js";
import type { Dialect } from "../types.js";
import { htmlFragmentSpans, isSkippedElement } from "./html.js";
import { yamlSpans } from "./yaml.js";
import { wrapParserErrors } from "./parse-error.js";
import type { Span } from "./spans.js";

/**
 * spec/rules/modes.md 3.7. Each entry is skipped **whole**, including anything that looks
 * processable inside it. The complement is not enumerated: a span is emitted only for a
 * micromark `data` token, which is the tokenizer's own name for "literal content", so list
 * markers, emphasis delimiters, heading sequences, table padding, line endings, hard-break
 * spaces, character escapes and character references are outside every span by construction
 * rather than by a second list that could drift from the first.
 */
const SKIPPED_TOKEN_TYPES: ReadonlySet<string> = new Set([
  // fenced code blocks (including the info string and the fences) and indented code blocks
  "codeFenced",
  "codeIndented",
  // inline code spans, including the backticks
  "codeText",
  // autolinks `<https://…>`, and GFM's bare-URL form
  "autolink",
  "literalAutolink",
  // link and image destinations and titles; the definition line of a reference link. The link
  // *text* is a `labelText`, which is not skipped.
  "resource",
  "reference",
  "definition",
  // MDX: expression containers in full, and every JSX attribute — the whole tag is skipped, so
  // attributes never surface. JSX element *children* sit outside the tag tokens and are
  // processable.
  "mdxFlowExpression",
  "mdxTextExpression",
  "mdxjsEsm",
  // modes.md 3.7.3, and it matters: without it the second `---` of a YAML block reads as a setext
  // underline, `title: Une note` becomes a paragraph, and `fr` puts a narrow no-break space in
  // front of the colon of a machine-read metadata field. Covered by conformance fixtures
  // en-us-markdown-{commonmark,mdx}-frontmatter, fr-markdown-{commonmark,mdx}-frontmatter-nbsp,
  // en-us-markdown-commonmark-frontmatter-toml and -frontmatter-unterminated.
  //
  // These are `micromark-extension-frontmatter`'s own token types, one per matter. An earlier
  // revision listed `"frontmatter"`, which the extension never emits: the block was skipped only
  // because its content arrives as `yamlValue`/`tomlValue` rather than `data`, so the entry that
  // was supposed to do the work did none.
  //
  // Since spec 1.8.0 the skip is 3.7.3a's mask, not this: a located block reaches the parser as
  // blanks, so the extension cannot see one. The extension stays because it is measured inert —
  // `tests/modes/frontmatter-keys.test.ts` asserts over every edge document that it never finds
  // a block the scan denies — and because removing a working locator that costs nothing would be
  // a change with no problem behind it. What the test would catch is the case that would matter:
  // the two disagreeing about whether a document has a block at all.
  "yaml",
  "toml",
]);

/** Token types whose enter/exit also maintains the skipped-element stack. */
const RAW_TAG_TOKEN_TYPES: ReadonlySet<string> = new Set([
  "htmlText",
  "mdxJsxTextTag",
  "mdxJsxFlowTag",
]);

const LESS_THAN = 0x3c;
const GREATER_THAN = 0x3e;
const SLASH = 0x2f;
const EXCLAMATION = 0x21;
const QUESTION = 0x3f;

function isAsciiLetter(unit: number): boolean {
  return (unit >= 0x61 && unit <= 0x7a) || (unit >= 0x41 && unit <= 0x5a);
}

function isTagNameUnit(unit: number): boolean {
  // Deliberately permissive: anything that is not a delimiter belongs to the name. Custom
  // elements (`my-callout`) and member expressions (`Foo.Bar`) must come out whole so that they
  // fail the skip-list membership test rather than being truncated into something that passes.
  return (
    unit !== GREATER_THAN &&
    unit !== SLASH &&
    unit !== 0x20 &&
    unit !== 0x09 &&
    unit !== 0x0a &&
    unit !== 0x0d
  );
}

/** ASCII-only, because HTML tag names are ASCII case-insensitive and `toLowerCase()` is not. */
function asciiLower(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i += 1) {
    const unit = value.charCodeAt(i);
    out += unit >= 0x41 && unit <= 0x5a ? String.fromCharCode(unit + 0x20) : value[i];
  }
  return out;
}

interface RawTag {
  readonly name: string;
  readonly closing: boolean;
  readonly selfClosing: boolean;
}

function readTag(tag: string): RawTag | null {
  if (tag.charCodeAt(0) !== LESS_THAN) return null;
  let i = 1;
  const closing = tag.charCodeAt(i) === SLASH;
  if (closing) i += 1;
  // Comments, declarations and processing instructions carry no element name.
  if (tag.charCodeAt(i) === EXCLAMATION || tag.charCodeAt(i) === QUESTION) return null;
  if (!isAsciiLetter(tag.charCodeAt(i))) return null;
  const nameAt = i;
  while (i < tag.length && isTagNameUnit(tag.charCodeAt(i))) i += 1;
  const selfClosing = tag.charCodeAt(tag.length - 2) === SLASH;
  return { name: tag.slice(nameAt, i), closing, selfClosing };
}

/**
 * modes.md 3.7: raw HTML is "handed to the html skip list of 3.6". Inline raw HTML reaches the
 * tokenizer as isolated tags with ordinary markdown content between them, so honouring the
 * subtree rule means tracking which skipped element is currently open. JSX names are compared
 * case-sensitively (`<Code>` is a component, `<code>` is an element); HTML names are not.
 */
function updateElementStack(stack: string[], tag: string, caseSensitive: boolean): void {
  const parsed = readTag(tag);
  if (parsed === null) return;
  const name = caseSensitive ? parsed.name : asciiLower(parsed.name);
  if (parsed.closing) {
    if (stack[stack.length - 1] === name) stack.pop();
    return;
  }
  if (!parsed.selfClosing && isSkippedElement(name)) stack.push(name);
}

function tokenize(source: string, extensions: readonly Extension[]): Event[] {
  return postprocess(
    parse({ extensions: [...extensions] })
      .document()
      .write(preprocess()(source, null, true)),
  );
}

/**
 * modes.md 3.7.1. The dialect is the caller's, never detected: `"commonmark"` is CommonMark 0.31
 * plus GFM, `"mdx"` is the same minus indented code blocks and `<…>` autolinks, plus JSX and
 * `{…}` expression containers. Both enable frontmatter and GFM, which 3.7.2 makes normative —
 * §4's promise that table alignment rows survive is empty unless tables are recognised at all.
 */
export function resolveDialect(dialect: Dialect | undefined): Dialect {
  if (dialect === "commonmark" || dialect === "mdx") return dialect;
  if (dialect === undefined) {
    throw new PolytypoError(
      "POLYTYPO_INVALID_DIALECT",
      'Mode "markdown" requires a dialect. Expected "commonmark" or "mdx"; there is no default.',
    );
  }
  throw new PolytypoError(
    "POLYTYPO_INVALID_DIALECT",
    `Unknown dialect "${String(dialect)}". Expected "commonmark" or "mdx".`,
  );
}

// modes.md 3.7.3 names both frontmatter delimiters, `---` (YAML) and `+++` (TOML), and skips
// either whole. micromark's default matter is YAML alone, so both must be asked for by name: with
// the default, a `+++` block parses as prose and the machine-read fields inside it get typeset.
const FRONTMATTER_MATTERS = ["yaml", "toml"] as const;

export function extensionsFor(dialect: Dialect): Extension[] {
  const fm = frontmatter([...FRONTMATTER_MATTERS]);
  return dialect === "mdx" ? [fm, gfm(), mdxjs()] : [fm, gfm()];
}

// modes.md 3.7.3a, spec 1.8.0: where the frontmatter block begins and ends, decided by the scan
// below and by nothing else. Four runtimes reached the construct through four parsers and got four
// answers — two of them typeset `date: "2026-09-26"` over one trailing space on a fence — so the
// section makes this scan normative and a parser's opinion a thing measured against it. Locating
// the block here is also what lets `frontmatterSpans` stop parsing the document a second time
// (polytypo/polytypo#59).
const YAML_DELIMITER = "---";
const TOML_DELIMITER = "+++";

const TAB = 0x09;
const LF = 0x0a;
const CR = 0x0d;
const SPACE = 0x20;
const BOM = 0xfeff;

interface SourceLine {
  /** Index just past the line's content: the terminator, or the end of the source. */
  readonly end: number;
  /** Index the next line starts at, or the end of the source when this line is the last. */
  readonly next: number;
}

/**
 * 3.7.3a step 5: **CommonMark's** line, not 3.8.4's. A line ends at U+000A, at a U+000D that is
 * not followed by U+000A, or at the end of input, and the terminator is never part of the line.
 * The block is a Markdown construct and ends its lines the way the language around it does; the
 * YAML inside it keeps 3.8.4's LF-only model (`./yaml.js`), and the two are different on purpose —
 * harmonising them silently changes one of them.
 */
function markdownLineFrom(source: string, start: number): SourceLine {
  for (let i = start; i < source.length; i += 1) {
    const unit = source.charCodeAt(i);
    if (unit === LF) return { end: i, next: i + 1 };
    if (unit === CR) return { end: i, next: source.charCodeAt(i + 1) === LF ? i + 2 : i + 1 };
  }
  return { end: source.length, next: source.length };
}

/** 3.7.3a steps 2 and 3: what a delimiter line may carry after the delimiter, and nothing else. */
function isBlankRun(source: string, from: number, to: number): boolean {
  for (let i = from; i < to; i += 1) {
    const unit = source.charCodeAt(i);
    if (unit !== SPACE && unit !== TAB) return false;
  }
  return true;
}

/**
 * A delimiter line: the delimiter at the line's first code point — indentation disqualifies it —
 * then U+0020 and U+0009 to the end of the line. A fourth delimiter character is not whitespace,
 * so `----` is neither an opener nor a closer.
 */
function isDelimiterLine(
  source: string,
  start: number,
  line: SourceLine,
  delimiter: string,
): boolean {
  return (
    source.startsWith(delimiter, start) && isBlankRun(source, start + delimiter.length, line.end)
  );
}

/** modes.md 3.7.3a. The frontmatter block's extent, in source offsets. */
export interface FrontmatterBlock {
  /** Which matter the delimiter names. TOML yields no spans either way (3.7.4). */
  readonly matter: "yaml" | "toml";
  /** First code point of the opening delimiter: 0, or 1 past a single leading U+FEFF (step 1). */
  readonly start: number;
  /**
   * End of the closing delimiter line's content — its trailing whitespace included, its terminator
   * excluded.
   */
  readonly end: number;
  /** 3.7.4: the code point after the opening delimiter line's terminator. */
  readonly contentStart: number;
  /** 3.7.4: the code point that begins the closing delimiter line. */
  readonly contentEnd: number;
}

/**
 * modes.md 3.7.3a, the whole of it. Offsets are UTF-16 indices, like every other mode in this
 * runtime; every code point the scan tests is ASCII or U+FEFF, so indexing by code unit and
 * indexing by code point agree on all of them.
 */
export function locateFrontmatter(source: string): FrontmatterBlock | null {
  // Step 1: the document must begin with the delimiter, with a single leading U+FEFF stepped over
  // first — it is a byte-order mark, not content, and reading it as content would deny the block
  // to every file some Windows editors produce.
  const start = source.charCodeAt(0) === BOM ? 1 : 0;
  const matter = source.startsWith(YAML_DELIMITER, start)
    ? "yaml"
    : source.startsWith(TOML_DELIMITER, start)
      ? "toml"
      : null;
  if (matter === null) return null;
  const delimiter = matter === "yaml" ? YAML_DELIMITER : TOML_DELIMITER;

  // Step 2: the rest of the opening line may be U+0020 and U+0009 and nothing else.
  const opener = markdownLineFrom(source, start);
  if (!isBlankRun(source, start + delimiter.length, opener.end)) return null;

  // Step 3: the closing line is the first LATER line of the same delimiter. Step 4: with none,
  // there is no block, and the opening delimiter is whatever the dialect makes of it.
  const contentStart = opener.next;
  for (let at = contentStart; at < source.length;) {
    const line = markdownLineFrom(source, at);
    if (isDelimiterLine(source, at, line, delimiter)) {
      return { matter, start, end: line.end, contentStart, contentEnd: at };
    }
    at = line.next;
  }
  return null;
}

/**
 * modes.md 3.7.3a: **the parser is handed the block masked out** — the located block, both
 * delimiter lines included and step 1's leading U+FEFF with them, replaced by U+0020, with line
 * terminators kept as they are. The mark is in that list because without it the first line is not
 * blank: no parser is required to strip it, and a runtime masking the block alone emits a span
 * for it.
 *
 * The invariant is that the masked source stay **positionally aligned with the original in the unit
 * this runtime maps parser offsets back through**, which here is UTF-16 code units: micromark's
 * offsets are handed straight to `Span`, so one U+0020 per code unit is what JS owes. An astral
 * character therefore masks to two spaces, not one. It is deliberately not stated as a count of
 * code points — a runtime that converts offsets against the masked source first owes code-point
 * alignment instead, and both are conformant.
 *
 * Suppressing spans inside the block's range instead is not equivalent, and the runtime that did
 * that is measured in 3.7.3a: a fence inside a metadata value pairs with the body's own, and the
 * body's code block and its prose swap roles — or, with nothing to pair with, swallows the rest of
 * the document. The damage is in what the parser concluded, so no span-level check can see it.
 *
 * Masking is also what keeps 3.7.4's two text units disjoint now that the extent is the scan's and
 * not the parser's: the body cannot emit a span inside a block the parser was never shown.
 */
function maskFrontmatter(source: string, block: FrontmatterBlock | null): string {
  if (block === null) return source;
  let masked = "";
  for (let i = 0; i < block.end; i += 1) {
    const unit = source.charCodeAt(i);
    masked += unit === LF || unit === CR ? source[i] : " ";
  }
  return masked + source.slice(block.end);
}

/**
 * modes.md 3.7. The body's spans. The document reaches the parser with its frontmatter block
 * masked out (3.7.3a), so the block is skipped because the scan located it, not because an
 * extension recognised it — and `text` below is what the token offsets refer to.
 *
 * Two corrections sit between `text` and the spans this returns:
 *
 * - **`shift`**: micromark's `preprocess` drops a leading U+FEFF and then reports offsets against
 *   the shortened string, so every span in a document carrying one lands a code unit to the left —
 *   which ate the last code point of every span and left
 *   `en-us-markdown-commonmark-byte-order-mark-no-block` unconverted in full. The mark is removed
 *   here instead, and the difference added back. A document whose block was located needs no such
 *   correction, because 3.7.3a masks the mark along with the block;
 * - **the no-span rule** (3.7.3a): no span may lie inside the block whatever the parser made of the
 *   masked text. A span straddling the block's end is **clipped** to the part outside it, and
 *   dropped only when nothing is left, so body prose past the block cannot be lost to a parser's
 *   mistake
 *   about where the block ended. Masking is what makes this inert for micromark — measured over
 *   nineteen block shapes in both dialects, it emits nothing inside a masked block — and the spec
 *   states the rule separately because it is not true of every parser.
 */
export function markdownSpans(source: string, dialect: Dialect): Span[] {
  const block = locateFrontmatter(source);
  const masked = maskFrontmatter(source, block);
  const shift = masked.charCodeAt(0) === BOM ? 1 : 0;
  const text = shift === 0 ? masked : masked.slice(shift);
  const events = wrapParserErrors(dialect, () => tokenize(text, extensionsFor(dialect)));
  const spans: Span[] = [];
  const elementStack: string[] = [];
  let skipDepth = 0;

  for (const [kind, token] of events) {
    const type = token.type;

    if (SKIPPED_TOKEN_TYPES.has(type)) {
      skipDepth += kind === "enter" ? 1 : -1;
      continue;
    }

    if (RAW_TAG_TOKEN_TYPES.has(type)) {
      if (kind === "enter") {
        updateElementStack(
          elementStack,
          text.slice(token.start.offset, token.end.offset),
          type !== "htmlText",
        );
      }
      skipDepth += kind === "enter" ? 1 : -1;
      continue;
    }

    // An HTML block is handed to the `html` extractor rather than skipped whole, so that the
    // prose inside `<div>…</div>` is typeset while the markup is not.
    if (type === "htmlFlow") {
      if (kind === "enter" && skipDepth === 0 && elementStack.length === 0) {
        for (const span of htmlFragmentSpans(
          text.slice(token.start.offset, token.end.offset),
          token.start.offset + shift,
        )) {
          spans.push(span);
        }
      }
      skipDepth += kind === "enter" ? 1 : -1;
      continue;
    }

    if (kind === "enter" && type === "data" && skipDepth === 0 && elementStack.length === 0) {
      spans.push({ start: token.start.offset + shift, end: token.end.offset + shift });
    }
  }

  if (block === null) return spans;
  return spans.flatMap((span) => {
    if (span.start >= block.end) return [span];
    if (span.end <= block.end) return [];
    return [{ start: block.end, end: span.end }];
  });
}

/**
 * modes.md 3.7.4: **a content line containing a U+000D not followed by U+000A yields no spans**,
 * "exactly as 3.8.4 step 1 already declines a line containing U+0009". The two line models meet in
 * the block content and do not compose — 3.7.3a step 5 finds a block in a lone-U+000D document, and
 * 3.8.4's LF-only scan then reads the whole of it as one line. Measured, letting it through is not
 * merely inert: marks pair across what were two mapping lines, an unlisted line inside the listed
 * key's scalar takes `fr`'s spacing, and the U+000D itself lands inside a span — which 3.8.4
 * forbids.
 *
 * The decline **drops the spans the content scan produced for that line and does not alter the
 * content the scan is given**. Substituting each lone U+000D for a character 3.8.4 already
 * declines is the shortcut three ports reached for, this one included, and it is measured not
 * equivalent: the substitution moves the character onto a line of its own and can end a value run.
 * Both shapes are pinned as fixtures, and both are decided by what `yaml` mode does with the same
 * characters, since 3.7.4 claims 3.8's scan applies verbatim:
 *
 * - `title: a "b"\nslug: c "d"\n\r` — the content-final U+000D is a blank line joining `slug`'s
 *   value run, so 3.8.6's continuation bail declines `slug`. As a U+0009 it is a line with a tab
 *   in it, not a blank one, the run ends and `slug` converts. `yaml` mode converts `title` only,
 *   in both shipped runtimes measured;
 * - `summary: a\rb\n  title: c -- d\n` — the indented line is inside `summary`'s value run, so
 *   `title` is not a key at all. Substitution ends the run and invents one.
 *
 * **The window runs to the start of the next line, not to the end of this one**, because 3.8.4's
 * own splitter treats a trailing U+000D as a terminator without a U+000A after it — so a block
 * whose single line ends in one looks clean if the terminator is excluded.
 */
function declinedContentRanges(content: string): readonly Span[] {
  const declined: Span[] = [];
  let start = 0;
  while (start < content.length) {
    const lf = content.indexOf("\n", start);
    const next = lf === -1 ? content.length : lf + 1;
    for (let i = start; i < next; i += 1) {
      if (content.charCodeAt(i) === CR && content.charCodeAt(i + 1) !== LF) {
        declined.push({ start, end: next });
        break;
      }
    }
    start = next;
  }
  return declined;
}

/**
 * modes.md 3.7.4, spec 1.7.0. The frontmatter block's own spans, which form a **second text
 * unit**: the pipeline runs over them separately from the body's, so an unbalanced mark in a
 * metadata field can never pair with one in the first paragraph and this option cannot change a
 * byte outside the block.
 *
 * The block is located by `locateFrontmatter` (3.7.3a, spec 1.8.0) rather than by a second parse
 * of the document, which is both what polytypo/polytypo#59 reported and, since 1.8.0, the wrong
 * authority: the scan owns the extent and a parser is measured against it.
 *
 * Spans inside it are taken by the scan of modes.md 3.8 — frontmatter *is* YAML, and specifying it
 * twice is how two implementations of one grammar drift — with `frontmatterKeys` as step 8's key
 * predicate.
 *
 * A TOML block yields nothing, with the option or without it: TOML's quoting is a second grammar
 * this scan does not claim (modes.md §7.13). So does any content line carrying a lone U+000D — see
 * `declinedContentRanges`, which filters what the scan produced rather than changing what it reads.
 */
export function frontmatterSpans(source: string, frontmatterKeys: readonly string[]): Span[] {
  if (frontmatterKeys.length === 0) return [];
  const block = locateFrontmatter(source);
  if (block === null || block.matter === "toml") return [];

  const { contentStart, contentEnd } = block;
  const content = source.slice(contentStart, contentEnd);
  const declined = declinedContentRanges(content);

  return (
    yamlSpans(content, frontmatterKeys)
      // 3.7.4: a span reaching a declined position is dropped whole rather than trimmed.
      .filter((span) => !declined.some((range) => span.start < range.end && range.start < span.end))
      .map((span) => ({ start: span.start + contentStart, end: span.end + contentStart }))
  );
}
