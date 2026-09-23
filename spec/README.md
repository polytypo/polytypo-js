# Vendored spec subset

This directory is a manually-synced copy of the subset of `polytypo/polytypo`'s canonical `spec/`
that this repository's build and test suite read at runtime: `locales/`, `fixtures/`,
`rules/order.json`, `rules/dashes.md` (parsed by `tests/rules/dashes-doc-ownership.test.ts`),
`VERSION`, `UNICODE`. It is **not** the canonical spec — the rest of the normative prose, the
JSON Schemas, and `validate-spec.mjs` all live only in `polytypo/polytypo`.

Editing a file here does not change the spec; it only drifts this copy from canonical. When
canonical's `spec/` changes, re-copy the affected files here. How this vendoring will work
long-term (submodule, per-ecosystem spec package, or something else) is an open decision tracked
in `polytypo/polytypo`'s `docs/ROADMAP.md`; this is the interim, manually-synced form.

## `locales/*.json` here keep their `sources`, and the shipped copy does not

These files are a build input, not a shipped artifact, so the citations cost nothing here and are
worth having next to the data they justify. The generated/installed copy drops them: no rule reads
the citations, and they are 94% of the locale payload by raw bytes (193 KB of 206 KB, against 13 KB
of everything the engine actually consults). See the generator for exactly where that happens.
