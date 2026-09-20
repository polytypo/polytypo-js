import type { Span } from "./spans.js";

/**
 * spec/rules/modes.md 3.8. `yaml` differs from the other two document modes twice over.
 *
 * It uses **no parser** (3.8.1): two of the five ecosystems' YAML libraries cannot report the
 * source offsets the round-trip guarantee needs, so the scan below is specified rather than
 * delegated and is written the same way in every runtime.
 *
 * And the caller names the keys (3.8.2). YAML is a data format with islands of prose in it — the
 * inverse of HTML and Markdown — and nothing in its syntax separates `description:` from `run:`.
 * A keyless draft of this file rewrote `if !` as `if!` inside a workflow's shell script; there is
 * no content test that would not, because shell and template expressions are written in words.
 *
 * It also **skips by default** — the inverse of 3.6's closed skip list. A construct this scan
 * does not recognise with certainty yields no spans, so the worst outcome of a gap in it is prose
 * left untypeset, never a changed byte.
 *
 * Offsets are UTF-16 indices, like every other mode in this runtime; every character the scan
 * tests is ASCII, so indexing by code unit and indexing by code point agree on all of them.
 */

const TAB = 0x09;
const LF = 0x0a;
const CR = 0x0d;
const SPACE = 0x20;
const BANG = 0x21;
const DQUOTE = 0x22;
const HASH = 0x23;
const PERCENT = 0x25;
const AMPERSAND = 0x26;
const SQUOTE = 0x27;
const STAR = 0x2a;
const PLUS = 0x2b;
const DASH = 0x2d;
const DOT = 0x2e;
const ZERO = 0x30;
const ONE = 0x31;
const NINE = 0x39;
const COLON = 0x3a;
const GREATER = 0x3e;
const LBRACKET = 0x5b;
const BACKSLASH = 0x5c;
const LBRACE = 0x7b;
const PIPE = 0x7c;

interface Line {
  readonly start: number;
  /** Index of the line terminator, or of the end of the source — never inside a span. */
  readonly end: number;
}

/**
 * 3.8.4: a line ends at U+000A, and **a U+000D immediately before it is not part of the line** —
 * it is a terminator like the U+000A itself, so it lies outside every span and comes back
 * untouched. Without that clause a CRLF file behaves differently from the same bytes with LF: the
 * block header reads as `|\r` and is unrecognised, and a plain scalar carries the carriage return
 * inside its span. Five runtimes split lines with five different standard-library calls, so the
 * treatment has to be stated rather than inherited.
 */
function splitLines(source: string): Line[] {
  const lines: Line[] = [];
  let start = 0;
  const endOf = (i: number): number => (i > start && source.charCodeAt(i - 1) === CR ? i - 1 : i);
  for (let i = 0; i < source.length; i += 1) {
    if (source.charCodeAt(i) === LF) {
      lines.push({ start, end: endOf(i) });
      start = i + 1;
    }
  }
  if (start < source.length) lines.push({ start, end: endOf(source.length) });
  return lines;
}

/** Index of the first code unit that is not U+0020, or `line.end` for a blank line. */
function firstNonSpace(source: string, line: Line): number {
  let i = line.start;
  while (i < line.end && source.charCodeAt(i) === SPACE) i += 1;
  return i;
}

function isBlank(source: string, line: Line): boolean {
  return firstNonSpace(source, line) === line.end;
}

function hasTab(source: string, line: Line): boolean {
  for (let i = line.start; i < line.end; i += 1) if (source.charCodeAt(i) === TAB) return true;
  return false;
}

/**
 * 3.8.4 step 3. `---` and `...` at the head of a line, bare or introducing a node: the
 * trailing-content form is declined too, so `--- key: value` never yields a key of `--- key`.
 */
function isDocumentMarker(source: string, from: number, end: number): boolean {
  if (end - from < 3) return false;
  const c = source.charCodeAt(from);
  if (c !== DASH && c !== DOT) return false;
  if (source.charCodeAt(from + 1) !== c || source.charCodeAt(from + 2) !== c) return false;
  return from + 3 === end || source.charCodeAt(from + 3) === SPACE;
}

/** A colon that ends the line or is followed by U+0020 — the only colon YAML reads as an indicator. */
function isIndicatorColon(source: string, j: number, end: number): boolean {
  if (source.charCodeAt(j) !== COLON) return false;
  return j + 1 === end || source.charCodeAt(j + 1) === SPACE;
}

/** A `-` that ends the line or is followed by U+0020 — a block sequence entry marker. */
function isSequenceDash(source: string, j: number, end: number): boolean {
  if (source.charCodeAt(j) !== DASH) return false;
  return j + 1 === end || source.charCodeAt(j + 1) === SPACE;
}

