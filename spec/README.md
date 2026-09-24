# Vendored spec subset

This directory is a manually-synced copy of a subset of `polytypo/polytypo`'s canonical `spec/`:
`locales/`, `fixtures/`, the whole of `rules/`, `VERSION` and `UNICODE`. Code and tests here read
only part of that — the locale and fixture data, `rules/order.json`, and `rules/dashes.md` (parsed
by `tests/rules/dashes-doc-ownership.test.ts`); the other twelve rule documents are carried as the
normative prose for the behaviour the data drives, next to the data. It is **not** the canonical
spec: the JSON Schemas and `validate-spec.mjs` live only in `polytypo/polytypo`, and so does the
authority — a change starts there and arrives here by re-copying, never the other way round.

Editing a file here does not change the spec; it only drifts this copy from canonical. When
canonical's `spec/` changes, re-copy the affected files here.

CI checks that it was done. `scripts/check-vendored-spec.sh` compares every file in this
directory against canonical `polytypo/polytypo` at tag `spec-v` + this directory's own
`VERSION`, and fails on any difference. Three details. The files this repository authors
itself are listed in `.not-canonical` and skipped — and a listed path that canonical *does*
have is an error, so that list cannot be used to keep a forked copy of a canonical file. A
`locales/*.json` file is compared in full when it carries its `sources` array, and against
canonical minus that array when it does not, which is the shipped form three of the five
runtimes vendor; the script reads which case it is off the file rather than being told. And a
file here with no canonical counterpart is a failure, so a canonical rename cannot pass
unnoticed. Completeness is deliberately not checked — each runtime vendors its own subset,
and the subsets differ.

Before that check existed, this half of the tree went stale unnoticed in four of the five
ports at once: the data half is proved by the test suite, and nothing at all read the prose.
See `polytypo/polytypo` issue #56. How this vendoring will work
long-term (submodule, per-ecosystem spec package, or something else) is an open decision tracked
in `polytypo/polytypo`'s `docs/ROADMAP.md`; this is the interim, manually-synced form.

## `locales/*.json` here keep their `sources`, and the shipped copy does not

These files are a build input, not a shipped artifact, so the citations cost nothing here and are
worth having next to the data they justify. The generated/installed copy drops them: no rule reads
the citations, and they are 94% of the locale payload by raw bytes (193 KB of 206 KB, against 13 KB
of everything the engine actually consults). See the generator for exactly where that happens.
