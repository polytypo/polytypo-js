// `protect` (spec 1.13.0, modes.md §3.9) and the analyze end-offset obligation (analyze.md §6).
// The fixtures cover the per-locale behaviour; this file covers validation order, code-point
// offsets, the empty-list equivalence and the properties no fixture can state.
import { describe, expect, it } from "vitest";
import { analyze, transform, PolytypoError, type Options } from "../../src/index";
import { transform as transformHtml } from "../../src/index.html";
import { toCodePoints } from "../../src/engine/codepoints";
import { getLocaleData } from "../../src/engine/locale";
import { resolveProtect, runProtectedMapped } from "../../src/engine/protect";
import { planRules } from "../../src/engine/rule-runner";

function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(PolytypoError);
    return (error as PolytypoError).code;
  }
  throw new Error("expected a PolytypoError");
}

function withProtect(protect: unknown): Options {
  return { locale: "en-US", protect } as unknown as Options;
}

describe("protect — validation (modes.md §3.9.2)", () => {
  const refusals: ReadonlyArray<readonly [string, unknown]> = [
    ["not a list", { start: 0, end: 1 }],
    ["a string", "0-1"],
    ["an element that is not an object", [1]],
    ["a null element", [null]],
    ["a missing end", [{ start: 0 }]],
    ["a fractional offset", [{ start: 0.5, end: 2 }]],
    ["a string offset", [{ start: "0", end: 2 }]],
    ["a negative start", [{ start: -1, end: 2 }]],
    ["an empty range", [{ start: 2, end: 2 }]],
    ["start after end", [{ start: 3, end: 2 }]],
    [
      "descending ranges",
      [
        { start: 3, end: 4 },
        { start: 0, end: 1 },
      ],
    ],
    [
      "overlapping ranges",
      [
        { start: 0, end: 3 },
        { start: 2, end: 4 },
      ],
    ],
    ["an end past the input", [{ start: 0, end: 7 }]],
  ];

  for (const [name, value] of refusals) {
    it(`refuses ${name} in transform and analyze`, () => {
      expect(codeOf(() => transform("abcdef", withProtect(value)))).toBe("POLYTYPO_INVALID_OPTION");
      expect(codeOf(() => analyze("abcdef", withProtect(value)))).toBe("POLYTYPO_INVALID_OPTION");
    });
  }

  it("treats touching ranges as one run and ignores other members", () => {
    const input = "${x}${y} - Rules";
    const touching = [
      { start: 0, end: 4, label: "x" },
      { start: 4, end: 8 },
    ];
    expect(transform(input, withProtect(touching))).toBe(
      transform(input, withProtect([{ start: 0, end: 8 }])),
    );
  });

  it("measures the end in code points, not UTF-16 units", () => {
    // "😀" is two UTF-16 units but one code point: length 3 in code points.
    expect(codeOf(() => transform("😀ab", withProtect([{ start: 0, end: 4 }])))).toBe(
      "POLYTYPO_INVALID_OPTION",
    );
    expect(transform("😀ab", withProtect([{ start: 0, end: 3 }]))).toBe("😀ab");
  });

  it("treats absent, null and an empty list as the same call", () => {
    const input = 'He said "hi" -- and left...';
    const plain = transform(input, { locale: "en-US" });
    expect(transform(input, withProtect(undefined))).toBe(plain);
    expect(transform(input, withProtect(null))).toBe(plain);
    expect(transform(input, withProtect([]))).toBe(plain);
    expect(analyze(input, withProtect([]))).toEqual(analyze(input, { locale: "en-US" }));
  });

  for (const mode of ["html", "markdown", "yaml"] as const) {
    it(`refuses a non-empty list in ${mode} mode and accepts an empty one`, () => {
      const extra = { dialect: "commonmark", keys: [] } as const;
      const base = { locale: "en-US", mode, ...extra };
      expect(codeOf(() => transform("x", { ...base, protect: [{ start: 0, end: 1 }] }))).toBe(
        "POLYTYPO_INVALID_OPTION",
      );
      expect(codeOf(() => analyze("x", { ...base, protect: [{ start: 0, end: 1 }] }))).toBe(
        "POLYTYPO_INVALID_OPTION",
      );
      expect(transform("x", { ...base, protect: [] })).toBe("x");
    });
  }

  it("refuses a non-empty list through the html entry at runtime", () => {
    const options = { locale: "en-US", protect: [{ start: 0, end: 1 }] } as never;
    expect(codeOf(() => transformHtml("x", options))).toBe("POLYTYPO_INVALID_OPTION");
  });

  it("reports a bad rule, locale and dialect before a bad protect", () => {
    const bad = [{ start: 5, end: 1 }];
    expect(
      codeOf(() => transform("x", { locale: "xx", rules: { nope: true } as never, protect: bad })),
    ).toBe("POLYTYPO_UNKNOWN_RULE");
    expect(codeOf(() => transform("x", { locale: "xx", protect: bad }))).toBe(
      "POLYTYPO_UNKNOWN_LOCALE",
    );
    expect(
      codeOf(() =>
        transform("x", {
          locale: "en-US",
          mode: "markdown",
          dialect: "nope" as never,
          protect: [{ start: 0, end: 1 }],
        }),
      ),
    ).toBe("POLYTYPO_INVALID_DIALECT");
    expect(codeOf(() => transform("x", { ...withProtect(bad), narrowNbsp: "x" as never }))).toBe(
      "POLYTYPO_INVALID_OPTION",
    );
  });
});

