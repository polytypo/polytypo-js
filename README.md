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
import { transform } from "polytypo";

transform(`She said, "it's fine" -- but I wasn't sure...`, { locale: "en-US" });
// She said, “it’s fine”—but I wasn’t sure…
```

Same input, one locale changed — quotes, dash spacing and all follow the target locale, not a
single hardcoded style:

```ts
transform(`Sie sagte: "Alles gut" -- aber ich war mir nicht sicher...`, { locale: "de-DE" });
// Sie sagte: „Alles gut“ – aber ich war mir nicht sicher…
```

HTML and Markdown are first-class modes, not an afterthought — tags, attributes and fenced code
are left alone; only text content is touched:

```ts
import { transform } from "polytypo/html";

transform(`<a title="test... wait">Wait... she said "go on."</a>`, { locale: "en-US" });
// <a title="test... wait">Wait… she said “go on.”</a>
```

Subpath entries (`polytypo/text`, `polytypo/html`, `polytypo/markdown`) exclude the parser
dependencies the other modes don't need, and each defaults `mode` to itself. The aggregate
`polytypo` entry defaults `mode` to `"text"`; `locale` has no default anywhere and must always be
passed explicitly — there is no silent fallback to English.

## Licence

MIT. See [LICENSE](LICENSE).
