#!/usr/bin/env node
// CLI wrapper around scripts/lib/spec-tag.mjs, used by .github/workflows/release.yml's verify
// job. Reads spec/VERSION from this checkout (the vendored copy — see spec/README.md) and derives
// the canonical spec tag name from it. The canonical spec tag itself is resolved over the GitHub
// API against polytypo/polytypo, never this checkout — see scripts/lib/spec-tag.mjs for why
// existence, not commit-SHA equality, is the property this checks post-split. Exits non-zero with
// a GitHub Actions `::error::` annotation on any failure — missing spec tag, malformed
// spec/VERSION, or an unreachable GitHub API.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { verifySpecTag } from "./lib/spec-tag.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const specVersionRaw = await readFile(path.join(ROOT, "spec", "VERSION"), "utf8");

console.log(`spec/VERSION: ${specVersionRaw.trim()}`);

const result = await verifySpecTag({ specVersionRaw });
if (!result.ok) {
  console.error(`::error::${result.reason}`);
  process.exit(1);
}

console.log(
  `ok: canonical spec tag "${result.tagName}" exists in polytypo/polytypo (commit ${result.commit}).`,
);