/**
 * The value run of 3.8.4 step 7: every following line that is blank or indented more than the
 * key line. **Those lines are never scanned again** — without that, a multi-line quoted scalar,
 * a multi-line flow collection and a folded plain scalar all leak their continuation lines back
 * into the scan as if they were mappings, and a span can end up holding a scalar's own closing
 * delimiter.
 */
function valueRunEnd(source: string, lines: readonly Line[], li: number, indent: number): number {
  let k = li + 1;
  while (k < lines.length) {
    const next = lines[k] as Line;
    if (!isBlank(source, next) && firstNonSpace(source, next) - next.start <= indent) break;
    k += 1;
  }
  return k;
}

export function yamlSpans(source: string, keys: readonly string[]): Span[] {
  const listed = new Set(keys);
  const lines = splitLines(source);
  const spans: Span[] = [];
  let li = 0;
  while (li < lines.length) li = scanLine(source, lines, li, listed, spans);
  return spans;
}

/** One step of 3.8.4. Returns the index of the next line to scan. */
function scanLine(
  source: string,
  lines: readonly Line[],
  li: number,
  listed: ReadonlySet<string>,
  spans: Span[],
): number {
  const line = lines[li] as Line;
  const skipLine = li + 1;

  // step 1 — blank, or a tab anywhere, which makes indentation undecidable.
  const start = firstNonSpace(source, line);
  if (start === line.end || hasTab(source, line)) return skipLine;
  const indent = start - line.start;

  // steps 2 and 3 — comment, directive, document marker.
  const head = source.charCodeAt(start);
  if (head === HASH || head === PERCENT) return skipLine;
  if (isDocumentMarker(source, start, line.end)) return skipLine;

  // step 4 — block sequence entries are consumed, not skipped; `- - key: v` nests.
  let i = start;
  while (i < line.end && isSequenceDash(source, i, line.end)) {
    i += 2;
    while (i < line.end && source.charCodeAt(i) === SPACE) i += 1;
  }
  if (i >= line.end) return skipLine;

  // step 5 — find the key. A colon NOT followed by U+0020 or the line end is an ordinary key
  // character, so `a:b: v` has the key `a:b`; stating that is what keeps five scanners agreeing.
  const keyStart = i;
  let colon = -1;
  for (let j = i; j < line.end; j += 1) {
    const c = source.charCodeAt(j);
    if (
      c === DQUOTE ||
      c === SQUOTE ||
      c === LBRACE ||
      c === LBRACKET ||
      c === AMPERSAND ||
      c === STAR ||
      c === BANG ||
      c === HASH
    ) {
      return skipLine;
    }
    if (isIndicatorColon(source, j, line.end)) {
      colon = j;
      break;
    }
  }
  if (colon < 0) return skipLine;
  let keyEnd = colon;
  while (keyEnd > keyStart && source.charCodeAt(keyEnd - 1) === SPACE) keyEnd -= 1;
  if (keyEnd <= keyStart) return skipLine;

  // step 6 — an empty value means a nested node, whose lines ARE scanned on their own.
  let v = colon + 1;
  while (v < line.end && source.charCodeAt(v) === SPACE) v += 1;
  if (v >= line.end) return skipLine;

  // step 7 — the line carries an inline value, so its continuation lines belong to that value.
  const next = valueRunEnd(source, lines, li, indent);

  // step 8 — the key must be listed. Checked before the value's form, so an unlisted key costs
  // nothing to decline: this is what makes `run:`, `if:` and `image:` unreachable.
  if (!listed.has(source.slice(keyStart, keyEnd))) return next;

  // step 9 — the scalar form.
  const value = source.charCodeAt(v);
  if (
    value === HASH ||
    value === AMPERSAND ||
    value === STAR ||
    value === BANG ||
    value === LBRACE ||
    value === LBRACKET
  ) {
    return next;
  }
  if (value === PIPE || value === GREATER) {
    blockScalar(source, lines, li, next, indent, v, spans);
    return next;
  }
  if (value === DQUOTE || value === SQUOTE) {
    if (next === li + 1) quotedScalar(source, line, v, spans);
    return next;
  }
  if (next === li + 1) plainScalar(source, line, v, spans);
  return next;
}

/**
 * 3.8.5. One span per non-blank content line, starting after the block's own indentation. The
 * header, the indentation and every line terminator lie outside every span — including the run
 * of line terminators at the end that the chomping indicator governs, which is why `|`, `|-`,
 * `|+`, `>`, `>-` and `>+` are handled identically here.
 */
