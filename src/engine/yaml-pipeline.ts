import { yamlSpans } from "../modes/yaml.js";
import type { Options } from "../types.js";
import { getLocaleData } from "./locale.js";
import { resolveNarrowTarget } from "./narrow-target.js";
import { resolveYamlKeys } from "./yaml-keys.js";
import { planRules } from "./rule-runner.js";
import { analyzeOverSpans, runOverSpans } from "./span-runner.js";
import type { Change } from "./origin.js";

/**
 * `yaml` mode only, and the only mode pipeline with **no parser dependency at all** — span
 * selection is the specified scan of modes.md 3.8, not a library. There is likewise no
 * `POLYTYPO_MALFORMED_INPUT` counterpart here: with no declared grammar to violate, a file that
 * is not YAML yields few spans or none and comes back byte for byte (modes.md 3.8.3). The only
 * throw this mode adds is `keys`, which is about the call and not the input.
 */
export function runYamlPipeline(input: string, options: Partial<Options>): string {
  const narrowTarget = resolveNarrowTarget(options.narrowNbsp);
  const planned = planRules(options.rules);
  const locale = getLocaleData(options.locale);
  const keys = resolveYamlKeys(options.keys);
  return runOverSpans(input, yamlSpans(input, keys), planned, locale, "yaml", narrowTarget);
}

/** analyze.md §1, `yaml` mode: offsets are into the document, not into a span (analyze.md §6). */
export function analyzeYamlPipeline(input: string, options: Partial<Options>): Change[] {
  const narrowTarget = resolveNarrowTarget(options.narrowNbsp);
  const planned = planRules(options.rules);
  const locale = getLocaleData(options.locale);
  const keys = resolveYamlKeys(options.keys);
  return analyzeOverSpans(input, yamlSpans(input, keys), planned, locale, "yaml", narrowTarget);
}
