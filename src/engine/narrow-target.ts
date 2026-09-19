import { PolytypoError } from "../errors.js";
import type { NarrowNbsp } from "../types.js";

/** U+202F, the narrow no-break space — nbsp.md §3.1a's default NARROW-TARGET. */
export const NARROW_NO_BREAK_SPACE = 0x202f;
/** U+00A0, what `narrowNbsp: "nbsp"` substitutes for it. */
export const NO_BREAK_SPACE = 0x00a0;

/**
 * nbsp.md §3.1a: resolve the `narrowNbsp` option to the code point the rule writes. Done once,
 * at the call boundary, so no rule ever sees the option's string.
 *
 * Checked immediately after `mode` and before `rules` — the two checks that read nothing but the
 * call itself come first (nbsp.md §3.1a). It runs whether or not `nbsp` is enabled, so a
 * misspelled value still raises rather than being silently ignored.
 */
export function resolveNarrowTarget(value: NarrowNbsp | undefined): number {
  if (value === undefined || value === "narrow") return NARROW_NO_BREAK_SPACE;
  if (value === "nbsp") return NO_BREAK_SPACE;
  throw new PolytypoError(
    "POLYTYPO_INVALID_OPTION",
    `Unknown narrowNbsp ${JSON.stringify(value)}. Expected "narrow" or "nbsp".`,
  );
}
