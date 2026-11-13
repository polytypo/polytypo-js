import { parse, parseFragment } from "parse5";
import type { DefaultTreeAdapterMap } from "parse5";
import { wrapParserErrors } from "./parse-error.js";
import type { Span } from "./spans.js";

type Node = DefaultTreeAdapterMap["node"];
type ParentNode = DefaultTreeAdapterMap["parentNode"];

/**
 * spec/rules/modes.md 3.6, exhaustive and **closed**: extending it is a spec change, not an
 * implementation decision. `svg` and `math` are here because in MathML a quotation mark, a
 * hyphen and a prime are operators and identifiers — substituting a curly glyph changes what
 * the expression means. Everything not listed is processable, **including unknown and custom
 * elements**: guessing from a tag name is exactly the heuristic that diverges across runtimes.
 */
const SKIPPED_ELEMENTS: ReadonlySet<string> = new Set([
  "code",
  "pre",
  "kbd",
  "samp",
  "var",
  "script",
  "style",
  "textarea",
  "svg",
  "math",
]);

export function isSkippedElement(tagName: string): boolean {
  return SKIPPED_ELEMENTS.has(tagName);
}

const AMPERSAND = 0x26;
const SEMICOLON = 0x3b;
const HASH = 0x23;
const LOWER_X = 0x78;
const UPPER_X = 0x58;

/** Longest named reference in the WHATWG table is 32 characters; the guard is a bound, not a rule. */
const MAX_REFERENCE_BODY = 34;

function isAsciiDigit(unit: number): boolean {
  return unit >= 0x30 && unit <= 0x39;
}

function isAsciiHexDigit(unit: number): boolean {
  return isAsciiDigit(unit) || (unit >= 0x61 && unit <= 0x66) || (unit >= 0x41 && unit <= 0x46);
}

function isAsciiAlphanumeric(unit: number): boolean {
  return isAsciiDigit(unit) || (unit >= 0x61 && unit <= 0x7a) || (unit >= 0x41 && unit <= 0x5a);
}

/**
 * The end offset of a well-formed character reference starting at `at`, or -1. A bare `&` that a
 * parser would repair is deliberately **not** treated as a reference: it stays inside the span,
 * where no rule can emit or delete it, rather than manufacturing a boundary that suppresses
 * conversions around it.
 */
function characterReferenceEnd(source: string, at: number, limit: number): number {
  if (source.charCodeAt(at) !== AMPERSAND) return -1;
  let i = at + 1;
  if (i >= limit) return -1;

  if (source.charCodeAt(i) === HASH) {
    i += 1;
    const unit = i < limit ? source.charCodeAt(i) : -1;
    const hex = unit === LOWER_X || unit === UPPER_X;
    if (hex) i += 1;
    const digitsAt = i;
    while (
      i < limit &&
      (hex ? isAsciiHexDigit(source.charCodeAt(i)) : isAsciiDigit(source.charCodeAt(i)))
    ) {
      i += 1;
    }
    if (i === digitsAt) return -1;
    return i < limit && source.charCodeAt(i) === SEMICOLON ? i + 1 : -1;
  }

  const nameAt = i;
  while (
    i < limit &&
    i - nameAt < MAX_REFERENCE_BODY &&
    isAsciiAlphanumeric(source.charCodeAt(i))
  ) {
    i += 1;
  }
  if (i === nameAt) return -1;
  return i < limit && source.charCodeAt(i) === SEMICOLON ? i + 1 : -1;
}

/**
 * modes.md 3.6: every character reference is skipped as an **opaque unit**, and a text node
 * containing one is split into spans around it. That is the only way `&nbsp;` survives as
 * `&nbsp;` instead of becoming a literal U+00A0 on the way out.
 */
export function splitCharacterReferences(source: string, start: number, end: number): Span[] {
  const spans: Span[] = [];
  let cursor = start;
  let i = start;
  while (i < end) {
    if (source.charCodeAt(i) === AMPERSAND) {
      const stop = characterReferenceEnd(source, i, end);
      if (stop > 0) {
        if (i > cursor) spans.push({ start: cursor, end: i });
        cursor = stop;
        i = stop;
        continue;
      }
    }
    i += 1;
  }
  if (end > cursor) spans.push({ start: cursor, end });
  return spans;
}

function isParent(node: Node): node is ParentNode {
  return "childNodes" in node;
}

/**
 * modes.md 3.6 (spec 1.23.0): a text node of only U+0009, U+000A, U+000C, U+000D and U+0020 that
 * holds a line break is not a span, so the gap around it carries the raw line break and 3.2
 * picks the line marker. Pretty-printed markup then reads as `text` mode reads the same lines.
 */
function isLineBreakWhitespace(source: string, start: number, end: number): boolean {
  let hasLineBreak = false;
  for (let i = start; i < end; i += 1) {
    const c = source.charCodeAt(i);
    if (c === 0x0a || c === 0x0c || c === 0x0d) hasLineBreak = true;
    else if (c !== 0x09 && c !== 0x20) return false;
  }
  return hasLineBreak;
}

const LESS_THAN = 0x3c;
const SOLIDUS = 0x2f;
const GREATER_THAN = 0x3e;
const EQUALS = 0x3d;

function isAsciiAlpha(unit: number): boolean {
  return (unit >= 0x41 && unit <= 0x5a) || (unit >= 0x61 && unit <= 0x7a);
}

function isTagSpace(unit: number): boolean {
  return unit === 0x09 || unit === 0x0a || unit === 0x0c || unit === 0x0d || unit === 0x20;
}