describe("protect — behaviour", () => {
  it("returns protected text byte for byte and typesets around it", () => {
    expect(transform("${x} - Rules", withProtect([{ start: 0, end: 4 }]))).toBe("${x}—Rules");
    expect(transform("${x} - Rules", { locale: "en-GB", protect: [{ start: 0, end: 4 }] })).toBe(
      "${x} – Rules",
    );
  });

  it("indexes by code point with an astral character before and inside a hole", () => {
    const input = "😀 -- 😀${x}😀 -- 😀";
    const cp = toCodePoints(input);
    const start = cp.indexOf(0x24);
    const out = transform(input, withProtect([{ start: start - 1, end: start + 5 }]));
    expect(out).toContain("😀${x}😀");
    expect(out).toBe("😀—😀${x}😀—😀");
  });

  it("is a fixed point only under the moved ranges", () => {
    const input = "wait...${x}...done";
    const holes = [{ start: 7, end: 11 }];
    const out = transform(input, withProtect(holes));
    expect(out).toBe("wait…${x}…done");
    expect(transform(out, withProtect([{ start: 5, end: 9 }]))).toBe(out);
  });
});

describe("analyze — change ends (analyze.md §2, §6)", () => {
  it("ends a change before a skipped element rather than after it", () => {
    const changes = analyze("<p>x--<code>cc</code>y</p>", {
      locale: "en-US",
      mode: "html",
    });
    const dash = changes.find((change) => change.before === "--");
    expect(dash).toMatchObject({ start: 4, end: 6 });
  });

  it("does not report a range that reaches into a protected run", () => {
    const input = "a--${x}b";
    const changes = analyze(input, withProtect([{ start: 3, end: 7 }]));
    for (const change of changes) expect(change.end).toBeLessThanOrEqual(3);
  });
});

describe("protect — sweep", () => {
  const TOKENS = [
    "a",
    "word",
    "Ab",
    "x",
    "5",
    "12",
    " ",
    " ",
    "  ",
    "-",
    "--",
    "---",
    "...",
    ".",
    ",",
    "!",
    "?",
    ":",
    ";",
    '"',
    "'",
    "(",
    ")",
    "\n",
    "–",
    "—",
    "'s",
    "n't",
    "km",
    "%",
    "😀",
    "é",
    "«",
    "»",
    "„",
    "“",
    "”",
  ];
  const HOLES = ["${x}", "{n}", "<b>", "{a, plural, one {#}}", "'{b}'", "😀{y}😀"];
  const LOCALES = ["en-US", "en-GB", "de-DE", "fr", "ru", "fi", "pl", "tr", "hu", "bg"];
  const PER_LOCALE = 120;

  let seed = 20261022;
  const random = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)] as T;

  it("keeps idempotency under moved ranges and never reports a range over a hole", () => {
    const planned = planRules(undefined);
    for (const locale of LOCALES) {
      const data = getLocaleData(locale);
      for (let n = 0; n < PER_LOCALE; n += 1) {
        const holes: { start: number; end: number }[] = [];
        let text = "";
        let length = 0;
        const parts = 3 + Math.floor(random() * 8);
        for (let i = 0; i < parts; i += 1) {
          const isHole = random() < 0.2;
          const piece = isHole ? pick(HOLES) : pick(TOKENS);
          const size = toCodePoints(piece).length;
          if (isHole) holes.push({ start: length, end: length + size });
          text += piece;
          length += size;
        }
        const merged = resolveProtect(holes, length);
        const mapped = runProtectedMapped(text, merged, planned, data, 0x202f);
        const out = transform(text, { locale, protect: holes });
        expect(out).toBe(mapped.text);
        expect(transform(out, { locale, protect: mapped.holes.map((hole) => ({ ...hole })) })).toBe(
          out,
        );

        const changes = analyze(text, { locale, protect: holes });
        expect(changes.length === 0).toBe(out === text);
        for (const change of changes) {
          expect(change.start).toBeGreaterThanOrEqual(0);
          expect(change.end).toBeLessThanOrEqual(length);
          for (const hole of merged) {
            const inside =
              change.start === change.end
                ? change.start > hole.start && change.start < hole.end
                : change.start < hole.end && change.end > hole.start;
            expect(inside, `${locale} ${JSON.stringify(text)}`).toBe(false);
          }
        }
      }
    }
  });
});
