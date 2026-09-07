# polytypo

Locale-correct quotes, dashes, ellipses, apostrophes, symbols and no-break spaces — one portable
spec, designed for byte-identical output across runtimes.

This is the JavaScript/TypeScript implementation. The spec, conformance fixtures, and full
documentation live at [polytypo.dev](https://polytypo.dev/) and in
[polytypo/polytypo](https://github.com/polytypo/polytypo).

## Install

```sh
npm install polytypo
```

## Usage

```ts
import { transform } from "polytypo";

transform(`She said, "it's fine."`, { locale: "en-US" });
// She said, “it’s fine.”
```

Subpath entries (`polytypo/text`, `polytypo/html`, `polytypo/markdown`) exclude the parser
dependencies the other modes don't need. `mode` defaults to `"text"`; `locale` has no default and
must be passed explicitly.

## Licence

MIT. See [LICENSE](LICENSE).
