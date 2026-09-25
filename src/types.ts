export type Mode = "text" | "html" | "markdown" | "yaml";

/**
 * `markdown` is not one language (spec/rules/modes.md 3.7.1). CommonMark and MDX disagree on
 * ordinary documents, so the caller states which they have — it is the file extension, and the
 * library can never know it. Detection is forbidden: one `<https://…>` autolink makes a file
 * invalid MDX, and a heuristic would then silently reclassify an ESM statement as prose.
 */
export type Dialect = "commonmark" | "mdx";

export type RuleId =
  | "spaces"
  | "ellipsis"
  | "dashes"
  | "ranges"
  | "hyphen"
  | "quotes"
  | "apostrophe"
  | "symbols"
  | "nbsp";

export interface Options {
  /** Required. An unknown locale throws; there is never a fallback to English. */
  locale: string;
  mode?: Mode;
  /** Required when `mode` is `"markdown"`, with no default; ignored in the other three modes. */
  dialect?: Dialect;
  /**
   * Required when `mode` is `"yaml"`, with no default; ignored in the other three modes
   * (spec/rules/modes.md §3.8.2). The mapping keys whose scalar values are processable — YAML is
   * a data format with islands of prose in it, so the caller names them and the library never
   * guesses. An empty list is legal and processes nothing.
   */
  keys?: readonly string[];
  /**
   * Optional, and only meaningful when `mode` is `"markdown"` (spec/rules/modes.md §3.7.4, spec
   * 1.7.0). The keys in the document's YAML frontmatter block whose scalar values are
   * processable, scanned by the same scan `yaml` mode uses. Absent means the block is skipped
   * whole, as it was before 1.7.0; an empty list is legal and yields no spans. The block is its
   * own text unit, so this option can never change a byte outside it.
   */
  frontmatterKeys?: readonly string[];
  /**
   * Per-rule override, keyed by `RuleId`. For a default-on rule (every rule except `ranges`),
   * `false` disables it and `true` is a no-op. For `ranges` — off by default (spec 0.5.0) —
   * `true` explicitly opts in and `false` (or omitting the key) leaves it disabled. Absence of a
   * key always means "use that rule's own default", never "off".
   */
  rules?: Partial<Record<RuleId, boolean>>;
  /**
   * `"nbsp"` makes the engine emit U+00A0 everywhere it would emit U+202F — the narrow no-break
   * space many common faces do not carry (nbsp.md §3.1a). Default `"narrow"`. This moves the
   * rule's target rather than post-processing the output, so the result stays a fixed point.
   */
  narrowNbsp?: NarrowNbsp;
}

/** nbsp.md §3.1a. `"narrow"` (the default) emits U+202F; `"nbsp"` emits U+00A0 in its place. */
export type NarrowNbsp = "narrow" | "nbsp";

/** Mirrors spec/schema/locale.schema.json. Literal data only — no patterns, no priorities. */
export interface QuotePair {
  readonly open: string;
  readonly close: string;
  readonly innerSpace: "none" | "nbsp" | "narrow-nbsp";
}

/**
 * The word fragments that attach across an elision or possessive apostrophe, read only when the
 * mark is flush against modes.md §3.2's inline boundary marker (quotes.md §3.2, spec 1.4.0).
 * Both lists are POSITIONAL, not attachment claims: `before` is matched against the maximal
 * LETTER run ending before the mark (French `l'`, `d'`, `qu'`, `jusqu'`), `after` against the run
 * beginning after it (English `x's`, Dutch `'s morgens`). The word a fragment attaches to may lie
 * on the far side of the boundary and so be absent from the rule's input, which is the whole
 * reason this veto exists. Entries are lowercase, LETTER-only, and cited in the locale's
 * `sources`.
 */
export interface ElisionClitics {
  readonly before: readonly string[];
  readonly after: readonly string[];
}

/**
 * A closed-set elision idiom — quotes.md 3.2's listed elision veto. Matching `elided` alone
 * cannot distinguish an idiom (`rock 'n' roll`) from an arbitrary quoted word
 * (`The letter 'n' is common.`); `left`/`right` are the surrounding context that does.
 */
export interface ElisionIdiom {
  readonly left: string;
  readonly elided: string;
  readonly right: string;
}