function blockScalar(
  source: string,
  lines: readonly Line[],
  li: number,
  runEnd: number,
  indent: number,
  v: number,
  spans: Span[],
): void {
  const line = lines[li] as Line;

  // The header: at most one chomping indicator and at most one indentation indicator, in either
  // order, then optional spaces and an optional comment. Anything else is unrecognised.
  let h = v + 1;
  let explicitIndent = 0;
  let chomping = false;
  while (h < line.end) {
    const c = source.charCodeAt(h);
    if ((c === DASH || c === PLUS) && !chomping) {
      chomping = true;
      h += 1;
      continue;
    }
    if (c >= ONE && c <= NINE && explicitIndent === 0) {
      explicitIndent = c - ZERO;
      h += 1;
      continue;
    }
    break;
  }
  while (h < line.end && source.charCodeAt(h) === SPACE) h += 1;
  if (h < line.end && source.charCodeAt(h) !== HASH) return;

  // One definition of the run, and three conditions that make the whole block yield no spans.
  const content: Line[] = [];
  let contentIndent = -1;
  for (let k = li + 1; k < runEnd; k += 1) {
    const next = lines[k] as Line;
    if (isBlank(source, next)) continue; // blank lines belong to the block and yield no span
    if (hasTab(source, next)) return;
    const nextIndent = firstNonSpace(source, next) - next.start;
    if (contentIndent < 0) {
      contentIndent = explicitIndent > 0 ? indent + explicitIndent : nextIndent;
    }
    // An explicit indicator that disagrees with the block as written, or a later line dedented
    // inside it, is ambiguous rather than guessable — bail rather than choose.
    if (nextIndent < contentIndent) return;
    content.push(next);
  }
  if (contentIndent <= 0) return;

  for (const c of content) {
    const from = c.start + contentIndent;
    if (c.end > from) spans.push({ start: from, end: c.end });
  }
}

/**
 * 3.8.6. The span is the content between the quotes. Both bails exist so that source characters
 * and content characters are the same thing, which the offset model of 3.1 requires — the same
 * constraint that makes an HTML character reference an opaque unit in 3.6. No colon test applies
 * here: quoting neutralises the colon, and applying the plain-scalar test would decline
 * `title: "Chapter 1: the beginning"`.
 */
function quotedScalar(source: string, line: Line, v: number, spans: Span[]): void {
  const quote = source.charCodeAt(v);
  let close = -1;
  for (let j = v + 1; j < line.end; j += 1) {
    const c = source.charCodeAt(j);
    if (quote === DQUOTE && c === BACKSLASH) return;
    if (
      quote === SQUOTE &&
      c === SQUOTE &&
      j + 1 < line.end &&
      source.charCodeAt(j + 1) === SQUOTE
    ) {
      return;
    }
    if (c === quote) {
      close = j;
      break;
    }
  }
  if (close < 0) return;

  let after = close + 1;
  while (after < line.end && source.charCodeAt(after) === SPACE) after += 1;
  if (after < line.end && source.charCodeAt(after) !== HASH) return;

  if (close > v + 1) spans.push({ start: v + 1, end: close });
}

/**
 * 3.8.6. In a plain scalar `:` and `#` are still live: U+0020 beside either of them is what turns
 * a scalar into a mapping indicator or a comment, and `dashes` emits U+0020 in every `-spaced`
 * locale. Lifting both out as opaque units leaves the dash token against a boundary marker, which
 * `dashes` declines on its own account — the edge-growth rule of 3.4 is the second net, not the
 * first.
 */
function plainScalar(source: string, line: Line, v: number, spans: Span[]): void {
  // The scalar ends before a trailing comment, so a colon inside that comment is not the
  // scalar's and must not decline it.
  let end = line.end;
  for (let j = v; j < line.end; j += 1) {
    if (source.charCodeAt(j) === HASH && j > v && source.charCodeAt(j - 1) === SPACE) {
      end = j - 1;
      break;
    }
  }
  while (end > v && source.charCodeAt(end - 1) === SPACE) end -= 1;
  if (end <= v) return;

  // Compact nesting is not a value: `key: - item` opens a sequence, and `key: a .:` is a mapping
  // whose key is `a .` — a plain scalar can never contain a colon in that position.
  if (isSequenceDash(source, v, line.end)) return;
  for (let j = v; j < end; j += 1) if (isIndicatorColon(source, j, line.end)) return;

  let segment = v;
  for (let j = v; j <= end; j += 1) {
    if (j === end || source.charCodeAt(j) === COLON || source.charCodeAt(j) === HASH) {
      if (j > segment) spans.push({ start: segment, end: j });
      segment = j + 1;
    }
  }
}
