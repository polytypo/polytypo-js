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

function collect(node: Node, source: string, spans: Span[]): void {
  if (node.nodeName === "#text") {
    const location = node.sourceCodeLocation;
    if (location === undefined || location === null) return;
    if (isLineBreakWhitespace(source, location.startOffset, location.endOffset)) return;
    for (const span of splitCharacterReferences(source, location.startOffset, location.endOffset)) {
      spans.push(span);
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
  for (const child of node.childNodes) collect(child, source, spans);
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
