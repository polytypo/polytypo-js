// Pure(-ish) spec-tag verification gate for the release workflow (docs/ROADMAP.md M5,
// docs/REPOSITORY_SPLIT_AND_SPEC_SYNC.md section 4.4's spec-tag integrity gates, scoped down to
// the minimal check this stage needs). Mirrors scripts/lib/release-tag.mjs's separation on
// purpose: the *only* place spec/VERSION's format is validated and the canonical spec tag name is
// derived is here, never re-derived or re-validated anywhere else, so the package-tag check and
// this check can never quietly diverge on what "the correct spec tag" means.
//
// The two-tag v1 release contract this enforces (docs/AUDIT_REMEDIATION_AND_RELEASE_PLAN.md
// section 8.4, docs/ROADMAP.md M5):
//   1. An operator creates canonical spec tag `spec-v<spec/VERSION>` on `polytypo/polytypo` and
//      pushes it first — manually, for v1; this module never creates, moves, fetches, or pushes
//      a tag, it only reads what already exists.
//   2. The operator creates and pushes npm package tag `v<package.json version>` on this repo —
//      this is what actually triggers release.yml (scripts/lib/release-tag.mjs already gates on
//      that tag; this module gates on the *other* one, independently).
//   3. Before building or publishing anything, release.yml must prove step 1 actually happened
//      for the spec version this release vendors. This module is that proof.
//
// Post-split (docs/REPOSITORY_SPLIT_AND_SPEC_SYNC.md section 4.4): the two tags now live in two
// different, historically unrelated repositories — `spec-v*` in `polytypo/polytypo` (canonical),
// `v*` in `polytypo/polytypo-js` (this repo). Pre-split, both tags named the exact same commit
// (one repository), so this module used to compare commit SHAs for equality. That comparison is
// meaningless post-split: `git filter-repo` rewrote every tree, so no commit in this repo's
// history is ever the same git object as a commit in canonical's history, by construction — the
// check would fail on every legitimate release, not just a skipped freeze step. What the module
// verifies instead, absent the full content-hash manifest (section 3, not yet implemented): the
// canonical tag `spec-v<spec/VERSION>` exists in `canonicalRepo`. Since the tag name is derived
// from this checkout's own vendored `spec/VERSION`, existence already proves an operator minted
// that exact release tag on canonical before this one — the property this gate exists to enforce
// is "the freeze step wasn't skipped," and existence-checking preserves that fail-closed
// behaviour. Resolved over the GitHub REST API — public and unauthenticated, since
// polytypo/polytypo is a public repository.

/** Project policy (deliberately strict, matching how spec/VERSION has always been written:
 * "0.1.0" .. "1.0.0", never a pre-release or build-metadata suffix): exactly MAJOR.MINOR.PATCH,
 * each component either "0" or a digit string with no leading zero. Pre-release (`-foo`) and
 * build-metadata (`+foo`) suffixes are valid SemVer in general but are rejected here on purpose —
 * a canonical spec version is a plain release number, and accepting more would let a spec tag
 * silently point at something the rest of the spec-versioning contract (scripts/validate-spec.mjs,
 * spec/schema/fixtures.schema.json's "spec" field) was never designed to compare against. */
const STRICT_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** @param {string} raw - spec/VERSION's file contents, not yet trimmed.
 * @returns {{ok: true, version: string} | {ok: false, reason: string}} */
export function parseStrictSpecVersion(raw) {
  const version = typeof raw === "string" ? raw.trim() : "";
  if (version === "") {
    return { ok: false, reason: "spec/VERSION is empty (after trimming whitespace)." };
  }
  if (!STRICT_SEMVER.test(version)) {
    return {
      ok: false,
      reason:
        `spec/VERSION content "${version}" is not a strict MAJOR.MINOR.PATCH release version — ` +
        `pre-release suffixes (-foo), build-metadata suffixes (+foo), leading zeros, and any ` +
        `other form are rejected by this project's spec-tag policy.`,
    };
  }
  return { ok: true, version };
}

/** The one place the canonical spec tag name is derived from a validated spec version — never
 * accepted as a caller-supplied string, so a caller cannot ask this module to verify an arbitrary
 * tag name that happens not to match spec/VERSION. */
export function deriveSpecTagName(specVersion) {
  return `spec-v${specVersion}`;
}

