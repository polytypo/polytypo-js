<p align="center">
  <img src="https://raw.githubusercontent.com/polytypo/polytypo/main/brand/logo/polytypo-lockup-stacked.svg" alt="polytypo" width="260">
</p>

<h1 align="center">polytypo</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/polytypo"><img src="https://img.shields.io/npm/v/polytypo.svg" alt="npm version"></a>
  <a href="https://github.com/polytypo/polytypo-js/actions/workflows/ci.yml"><img src="https://github.com/polytypo/polytypo-js/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://www.npmjs.com/package/polytypo"><img src="https://img.shields.io/npm/dm/polytypo.svg" alt="npm downloads"></a>
  <a href="https://www.jsdelivr.com/package/npm/polytypo"><img src="https://data.jsdelivr.com/v1/package/npm/polytypo/badge" alt="jsDelivr hits"></a>
  <a href="LICENSE"><img src="https://img.shields.io/npm/l/polytypo.svg" alt="License: MIT"></a>
</p>

<p align="center">
  Locale-correct quotes, dashes, ellipses, apostrophes, symbols and no-break spaces —<br>
  one portable spec, designed for byte-identical output across runtimes.
</p>

<p align="center">
  <strong>Try it live, no install: <a href="https://polytypo.dev/">polytypo.dev</a></strong>
</p>

This is the JavaScript/TypeScript implementation. The full spec — all locales, all rules, worked
examples in each — lives in [polytypo/polytypo](https://github.com/polytypo/polytypo). The
[browser playground](https://polytypo.dev/playground/) runs this exact package, compiled to a
browser bundle — paste your own text to try it against any locale before installing anything.

## Install

```sh
npm install polytypo
```

## Usage

```ts
import { transform } from "polytypo/text";

transform(`She said, "it's fine" -- but I wasn't sure...`, { locale: "en-US" });
// She said, “it’s fine”—but I wasn’t sure…
```

Same input, one locale changed — quotes, dash spacing and all follow the target locale, not a
single hardcoded style:

```ts
transform(`Sie sagte: "Alles gut" -- aber ich war mir nicht sicher...`, { locale: "de-DE" });
// Sie sagte: „Alles gut“ – aber ich war mir nicht sicher…
```

Import the entry for the mode you use. Each subpath entry defaults `mode` to itself and loads only
the parsers that mode needs:

| Entry               | Parsers it loads                                              |
| ------------------- | ------------------------------------------------------------- |
| `polytypo/text`     | none                                                          |
| `polytypo/html`     | parse5                                                        |
| `polytypo/markdown` | parse5, micromark and its GFM, frontmatter and MDX extensions |
| `polytypo/yaml`     | none                                                          |
| `polytypo`          | all of the above                                              |

HTML and Markdown are first-class modes, not an afterthought — tags, attributes and fenced code
are left alone; only text content is touched:

```ts
import { transform } from "polytypo/html";

transform(`<a title="test... wait">Wait... she said "go on."</a>`, { locale: "en-US" });
// <a title="test... wait">Wait… she said “go on.”</a>
```

`yaml` mode is the one that asks something of you, and it asks for a reason. YAML is a data format
with prose in some of it, so you name the keys whose values are prose; there is no default and no
guess:

```ts
import { transform } from "polytypo/yaml";

transform("summary: Rates -- all of them...\nrun: git diff -- a--b\n", {
  locale: "en-US",
  keys: ["summary"],
});
// summary: Rates—all of them…
// run: git diff -- a--b
```

Nothing in YAML's syntax separates a sentence from a shell script: `description` holds one and
`run` holds the other, spelled identically. Without `keys` the same document comes back with
`if !` rewritten as `if!`. Quoting, indentation, anchors and a block scalar's chomping indicator
are never decoded and rewritten — the file is located, not re-emitted — so the trailing newlines
of a `|+` block come back exactly as you wrote them.

In `markdown` mode the skipped regions are the dialect's own structural ones, not whatever looks
like code. CommonMark counts an indented block as code at **four** spaces; at two it is an ordinary
paragraph, so a JSON sample indented by two comes back with curly quotes — valid JSON in, invalid
JSON out, and nothing in the return value says so. MDX has no indented code blocks at all, so there
even four spaces is prose and a brace in it is a JSX expression: the same sample throws
`POLYTYPO_MALFORMED_INPUT` instead. A fence or a code span is the one marker that means _code_ in
both dialects.

Frontmatter is skipped whole by default, delimiters included — it is a machine-read block, and
`fr` would put a narrow no-break space in front of the colon of every field in it. On a site whose
frontmatter carries the headline that leaves the most visible string on the page untouched, so name
the keys you want processed:

```ts
import { transform } from "polytypo/markdown";

transform(
  `---\ntitle: He said "hello" once\nslug: "he-said-hello"\n---\n\nThe body was typeset all along.\n`,
  { locale: "en-US", dialect: "commonmark", frontmatterKeys: ["title"] },
);
// ---
// title: He said “hello” once
// slug: "he-said-hello"
// ---
//
// The body was typeset all along.
```

Without the option nothing in the block changes, and a key you do not name never does. The block is
read with the same scanner `yaml` mode uses, so it refuses the same constructs — a single-quoted
scalar containing `''` among them, which is how an apostrophe is written inside single quotes, so
`title: 'It''s a test'` comes back untouched. Double-quoted and plain scalars have no such limit.
The block is also processed separately from the body, which shows up in exactly one place: an
unbalanced quotation mark in `title` cannot pair with a mark in your first paragraph.

`analyze()` runs the same pipeline and reports what it would do instead of doing it — one record
per edit, each with the rule that made it and code-point offsets into the input you passed (into
the **document**, in `html`, `markdown` and `yaml` mode, not into a span):

```ts
import { analyze } from "polytypo";

analyze(`Wait... "really"?`, { locale: "en-US" });
// [ { ruleId: "ellipsis", start: 4, end: 7, before: "...", after: "…" },
//   { ruleId: "quotes",   start: 8, end: 9, before: `"`,   after: "“" }, … ]
```

It is a report, not a patch. The list is empty exactly when `transform` would return the input
unchanged, and every `ruleId` is a rule that was enabled for that call — but two rules may touch
the same original range (French `spaces` deletes the space before `:` and `nbsp` puts a no-break
one back), so replaying the list is not guaranteed to reproduce the output. Call `transform` for
the text. Full contract: `spec/rules/analyze.md`.

The aggregate `polytypo` entry defaults `mode` to `"text"` and is the one to use when the mode is
chosen at runtime. `locale` has no default anywhere and must always be passed explicitly — there is
no silent fallback to English.

## Licence

MIT. See [LICENSE](LICENSE).
