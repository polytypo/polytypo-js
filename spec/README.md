# Vendored spec subset

This directory is a manually-synced copy of the subset of `polytypo/polytypo`'s canonical `spec/`
that this repository's build and test suite read at runtime: `locales/`, `fixtures/`,
`rules/order.json`, `VERSION`, `UNICODE`. It is **not** the canonical spec — normative prose
(`rules/*.md`), the JSON Schemas, and `validate-spec.mjs` all live only in `polytypo/polytypo`.

Editing a file here does not change the spec; it only drifts this copy from canonical. When
canonical's `spec/` changes, re-copy the affected files here. How this vendoring will work
long-term (submodule, per-ecosystem spec package, or something else) is an open decision tracked
in `polytypo/polytypo`'s `docs/ROADMAP.md`; this is the interim, manually-synced form.
