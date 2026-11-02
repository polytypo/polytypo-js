import { scanPaired } from "./dashes-paired.js";
import type { Edit, Rule, RuleContext } from "../types.js";
import {
  HYPHEN_MINUS,
  HYPHEN,
  MINUS_SIGN,
  EN_DASH,
  buildReplacement,
  isOpenBracket,
  isRomanFlanked,
  isSpaced,
  isSpacingTransitionBlocked,
  isStripBeforeOrCloseBracket,
  findDashTokens,
  rangeFlanks,
  sameContent,
  type DashStyle,
} from "./dash-shared.js";

/**
 * `dashes` — spec/rules/dashes.md (spec 0.5.0), order 30. Parenthetical-dash processing only,
 * as of spec 0.5.0: numeric/date-range recognition moved to the `ranges` rule (order 25,
 * off by default), which owns `dash.range` and shares this rule's token-scanning and guard
 * machinery via `dash-shared.js`. See dashes.md 1 and 7.11, and ranges.md 1, for why the split
 * happened and why range detection is opt-in rather than fixed structurally.
 *
 * A range candidate is declined here **unconditionally** — never reinterpreted as a
 * parenthetical dash — regardless of whether `ranges` is enabled (operator decision, spec
 * 0.5.0). That was already true of every prior spec version: the range/parenthetical branches
 * have always been mutually exclusive per token, on the same test that now decides which rule a
 * token belongs to rather than which branch of one rule it takes. Spec 1.3.0 widened that test
 * from "both flanks DIGIT" to `rangeFlanks` (ranges.md 3.2a), so a token whose members repeat a
 * closed-up symbol — `$15 - $20` — moved from this rule to `ranges`, and therefore from
 * converting by default to converting only when the caller enables `ranges`.
 *
 * Explicit index-based scanning only: no regex anywhere, and every index addresses the
 * code-point array, never a native string (ARCHITECTURE.md 4.1, 4.2).
 */

function scan(ctx: RuleContext): Edit[] {
  const cp = ctx.cp;
  const edits: Edit[] = [];
  const style: DashStyle = ctx.locale.dash.parenthetical;
  if (style === "em-paired") return scanPaired(cp);

  for (const token of findDashTokens(cp)) {
    const { s, e, leftCp, rightCp, left, right, lsp, rsp } = token;

    // A range candidate is `ranges`' territory, never `dashes`' — declined unconditionally,
    // whether or not `ranges` is enabled (operator decision, spec 0.5.0). Since spec 1.3.0 a
    // candidate may carry a matched closed-up symbol on a flank (ranges.md 3.2a), which is why
    // this is `rangeFlanks` rather than a digit test on both flanks.
    if (rangeFlanks(cp, left, right) !== undefined) continue;

    // dashes.md 3.4 P5 — authored en-dash mark-identity veto (spec 0.6.0). A run consisting of
    // exactly one U+2013 is declined unconditionally: every locale, tight or spaced, regardless
    // of `dash.parenthetical`'s target glyph. Unlike P1/P4 this is not conditioned on the
    // replacement that would be chosen — an en-spaced locale's own tight-authored en-dash is
    // just as protected as an em-target locale's, because the failure this guards against
    // (an authored en-dash silently re-spaced into ordinary parenthetical punctuation) can
    // corrupt a range or joint-name reading in an en-spaced locale exactly as it can in an
    // em-target one; only the glyph substitution differs, not the risk. See §8.8 for the
    // fresh-evidence argument this guard rests on and why it does not reopen the pre-0.2.0
    // guards §8.1 retired.
    if (e - s === 1 && cp[s] === EN_DASH) continue;

    // dashes.md 3.4 P1 — a bare hyphen-shaped stroke must be spaced (the compound-word guard).
    if (
      e - s === 1 &&
      (cp[s] === HYPHEN_MINUS || cp[s] === HYPHEN || cp[s] === MINUS_SIGN) &&
      lsp === 0
    ) {
      continue;
    }
    // dashes.md 3.4 P4 — Roman-numeral veto.
    if (lsp === 0 && rsp === 0 && isRomanFlanked(cp, left, right)) continue;

    // `"none"`: the locale has no verified convention, so nothing is substituted.
    if (style === "none") continue;

    if (isSpaced(style)) {
      // T1: a tight token may not become spaced across a digit run that has a far dash.
      if (lsp === 0 && rsp === 0 && isSpacingTransitionBlocked(cp, left, right)) continue;
      // T2: the emitted U+0020 must not land where `spaces` (order 10) would delete it.
      if (isStripBeforeOrCloseBracket(rightCp)) continue;
      if (isOpenBracket(leftCp)) continue;
    }

    // `dashes` never binds: an interrupting dash is exactly where a line may break
    // (dashes.md 3.3.1's binding is `ranges`-only).
    const replacement = buildReplacement(style, false);
    const spanStart = s - lsp;
    const spanEnd = e + rsp;
    if (sameContent(cp, spanStart, spanEnd, replacement)) continue;

    edits.push({ start: spanStart, end: spanEnd, replacement, ruleId: "dashes" });
  }

  return edits;
}

export const dashesRule: Rule = {
  id: "dashes",
  apply: scan,
};
