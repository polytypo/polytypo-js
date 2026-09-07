export declare function parseStrictSpecVersion(
  raw: string,
): { ok: true; version: string } | { ok: false; reason: string };

export declare function deriveSpecTagName(specVersion: string): string;

/** Only the subset of the `fetch` contract this module actually reads. */
export type MinimalFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export declare function resolveCanonicalTagCommit(
  tagName: string,
  ownerRepo: string,
  fetchImpl?: MinimalFetch,
): Promise<{ ok: true; commit: string } | { ok: false; reason: string }>;

export declare function verifySpecTag(opts: {
  specVersionRaw: string;
  expectedCommitSha: string;
  cwd?: string;
  run?: (args: string[], cwd: string | undefined) => string;
  fetchImpl?: MinimalFetch;
  canonicalRepo?: string;
}): Promise<{ ok: true; tagName: string; commit: string } | { ok: false; reason: string }>;
