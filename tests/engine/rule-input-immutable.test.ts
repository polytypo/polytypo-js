import { describe, expect, it } from "vitest";
import { toCodePoints } from "../../src/engine/codepoints";
import { applyEdits } from "../../src/engine/edits";
import { planRules } from "../../src/engine/rule-runner";
import { KNOWN_LOCALES } from "../../src/generated/locales";
import { getLocaleData } from "../../src/engine/locale";
import { RULES } from "../../src/rules/registry";

// applyEdits returns its input array itself when a rule reports no edits, so a rule that mutated
// `RuleContext.cp` would corrupt the next rule's input. Frozen arrays make any write throw.

const SAMPLE =
  `He said "it's 'fine' - really" ... 5-10 km, 20 % of 3x4. ` +
  `Er sagte „das ist 'gut'" - sehr gut... Il dit « bonjour » 12 h 30. «Привет» - сказал он.`;

describe("rule input is never mutated", () => {
  it("applyEdits with no edits returns the same array", () => {
    const cp = toCodePoints("abc");
    expect(applyEdits(cp, [])).toBe(cp);
  });

  for (const locale of KNOWN_LOCALES) {
    it(`no rule writes to the array it is given (${locale})`, () => {
      const data = getLocaleData(locale);
      const ids = planRules({ ranges: true, "quote-punctuation": true });
      let current: readonly number[] = toCodePoints(SAMPLE);
      for (const id of ids) {
        const rule = RULES[id];
        if (rule === undefined) continue;
        const frozen = Object.freeze([...current]);
        const edits = rule.apply({ cp: frozen, locale: data, mode: "text", narrowTarget: 0x202f });
        expect([...frozen]).toEqual([...current]);
        current = applyEdits(frozen, edits, id);
      }
    });
  }
});