/** Resolves `tagName` in `ownerRepo` (e.g. "polytypo/polytypo") to the commit SHA it names, via
 * the public GitHub REST API — no auth token, since the canonical repo is public. An annotated
 * tag's ref points at a tag *object*, not a commit, so it needs one extra dereference; a
 * lightweight tag's ref already points directly at the commit. Returns `{ok: true, commit}` on
 * success, `{ok: false, reason}` on anything else (tag not found, network error, unexpected
 * response shape) — this function never throws, so a transient API failure fails the release gate
 * closed rather than crashing the workflow step uninformatively.
 *
 * @param {string} tagName
 * @param {string} ownerRepo - "owner/repo", e.g. "polytypo/polytypo".
 * @param {(input: string|URL|Request, init?: object) => Promise<{ok: boolean, status: number, json: () => Promise<unknown>}>} fetchImpl - injectable for tests; defaults to the global `fetch`.
 */
export async function resolveCanonicalTagCommit(tagName, ownerRepo, fetchImpl = fetch) {
  const refUrl = `https://api.github.com/repos/${ownerRepo}/git/refs/tags/${encodeURIComponent(tagName)}`;
  let refResponse;
  try {
    refResponse = await fetchImpl(refUrl, { headers: { Accept: "application/vnd.github+json" } });
  } catch (error) {
    return {
      ok: false,
      reason: `Could not reach the GitHub API for ${ownerRepo}: ${error.message}`,
    };
  }
  if (refResponse.status === 404) {
    return { ok: false, reason: `Tag "${tagName}" does not exist in ${ownerRepo}.` };
  }
  if (!refResponse.ok) {
    return {
      ok: false,
      reason: `GitHub API returned ${refResponse.status} resolving tag "${tagName}" in ${ownerRepo}.`,
    };
  }
  const ref = await refResponse.json();
  const object = ref?.object;
  if (!object || typeof object.sha !== "string" || typeof object.type !== "string") {
    return {
      ok: false,
      reason: `Unexpected GitHub API response resolving tag "${tagName}" in ${ownerRepo}.`,
    };
  }
  if (object.type === "commit") {
    return { ok: true, commit: object.sha };
  }
  if (object.type !== "tag") {
    return {
      ok: false,
      reason: `Tag "${tagName}" in ${ownerRepo} points at unexpected object type "${object.type}", not a commit or annotated tag.`,
    };
  }
  // Annotated tag: dereference the tag object to the commit it targets.
  const tagUrl = `https://api.github.com/repos/${ownerRepo}/git/tags/${object.sha}`;
  let tagResponse;
  try {
    tagResponse = await fetchImpl(tagUrl, { headers: { Accept: "application/vnd.github+json" } });
  } catch (error) {
    return {
      ok: false,
      reason: `Could not reach the GitHub API dereferencing tag "${tagName}": ${error.message}`,
    };
  }
  if (!tagResponse.ok) {
    return {
      ok: false,
      reason: `GitHub API returned ${tagResponse.status} dereferencing annotated tag "${tagName}" in ${ownerRepo}.`,
    };
  }
  const tagObject = await tagResponse.json();
  const targetSha = tagObject?.object?.sha;
  if (typeof targetSha !== "string") {
    return {
      ok: false,
      reason: `Unexpected GitHub API response dereferencing annotated tag "${tagName}" in ${ownerRepo}.`,
    };
  }
  return { ok: true, commit: targetSha };
}

/**
 * Verifies that the canonical spec tag derived from `specVersionRaw` exists in `canonicalRepo`
 * (read via the GitHub API, never a local git operation — the tag lives in a different,
 * historically unrelated repository than this one). Existence is the whole check: see this
 * module's header comment for why commit-SHA equality across the two repos is not a meaningful
 * property to verify. Never creates, moves, fetches, or pushes anything.
 *
 * @param {object} opts
 * @param {string} opts.specVersionRaw - spec/VERSION's raw file contents.
 * @param {(input: string|URL|Request, init?: object) => Promise<{ok: boolean, status: number, json: () => Promise<unknown>}>} [opts.fetchImpl] - injectable fetch seam, for tests only.
 * @param {string} [opts.canonicalRepo] - "owner/repo" holding the canonical spec tag.
 * @returns {Promise<{ok: true, tagName: string, commit: string} | {ok: false, reason: string}>}
 */
export async function verifySpecTag({
  specVersionRaw,
  fetchImpl = fetch,
  canonicalRepo = "polytypo/polytypo",
}) {
  const parsed = parseStrictSpecVersion(specVersionRaw);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };

  const tagName = deriveSpecTagName(parsed.version);

  const tagResult = await resolveCanonicalTagCommit(tagName, canonicalRepo, fetchImpl);
  if (!tagResult.ok) {
    return {
      ok: false,
      reason:
        `${tagResult.reason} It must be created and pushed by an operator to ${canonicalRepo} ` +
        `before the npm package tag.`,
    };
  }

  return { ok: true, tagName, commit: tagResult.commit };
}
