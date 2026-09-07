// Exercises scripts/lib/spec-tag.mjs — the canonical spec-tag half of the two-tag release
// contract (docs/ROADMAP.md M5, docs/REPOSITORY_SPLIT_AND_SPEC_SYNC.md section 4.4). Since the
// split, the canonical `spec-v*` tag lives in a different repository (polytypo/polytypo) than
// this one, so it is resolved over the GitHub API, not local git — these tests use an injected
// `fetchImpl` stub, never a real network call. The release commit itself (`v*`, this repository's
// own tag) is still resolved via a local `run` stub, exactly as before. A final describe block
// asserts on the real .github/workflows/release.yml text.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  deriveSpecTagName,
  parseStrictSpecVersion,
  resolveCanonicalTagCommit,
  verifySpecTag,
} from "../../scripts/lib/spec-tag.mjs";
import { findContextExpressionsInRunBlocks } from "../../scripts/lib/workflow-shell-safety.mjs";

/** Builds a `fetchImpl` stub returning canned Response-like objects keyed by exact URL. */
function stubFetch(responses: Record<string, { status: number; body: unknown }>) {
  return async (url: string | URL | Request) => {
    const entry = responses[String(url)];
    if (!entry) throw new Error(`unexpected fetch: ${String(url)}`);
    return {
      ok: entry.status >= 200 && entry.status < 300,
      status: entry.status,
      json: async () => entry.body,
    };
  };
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("scripts/lib/spec-tag.mjs — parseStrictSpecVersion()", () => {
  it("accepts a bare MAJOR.MINOR.PATCH version", () => {
    expect(parseStrictSpecVersion("1.0.0")).toEqual({ ok: true, version: "1.0.0" });
  });

  it("trims surrounding whitespace/newlines, as spec/VERSION is stored with a trailing newline", () => {
    expect(parseStrictSpecVersion("1.0.0\n")).toEqual({ ok: true, version: "1.0.0" });
  });

  it("rejects an empty (or whitespace-only) version", () => {
    for (const raw of ["", "   ", "\n"]) {
      const result = parseStrictSpecVersion(raw);
      expect(result.ok).toBe(false);
    }
  });

  it("rejects a pre-release suffix", () => {
    expect(parseStrictSpecVersion("1.0.0-beta.1").ok).toBe(false);
  });

  it("rejects a build-metadata suffix", () => {
    expect(parseStrictSpecVersion("1.0.0+build.5").ok).toBe(false);
  });

  it("rejects a leading zero in any component", () => {
    for (const raw of ["01.0.0", "1.00.0", "1.0.00"]) {
      expect(parseStrictSpecVersion(raw).ok).toBe(false);
    }
  });

  it("rejects a malformed, non-numeric, or partial version", () => {
    for (const raw of ["v1.0.0", "1.0", "1.0.0.0", "not-a-version", "1.0.x"]) {
      expect(parseStrictSpecVersion(raw).ok).toBe(false);
    }
  });

  it("derives spec-v1.0.0 from this repository's real, current spec/VERSION", () => {
    const raw = readFileSync(path.join(ROOT, "spec", "VERSION"), "utf8");
    const parsed = parseStrictSpecVersion(raw);
    expect(parsed).toEqual({ ok: true, version: "1.0.0" });
    if (parsed.ok) expect(deriveSpecTagName(parsed.version)).toBe("spec-v1.0.0");
  });
});

describe("scripts/lib/spec-tag.mjs — deriveSpecTagName()", () => {
  it("prefixes with spec-v and nothing else", () => {
    expect(deriveSpecTagName("1.0.0")).toBe("spec-v1.0.0");
    expect(deriveSpecTagName("0.6.0")).toBe("spec-v0.6.0");
  });
});

describe("scripts/lib/spec-tag.mjs — resolveCanonicalTagCommit() with an injected fetch stub (no network)", () => {
  const REF_URL = "https://api.github.com/repos/polytypo/polytypo/git/refs/tags/spec-v1.0.0";

  it("returns the commit directly for a lightweight tag (object.type === commit)", async () => {
    const result = await resolveCanonicalTagCommit(
      "spec-v1.0.0",
      "polytypo/polytypo",
      stubFetch({
        [REF_URL]: { status: 200, body: { object: { type: "commit", sha: "abc123" } } },
      }),
    );
    expect(result).toEqual({ ok: true, commit: "abc123" });
  });

  it("dereferences an annotated tag (object.type === tag) to its target commit", async () => {
    const TAG_URL = "https://api.github.com/repos/polytypo/polytypo/git/tags/tagobjsha";
    const result = await resolveCanonicalTagCommit(
      "spec-v1.0.0",
      "polytypo/polytypo",
      stubFetch({
        [REF_URL]: { status: 200, body: { object: { type: "tag", sha: "tagobjsha" } } },
        [TAG_URL]: { status: 200, body: { object: { sha: "derefcommit" } } },
      }),
    );
    expect(result).toEqual({ ok: true, commit: "derefcommit" });
  });

  it("fails closed when the tag ref does not exist (404)", async () => {
    const result = await resolveCanonicalTagCommit(
      "spec-v1.0.0",
      "polytypo/polytypo",
      stubFetch({ [REF_URL]: { status: 404, body: {} } }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("does not exist");
  });

  it("fails closed on an unexpected non-2xx GitHub API response", async () => {
    const result = await resolveCanonicalTagCommit(
      "spec-v1.0.0",
      "polytypo/polytypo",
      stubFetch({ [REF_URL]: { status: 500, body: {} } }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("500");
  });

  it("fails closed when the network fetch itself throws", async () => {
    const result = await resolveCanonicalTagCommit("spec-v1.0.0", "polytypo/polytypo", async () => {
      throw new Error("getaddrinfo ENOTFOUND api.github.com");
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("Could not reach the GitHub API");
  });
});

describe("scripts/lib/spec-tag.mjs — verifySpecTag() with injected run()/fetchImpl stubs (no git or network)", () => {
  const REF_URL = "https://api.github.com/repos/polytypo/polytypo/git/refs/tags/spec-v1.0.0";
  const throwingRun = () => {
    throw new Error("run() should not have been called");
  };
  const throwingFetch = async () => {
    throw new Error("fetchImpl should not have been called");
  };

  it("fails closed on a malformed spec/VERSION before ever calling run() or fetchImpl()", async () => {
    const result = await verifySpecTag({
      specVersionRaw: "not-a-version",
      expectedCommitSha: "deadbeef",
      run: throwingRun,
      fetchImpl: throwingFetch,
    });
    expect(result.ok).toBe(false);
  });

  it("fails closed when the expected commit does not resolve", async () => {
    const result = await verifySpecTag({
      specVersionRaw: "1.0.0",
      expectedCommitSha: "not-a-real-sha",
      run: () => {
        throw new Error("git rev-parse: not a valid object name");
      },
      fetchImpl: throwingFetch,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("not-a-real-sha");
  });

  it("fails closed when the spec tag is missing in the canonical repo", async () => {
    const result = await verifySpecTag({
      specVersionRaw: "1.0.0",
      expectedCommitSha: "abc123",
      run: (args) => {
        if (args.includes("abc123^{commit}")) return "abc123full";
        throw new Error("unexpected args");
      },
      fetchImpl: stubFetch({ [REF_URL]: { status: 404, body: {} } }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("spec-v1.0.0");
  });

  it("fails closed when the spec tag points at a different commit than the release", async () => {
    const result = await verifySpecTag({
      specVersionRaw: "1.0.0",
      expectedCommitSha: "release-sha",
      run: (args) => {
        if (args.includes("release-sha^{commit}")) return "commit-a";
        throw new Error("unexpected args");
      },
      fetchImpl: stubFetch({
        [REF_URL]: { status: 200, body: { object: { type: "commit", sha: "commit-b" } } },
      }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("commit-a");
      expect(result.reason).toContain("commit-b");
    }
  });

  it("succeeds when the canonical spec tag resolves to the exact release commit", async () => {
    const result = await verifySpecTag({
      specVersionRaw: "1.0.0",
      expectedCommitSha: "release-sha",
      run: (args) => {
        if (args.includes("release-sha^{commit}")) return "same-commit";
        throw new Error("unexpected args");
      },
      fetchImpl: stubFetch({
        [REF_URL]: { status: 200, body: { object: { type: "commit", sha: "same-commit" } } },
      }),
    });
    expect(result).toEqual({ ok: true, tagName: "spec-v1.0.0", commit: "same-commit" });
  });

  it("succeeds with a matching annotated tag, dereferenced to the release commit", async () => {
    const TAG_URL = "https://api.github.com/repos/polytypo/polytypo/git/tags/tagobjsha";
    const result = await verifySpecTag({
      specVersionRaw: "1.0.0",
      expectedCommitSha: "release-sha",
      run: (args) => {
        if (args.includes("release-sha^{commit}")) return "same-commit";
        throw new Error("unexpected args");
      },
      fetchImpl: stubFetch({
        [REF_URL]: { status: 200, body: { object: { type: "tag", sha: "tagobjsha" } } },
        [TAG_URL]: { status: 200, body: { object: { sha: "same-commit" } } },
      }),
    });
    expect(result).toEqual({ ok: true, tagName: "spec-v1.0.0", commit: "same-commit" });
  });

  it("fails on an invalid/nonexistent expected commit SHA even if the correct tag exists", async () => {
    const result = await verifySpecTag({
      specVersionRaw: "1.0.0",
      expectedCommitSha: "0000000000000000000000000000000000dead",
      run: () => {
        throw new Error("not a valid object name");
      },
      fetchImpl: throwingFetch,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("does not resolve to a real commit");
  });

  it("never passes a hostile expected SHA through anything but a discrete argv element", async () => {
    const hostile = "$(rm -rf /tmp/should-not-run); echo pwned; `id`";
    let sawHostileAsWholeArg = false;
    const result = await verifySpecTag({
      specVersionRaw: "1.0.0",
      expectedCommitSha: hostile,
      run: (args) => {
        // The pure logic must pass the hostile string as one argv element (never interpolated
        // into a larger string), and this stub is a plain function call, not a shell — there is
        // no way for the payload to execute here either way, but we additionally assert the
        // argv-array contract holds.
        if (args.includes(`${hostile}^{commit}`)) sawHostileAsWholeArg = true;
        throw new Error("not a valid object name");
      },
      fetchImpl: throwingFetch,
    });
    expect(result.ok).toBe(false);
    expect(sawHostileAsWholeArg).toBe(true);
  });

  it("targets a caller-supplied canonicalRepo instead of the polytypo/polytypo default", async () => {
    const otherUrl = "https://api.github.com/repos/example/other/git/refs/tags/spec-v1.0.0";
    const result = await verifySpecTag({
      specVersionRaw: "1.0.0",
      expectedCommitSha: "release-sha",
      canonicalRepo: "example/other",
      run: (args) => {
        if (args.includes("release-sha^{commit}")) return "same-commit";
        throw new Error("unexpected args");
      },
      fetchImpl: stubFetch({
        [otherUrl]: { status: 200, body: { object: { type: "commit", sha: "same-commit" } } },
      }),
    });
    expect(result).toEqual({ ok: true, tagName: "spec-v1.0.0", commit: "same-commit" });
  });
});

describe(".github/workflows/release.yml — spec-tag verification is wired in correctly", () => {
  const workflowText = readFileSync(path.join(ROOT, ".github", "workflows", "release.yml"), "utf8");

  it("checks out with fetch-depth: 0", () => {
    expect(workflowText).toMatch(/actions\/checkout@[0-9a-f]{40}[\s\S]*?fetch-depth:\s*0/);
  });

  it("runs the spec-tag verifier before build/pack, alongside the package-tag verifier", () => {
    const specTagIndex = workflowText.indexOf("scripts/verify-spec-tag.mjs");
    const packageTagIndex = workflowText.indexOf("scripts/verify-release-tag.mjs");
    // Match the actual `run:` step lines, not the prose in comments above them (the file's header
    // comment describes the publish job's behavior using the same phrases well before either real
    // step appears).
    const buildIndex = workflowText.indexOf("run: npm run build");
    const packIndex = workflowText.indexOf("npm pack --pack-destination");
    const publishIndex = workflowText.indexOf('npm publish "${TARBALL}"');

    expect(specTagIndex).toBeGreaterThan(-1);
    expect(packageTagIndex).toBeGreaterThan(-1);
    expect(specTagIndex).toBeLessThan(buildIndex);
    expect(packageTagIndex).toBeLessThan(buildIndex);
    expect(buildIndex).toBeLessThan(packIndex);
    expect(packIndex).toBeLessThan(publishIndex);
  });

  it("does not add a package.json script for the spec-tag checker", () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
    expect(
      Object.values(pkg.scripts ?? {}).some((s) => String(s).includes("verify-spec-tag")),
    ).toBe(false);
  });

  it("still triggers only on the npm package tag pattern v*, not spec-v*", () => {
    const triggerSection = workflowText.slice(0, workflowText.indexOf("permissions:"));
    expect(triggerSection).toMatch(/tags:\s*\n\s*-\s*"v\*"/);
    expect(triggerSection).not.toContain("spec-v");
  });

  it("has no GitHub context expression directly inside a run: block", () => {
    expect(findContextExpressionsInRunBlocks(workflowText)).toEqual([]);
  });

  it("still grants no contents: write anywhere", () => {
    expect(workflowText).not.toContain("contents: write");
  });
});
