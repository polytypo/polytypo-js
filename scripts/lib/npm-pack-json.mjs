// `npm pack --json`'s manifest is always the last thing npm itself writes to stdout — but this
// package has a "prepare" script (needed so a git-dependency install produces dist/), and npm
// runs "prepare" as part of `pack`/`publish` regardless of --ignore-scripts. That reruns
// `npm run build`, and the build tools it shells out to (tsup, scripts/gen-locales.mjs) write
// their own progress lines to the same inherited stdout before npm's JSON is emitted. Rather than
// silence every current and future build tool's own logging, this extracts the manifest from
// whatever precedes it: `JSON.parse` is only ever handed the text from the last line that is
// exactly "[" onward, since npm emits its manifest once, at the very end.
export function parseNpmPackJson(stdout) {
  const marker = stdout.lastIndexOf("\n[");
  const jsonText = marker === -1 ? stdout : stdout.slice(marker + 1);
  return JSON.parse(jsonText);
}
