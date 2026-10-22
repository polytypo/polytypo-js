import { PolytypoError } from "../errors.js";
import { filterBoundaryEdits, spanRangesOf } from "../modes/spans.js";
import { LINE_MARKER, MARKER, isMarker } from "./sentinels.js";
import type { LocaleData, Mode, Options, RuleId } from "../types.js";
import { fromCodePoints, toCodePoints } from "./codepoints.js";
import { NO_ORIGIN, type Change } from "./origin.js";
import { runRulesOverSpans } from "./span-runner.js";
import { runRulesRecording } from "./rule-runner.js";

const LINE_TERMINATORS: ReadonlySet<number> = new Set([
  0x0a, 0x0d, 0x0b, 0x0c, 0x85, 0x2028, 0x2029,
]);

/** One maximal run of protected code points, `[start, end)` in input code points. */
interface Hole {
  readonly start: number;
  readonly end: number;
}

function invalid(message: string): never {
  throw new PolytypoError("POLYTYPO_INVALID_OPTION", message);
}

/**
 * modes.md §3.9: validate `protect` against the input's code-point length and merge touching
 * ranges. Absent and `[]` are the same thing.
 */
export function resolveProtect(value: Options["protect"], length: number): Hole[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) invalid("protect must be an array of { start, end } ranges.");
  const holes: Hole[] = [];
  let previousEnd = 0;
  for (const range of value as readonly unknown[]) {
    if (typeof range !== "object" || range === null) invalid("protect entries must be objects.");
    const { start, end } = range as { start?: unknown; end?: unknown };
    if (!Number.isInteger(start) || !Number.isInteger(end)) {
      invalid("protect start and end must be integers.");
    }
    const s = start as number;
    const e = end as number;
    if (s < 0 || e <= s) invalid(`protect range [${s}, ${e}) is empty or negative.`);
    if (s < previousEnd)
      invalid(`protect range [${s}, ${e}) overlaps or precedes the previous one.`);
    if (e > length)
      invalid(`protect range [${s}, ${e}) runs past the end of the input (${length}).`);
    const last = holes[holes.length - 1];
    if (last !== undefined && last.end === s)
      holes[holes.length - 1] = { start: last.start, end: e };
    else holes.push({ start: s, end: e });
    previousEnd = e;
  }
  return holes;
}

/** modes.md §3.9: outside `text`, a non-empty `protect` is refused rather than ignored. */
export function assertNoProtect(value: Options["protect"], mode: Mode): void {
  if (value === undefined || value === null) return;
  if (Array.isArray(value) && value.length === 0) return;
  invalid(`protect is only available in text mode, not ${mode}.`);
}

interface Layout {
  readonly array: number[];
  readonly origin: number[];
}

/** `[S₀] m [S₁] m … [Sₖ]`, with a marker for every hole, edges included. */
function layout(cp: readonly number[], holes: readonly Hole[]): Layout {
  const array: number[] = [];
  const origin: number[] = [];
  let cursor = 0;
  for (const hole of holes) {
    for (let i = cursor; i < hole.start; i += 1) {
      array.push(cp[i] as number);
      origin.push(i);
    }
    let line = false;
    for (let i = hole.start; i < hole.end; i += 1) {
      if (LINE_TERMINATORS.has(cp[i] as number)) {
        line = true;
        break;
      }
    }
    array.push(line ? LINE_MARKER : MARKER);
    origin.push(NO_ORIGIN);
    cursor = hole.end;
  }
  for (let i = cursor; i < cp.length; i += 1) {
    array.push(cp[i] as number);
    origin.push(i);
  }
  return { array, origin };
}

export interface Mapped {
  readonly text: string;
  /** The holes in OUTPUT code points: where a second call must be told they now are. */
  readonly holes: readonly Hole[];
}

export function runProtectedMapped(
  input: string,
  holes: readonly Hole[],
  planned: readonly RuleId[],
  locale: LocaleData,
  narrowTarget: number,
): Mapped {
  const cp = toCodePoints(input);
  const { array } = layout(cp, holes);
  const out = runRulesOverSpans(array, planned, locale, "text", narrowTarget);
  const result: number[] = [];
  const mapped: Hole[] = [];
  let hole = 0;
  for (const value of out) {
    if (isMarker(value)) {
      const h = holes[hole] as Hole;
      const start = result.length;
      for (let i = h.start; i < h.end; i += 1) result.push(cp[i] as number);
      mapped.push({ start, end: result.length });
      hole += 1;
      continue;
    }
    result.push(value);
  }
  if (hole !== holes.length) {
    throw new PolytypoError(
      "POLYTYPO_RULE_CONTRACT",
      "boundary markers did not survive the pipeline.",
    );
  }
  return { text: fromCodePoints(result), holes: mapped };
}

export function runProtected(
  input: string,
  holes: readonly Hole[],
  planned: readonly RuleId[],
  locale: LocaleData,
  narrowTarget: number,
): string {
  return runProtectedMapped(input, holes, planned, locale, narrowTarget).text;
}

export function analyzeProtected(
  input: string,
  holes: readonly Hole[],
  planned: readonly RuleId[],
  locale: LocaleData,
  narrowTarget: number,
): Change[] {
  const cp = toCodePoints(input);
  const { array, origin } = layout(cp, holes);
  return runRulesRecording(
    array,
    planned,
    locale,
    "text",
    narrowTarget,
    origin,
    cp.length,
    (current, edits) => filterBoundaryEdits(current, edits, spanRangesOf(current)),
  );
}