/**
 * `nbsp.initialBinding` — spec/rules/nbsp.md §3.9 (spec 0.6.0, replaces the boolean
 * `bindInitials`). `"none"`: N7 disabled. `"chain"`: binds only a confirmed sequence of two or
 * more adjacent initials (Chicago's own "two or more initials" wording) — a lone initial next to
 * an ordinary capitalized word is left alone. `"single"`: additionally binds one lone initial to
 * a following word (Jacques André's citation for `fr`/`fr-CA`), which cannot structurally
 * distinguish every genuine name from a sentence-boundary collision — see nbsp.md §7.
 */
export type InitialBinding = "none" | "chain" | "single";

export interface LocaleData {
  readonly locale: string;
  readonly name: string;
  readonly quotes: {
    readonly primary: QuotePair;
    readonly secondary: QuotePair;
    /** May be empty. Empty means no verified idiom of this shape for this locale. */
    readonly elisionIdioms: readonly ElisionIdiom[];
    /**
     * `quotes.elisionClitics` — spec/rules/quotes.md §3.2's span-boundary elision veto (spec
     * 1.4.0). Both lists may be empty, and empty is a total no-op: a locale with no citable
     * closed set of attaching fragments is classified exactly as spec 1.3.1 classified it.
     */
    readonly elisionClitics: ElisionClitics;
  };
  readonly dash: {
    readonly parenthetical: "em-tight" | "em-spaced" | "en-tight" | "en-spaced" | "none";
    readonly range: "em-tight" | "em-spaced" | "en-tight" | "en-spaced" | "none";
  };
  readonly ellipsis: {
    readonly abbreviatedAfterTerminal: boolean;
  };
  /** Morphological forms whose hyphen must not break. Empty arrays are the normal case. */
  readonly hyphen: {
    readonly prefixes: readonly string[];
    readonly suffixes: readonly string[];
    readonly compounds: readonly string[];
  };
  readonly nbsp: {
    readonly beforePunctuation: readonly string[];
    readonly narrowBeforePunctuation: readonly string[];
    readonly afterShortWords: readonly string[];
    readonly abbreviations: readonly string[];
    readonly beforeUnits: readonly string[];
    readonly beforeNumber: readonly string[];
    readonly beforeWord: readonly string[];
    readonly afterSymbols: readonly string[];
    readonly initialBinding: InitialBinding;
  };
  /**
   * Optional, and absent from this package's own embedded data: scripts/gen-locales.mjs
   * validates the citations and then drops them, since no rule reads them and they are 94% of
   * the locale payload. The field stays in the type because it is part of the spec's locale
   * shape — spec/locales/*.json in the canonical repository carry it, and a caller assembling
   * LocaleData from those files may too.
   */
  readonly sources?: readonly LocaleSource[];
}

export interface LocaleSource {
  /** Rule ids from spec/rules/order.json — note the rule is `dashes`/`ranges` while the field
   * both read is `dash`. */
  readonly rule:
    | "quotes"
    | "dashes"
    | "ranges"
    | "ellipsis"
    | "hyphen"
    | "nbsp"
    | "spaces"
    | "apostrophe"
    | "symbols";
  readonly cite: string;
  readonly url?: string;
  readonly note?: string;
}

/**
 * Indices address the code-point array, never a native string: UTF-16 offsets do not
 * survive the port to Go/PHP (ARCHITECTURE.md 4.2).
 */
export interface Edit {
  readonly start: number;
  readonly end: number;
  readonly replacement: readonly number[];
  readonly ruleId: RuleId;
}

export interface RuleContext {
  readonly cp: readonly number[];
  readonly locale: LocaleData;
  readonly mode: Mode;
  /**
   * nbsp.md §3.1a's NARROW-TARGET, already resolved to a code point: U+202F by default, U+00A0
   * when the caller passed `narrowNbsp: "nbsp"`. A rule reads a code point and never the option,
   * so the string never reaches the pipeline.
   */
  readonly narrowTarget: number;
}

export interface Rule {
  readonly id: RuleId;
  /** Must return non-overlapping edits in ascending order of `start`. */
  apply(ctx: RuleContext): Edit[];
}