/**
 * The offset just past the tag that starts at `at`, or -1 when no tag starts there. Follows the
 * HTML tokenizer: `<` plus a letter, `</` plus a letter, or `</>`. A quote opens a value only in
 * the before-attribute-value state, reached by an `=` that follows an attribute name; an `=` that
 * begins a name, or sits inside an unquoted value, is data.
 */
function tagEnd(source: string, at: number, limit: number): number {
  if (source.charCodeAt(at) !== LESS_THAN) return -1;
  let i = at + 1;
  if (i >= limit) return -1;
  if (source.charCodeAt(i) === SOLIDUS) {
    i += 1;
    if (i >= limit) return -1;
    if (source.charCodeAt(i) === GREATER_THAN) return i + 1;
  }
  if (!isAsciiAlpha(source.charCodeAt(i))) return -1;
  // tag name
  while (i < limit) {
    const c = source.charCodeAt(i);
    if (isTagSpace(c) || c === SOLIDUS || c === GREATER_THAN) break;
    i += 1;
  }
  while (i < limit) {
    // before attribute name
    let c = source.charCodeAt(i);
    if (isTagSpace(c) || c === SOLIDUS) {
      i += 1;
      continue;
    }
    if (c === GREATER_THAN) return i + 1;
    // attribute name: an `=` first in the name is part of it
    i += 1;
    while (i < limit) {
      c = source.charCodeAt(i);
      if (isTagSpace(c) || c === SOLIDUS || c === GREATER_THAN || c === EQUALS) break;
      i += 1;
    }
    // after attribute name
    while (i < limit && isTagSpace(source.charCodeAt(i))) i += 1;
    if (i >= limit) return -1;
    c = source.charCodeAt(i);
    if (c === GREATER_THAN) return i + 1;
    if (c !== EQUALS) continue;
    // before attribute value
    i += 1;
    while (i < limit && isTagSpace(source.charCodeAt(i))) i += 1;
    if (i >= limit) return -1;
    c = source.charCodeAt(i);
    if (c === GREATER_THAN) return i + 1;
    if (c === 0x22 || c === 0x27) {
      const close = source.indexOf(c === 0x22 ? '"' : "'", i + 1);
      if (close === -1 || close >= limit) return -1;
      i = close + 1;
      continue;
    }
    while (i < limit) {
      c = source.charCodeAt(i);
      if (isTagSpace(c) || c === GREATER_THAN) break;
      i += 1;
    }
  }
  return -1;
}

/**
 * modes.md 3.6 (spec 1.23.1): a tag the parser ignores is still a tag in the source, and parse5
 * merges the text on either side of it into one node. Splitting the run at every tag-shaped token
 * keeps the tag outside every span and puts it in the gap, where 3.2 chooses the marker.
 */
function textPieces(source: string, start: number, end: number): Array<[number, number]> {
  const pieces: Array<[number, number]> = [];
  let cursor = start;
  let i = start;
  while (i < end) {
    if (source.charCodeAt(i) === LESS_THAN) {
      const stop = tagEnd(source, i, end);
      if (stop > 0) {
        if (i > cursor) pieces.push([cursor, i]);
        cursor = stop;
        i = stop;
        continue;
      }
    }
    i += 1;
  }
  if (end > cursor) pieces.push([cursor, end]);
  return pieces;
}

// Their text is character data, not markup: `<` begins no tag inside them (HTML tokenizer RCDATA,
// RAWTEXT and PLAINTEXT states), so textPieces must not look for one.
const TEXT_ONLY_PARENTS = new Set([
  "title",
  "xmp",
  "iframe",
  "noembed",
  "noframes",
  "noscript",
  "plaintext",
]);

function collect(node: Node, source: string, spans: Span[], isTextOnly = false): void {
  if (node.nodeName === "#text") {
    const location = node.sourceCodeLocation;
    if (location === undefined || location === null) return;
    const pieces = isTextOnly
      ? ([[location.startOffset, location.endOffset]] as Array<[number, number]>)
      : textPieces(source, location.startOffset, location.endOffset);
    for (const [from, to] of pieces) {
      if (isLineBreakWhitespace(source, from, to)) continue;
      for (const span of splitCharacterReferences(source, from, to)) spans.push(span);
    }
    return;
  }

  // Comments, doctype and processing instructions never contribute a span (modes.md 3.6).
  if (node.nodeName === "#comment" || node.nodeName === "#documentType") return;

  if ("tagName" in node && isSkippedElement(node.tagName)) return;

  // A `template`'s children live in a separate document fragment; `template` is not skipped.
  if (node.nodeName === "template" && "content" in node) {
    collect(node.content, source, spans);
    return;
  }

  if (!isParent(node)) return;
  const textOnly = "tagName" in node && TEXT_ONLY_PARENTS.has(node.tagName);
  for (const child of node.childNodes) collect(child, source, spans, textOnly);
}

/**
 * Locate the processable spans of an HTML document. The tree is used only to find offsets and is
 * then discarded — modes.md 4 forbids reserialisation, which is what makes attribute quoting,
 * self-closing forms, entity spelling, tag case and malformed-input recovery preserved by
 * construction rather than by effort.
 */
export function htmlSpans(source: string): Span[] {
  const document = wrapParserErrors("HTML", () => parse(source, { sourceCodeLocationInfo: true }));
  const spans: Span[] = [];
  collect(document, source, spans);
  return spans;
}

/** The same, for a fragment: used for HTML blocks embedded in markdown (modes.md 3.7). */
export function htmlFragmentSpans(source: string, offset: number): Span[] {
  const fragment = wrapParserErrors("HTML", () =>
    parseFragment(source, { sourceCodeLocationInfo: true }),
  );
  const spans: Span[] = [];
  collect(fragment, source, spans);
  return offset === 0
    ? spans
    : spans.map((span) => ({ start: span.start + offset, end: span.end + offset }));
}
