# polytypo

[![npm version](https://img.shields.io/npm/v/polytypo.svg)](https://www.npmjs.com/package/polytypo)
[![CI](https://github.com/polytypo/polytypo-js/actions/workflows/ci.yml/badge.svg)](https://github.com/polytypo/polytypo-js/actions/workflows/ci.yml)
[![npm downloads](https://img.shields.io/npm/dm/polytypo.svg)](https://www.npmjs.com/package/polytypo)
[![jsDelivr hits](https://data.jsdelivr.com/v1/package/npm/polytypo/badge)](https://www.jsdelivr.com/package/npm/polytypo)
[![License: MIT](https://img.shields.io/npm/l/polytypo.svg)](LICENSE)

Locale-correct quotes, dashes, ellipses, apostrophes, symbols and no-break spaces — one portable
spec, designed for byte-identical output across runtimes.

This is the JavaScript/TypeScript implementation. The full spec — all locales, all rules, worked
examples in each — lives at [polytypo.dev](https://polytypo.dev/) and in
[polytypo/polytypo](https://github.com/polytypo/polytypo). **No install needed to try it: paste
your own text into the [browser playground](https://polytypo.dev/playground/).**

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
