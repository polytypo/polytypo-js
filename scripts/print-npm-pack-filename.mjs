#!/usr/bin/env node
// Prints the filename `npm pack --json` reports, from its stdout passed as argv[2]. See
// scripts/lib/npm-pack-json.mjs for why this can't be a plain `JSON.parse`. Used by
// .github/workflows/release.yml's "Pack the release tarball" step.
import { parseNpmPackJson } from "./lib/npm-pack-json.mjs";

const packJsonStdout = process.argv[2];
console.log(parseNpmPackJson(packJsonStdout)[0].filename);
