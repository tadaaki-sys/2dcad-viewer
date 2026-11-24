// 文字スタイル・文字の入力の確認(Phase 14)
import { describe, expect, it } from "vitest";
import { checkTextInput } from "./textInput";
import { MAX_TEXT_LENGTH } from "./textLayout";
import {
  addTextStyle,
  currentTextStyle,
  cssFontFamily,
  DEFAULT_TEXT_STYLE,
  defaultTextStyleTable,
  deleteTextStyle,
  isValidFontFamily,
  normalizeTextStyleTable,
  renameTextStyle,
  setCurrentTextStyle,
  STANDARD_STYLE_NAME,
  TEXT_STYLE_LIMITS,
  updateTextStyle,
  validateTextStyle,
} from "./textStyle";
import type { TextStyle, TextStyleResult, TextStyleTable } from "./textStyle";

const style = (overrides: Partial<TextStyle> = {}): TextStyle => ({ ...DEFAULT_TEXT_STYLE, name: "Note", ...overrides });

function table(result: TextStyleResult): TextStyleTable {
  if (!result.ok) throw new Error(`失敗: ${result.message}`);
  return result.table;
}

describe("validateTextStyle", () => {
  it("accepts the default style and ordinary values", () => {
    expect(validateTextStyle(DEFAULT_TEXT_STYLE)).toBeNull();
    expect(validateTextStyle(style({ height: 2.5, widthFactor: 0.8, italic: true, horizontalAlign: "center", verticalAlign: "middle", fontFamily: "MS ゴシック" }))).toBeNull();
  });

  it("refuses bad names, heights, width factors, fonts and alignments", () => {
    expect(validateTextStyle(style({ name: "" }))).toContain("名前");
    expect(validateTextStyle(style({ name: " Note" }))).toContain("名前");
    expect(validateTextStyle(style({ name: "x".repeat(TEXT_STYLE_LIMITS.maxNameLength + 1) }))).toContain("文字以内");
    for (const height of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, TEXT_STYLE_LIMITS.maxHeight * 2, TEXT_STYLE_LIMITS.minHeight / 2]) {
      expect(validateTextStyle(style({ height })), `height ${height}`).toContain("高さ");
    }
    for (const widthFactor of [0, 0.05, 11, Number.NaN]) {
      expect(validateTextStyle(style({ widthFactor })), `width factor ${widthFactor}`).toContain("幅係数");
    }
    expect(validateTextStyle(style({ fontFamily: "" }))).toContain("フォント");
    expect(validateTextStyle(style({ horizontalAlign: "top" as never }))).toContain("配置");
    expect(validateTextStyle(style({ verticalAlign: "left" as never }))).toContain("配置");
    expect(validateTextStyle(style({ italic: "yes" as never }))).toContain("斜体");
  });
});

describe("fonts", () => {
  it("only names without quotes, backslashes, control characters or CSS delimiters are valid", () => {
    expect(isValidFontFamily("MS ゴシック")).toBe(true);
    expect(isValidFontFamily("Yu Gothic UI")).toBe(true);
    for (const bad of ['Arial"; color: red', "a'b", "a\\b", "a;b", "a{b}", "a\nb", "<b>", "", "   ", "x".repeat(TEXT_STYLE_LIMITS.maxFontLength + 1)]) {
      expect(isValidFontFamily(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it("cssFontFamily: generic names as they are, other names quoted with sans-serif as the fallback, bad or missing names → sans-serif", () => {
    expect(cssFontFamily("serif")).toBe("serif");
    expect(cssFontFamily("Monospace")).toBe("monospace");
    expect(cssFontFamily("MS ゴシック")).toBe('"MS ゴシック", sans-serif');
    expect(cssFontFamily(undefined)).toBe("sans-serif");
    expect(cssFontFamily('Arial"; color: red')).toBe("sans-serif");
    expect(cssFontFamily("")).toBe("sans-serif");
  });
});

describe("normalizeTextStyleTable (what is read back from storage cannot be trusted)", () => {
  it("anything unusable gives the default table", () => {
    for (const raw of [null, undefined, 5, "x", [], {}, { styles: "no" }, { styles: [null, 3, "a"] }]) {
      expect(normalizeTextStyleTable(raw)).toEqual(defaultTextStyleTable());
    }
  });

  it("keeps good styles, drops bad ones and duplicates, and always has Standard", () => {
    const good = style({ name: "Note", height: 50 });
    const result = normalizeTextStyleTable({ styles: [good, { ...good, height: -1, name: "Bad" }, good, { ...good, name: "" }], current: "Note" });
    expect(result.styles.map((s) => s.name)).toEqual([STANDARD_STYLE_NAME, "Note"]);
    expect(result.current).toBe("Note");
    // 現在のスタイルが無ければ、Standard
    expect(normalizeTextStyleTable({ styles: [good], current: "Gone" }).current).toBe(STANDARD_STYLE_NAME);
    expect(normalizeTextStyleTable({ styles: [good], current: 5 }).current).toBe(STANDARD_STYLE_NAME);
  });

  it("limits the number of styles, also when Standard is missing (it is added, and the last style is dropped)", () => {
    const many = Array.from({ length: TEXT_STYLE_LIMITS.maxStyles + 50 }, (_, i) => style({ name: `S${i}` }));
    expect(normalizeTextStyleTable({ styles: many }).styles.length).toBeLessThanOrEqual(TEXT_STYLE_LIMITS.maxStyles);
    const hundred = many.slice(0, TEXT_STYLE_LIMITS.maxStyles);
    const result = normalizeTextStyleTable({ styles: hundred });
    expect(result.styles.length).toBe(TEXT_STYLE_LIMITS.maxStyles);
    expect(result.styles[0].name).toBe(STANDARD_STYLE_NAME);
    expect(result.styles.some((s) => s.name === `S${TEXT_STYLE_LIMITS.maxStyles - 1}`)).toBe(false);
    // Standard を含む 100 個は、そのまま
    const withStandard = [DEFAULT_TEXT_STYLE, ...hundred.slice(0, TEXT_STYLE_LIMITS.maxStyles - 1)];
    expect(normalizeTextStyleTable({ styles: withStandard }).styles.length).toBe(TEXT_STYLE_LIMITS.maxStyles);
  });

  it("a huge array of bad items is not scanned in full, and a good style after the scan limit is ignored", () => {
    let reads = 0;
    const bad = new Proxy(
      {},
      {
        get: () => {
          reads++;
          return undefined;
        },
      },
    );
    const items = Array.from({ length: 100_000 }, () => bad);
    expect(normalizeTextStyleTable({ styles: items })).toEqual(defaultTextStyleTable());
    expect(reads).toBeLessThan(TEXT_STYLE_LIMITS.maxStyles * 4 * 8);
    const late = [...Array.from({ length: TEXT_STYLE_LIMITS.maxStyles * 4 }, () => null), style({ name: "Late" })];
    expect(normalizeTextStyleTable({ styles: late }).styles.map((s) => s.name)).toEqual([STANDARD_STYLE_NAME]);
  });

  it("round trips through JSON", () => {
    const t = table(addTextStyle(defaultTextStyleTable(), style({ name: "Note", italic: true, fontFamily: "serif" })));
    expect(normalizeTextStyleTable(JSON.parse(JSON.stringify(t)))).toEqual(t);
  });
});

describe("style operations", () => {
  it("add: becomes current; duplicates and bad values are refused", () => {
    const t = table(addTextStyle(defaultTextStyleTable(), style({ name: "Note" })));
    expect(t.current).toBe("Note");
    expect(currentTextStyle(t).name).toBe("Note");
    expect(addTextStyle(t, style({ name: "Note" }))).toMatchObject({ ok: false, message: expect.stringContaining("すでにあります") });
    expect(addTextStyle(t, style({ name: "Other", height: 0 }))).toMatchObject({ ok: false });
  });

  it("update: changes the values of one style only; Standard can be edited; bad values change nothing", () => {
    const base = table(addTextStyle(defaultTextStyleTable(), style({ name: "Note" })));
    const updated = table(updateTextStyle(base, "Note", { height: 20, italic: true }));
    expect(updated.styles.find((s) => s.name === "Note")).toMatchObject({ height: 20, italic: true });
    expect(updated.styles.find((s) => s.name === STANDARD_STYLE_NAME)).toEqual(DEFAULT_TEXT_STYLE);
    expect(table(updateTextStyle(base, STANDARD_STYLE_NAME, { height: 30 })).styles[0].height).toBe(30);
    expect(updateTextStyle(base, "Note", { height: -3 })).toMatchObject({ ok: false });
    expect(updateTextStyle(base, "Gone", { height: 3 })).toMatchObject({ ok: false });
  });

  it("rename: keeps the current style; Standard cannot be renamed; names must be new and valid", () => {
    const base = table(addTextStyle(defaultTextStyleTable(), style({ name: "Note" })));
    const renamed = table(renameTextStyle(base, "Note", "Memo"));
    expect(renamed.current).toBe("Memo");
    expect(renamed.styles.map((s) => s.name)).toEqual([STANDARD_STYLE_NAME, "Memo"]);
    expect(renameTextStyle(base, STANDARD_STYLE_NAME, "X")).toMatchObject({ ok: false });
    expect(renameTextStyle(base, "Note", STANDARD_STYLE_NAME)).toMatchObject({ ok: false, message: expect.stringContaining("すでにあります") });
    expect(renameTextStyle(base, "Note", "")).toMatchObject({ ok: false });
    expect(renameTextStyle(base, "Gone", "X")).toMatchObject({ ok: false });
    expect(table(renameTextStyle(base, "Note", "Note"))).toEqual(base);
  });

  it("delete: Standard cannot be deleted; deleting the current style goes back to Standard", () => {
    const base = table(addTextStyle(defaultTextStyleTable(), style({ name: "Note" })));
    const deleted = table(deleteTextStyle(base, "Note"));
    expect(deleted.styles.map((s) => s.name)).toEqual([STANDARD_STYLE_NAME]);
    expect(deleted.current).toBe(STANDARD_STYLE_NAME);
    expect(deleteTextStyle(base, STANDARD_STYLE_NAME)).toMatchObject({ ok: false });
    expect(deleteTextStyle(base, "Gone")).toMatchObject({ ok: false });
    // 現在でないスタイルを消しても、現在は変わらない
    const two = table(addTextStyle(base, style({ name: "Other" })));
    expect(table(deleteTextStyle(two, "Note")).current).toBe("Other");
  });

  it("set current: only an existing style", () => {
    const base = table(addTextStyle(defaultTextStyleTable(), style({ name: "Note" })));
    expect(table(setCurrentTextStyle(base, STANDARD_STYLE_NAME)).current).toBe(STANDARD_STYLE_NAME);
    expect(setCurrentTextStyle(base, "Gone")).toMatchObject({ ok: false });
  });

  it("never mutates the table it was given", () => {
    const base = table(addTextStyle(defaultTextStyleTable(), style({ name: "Note" })));
    const copy = JSON.stringify(base);
    updateTextStyle(base, "Note", { height: 5 });
    renameTextStyle(base, "Note", "Memo");
    deleteTextStyle(base, "Note");
    setCurrentTextStyle(base, STANDARD_STYLE_NAME);
    expect(JSON.stringify(base)).toBe(copy);
  });
});

describe("checkTextInput", () => {
  it("refuses empty and blank text, with a reason", () => {
    expect(checkTextInput("", false)).toMatchObject({ ok: false, message: expect.stringContaining("空です") });
    expect(checkTextInput("   \n  ", true)).toMatchObject({ ok: false });
  });

  it("single line: line breaks become spaces; multiline: breaks are kept and normalised to \\n", () => {
    expect(checkTextInput("a\nb", false)).toEqual({ ok: true, text: "a b" });
    expect(checkTextInput("a\r\nb\rc", true)).toEqual({ ok: true, text: "a\nb\nc" });
  });

  it("refuses text that is only invisible characters (zero-width, soft hyphen, BOM, no-break space), and control characters", () => {
    for (const invisible of ["\u200b", "\u200b\u200d\ufeff", "\u00ad", " 　", "\u2060\u202e"]) {
      expect(checkTextInput(invisible, false), JSON.stringify(invisible)).toMatchObject({ ok: false, message: expect.stringContaining("空です") });
    }
    for (const control of ["a\u0000b", "\u0007", "x\u001By", "a\u007Fb", "a\u0085b"]) {
      expect(checkTextInput(control, true), JSON.stringify(control)).toMatchObject({ ok: false, message: expect.stringContaining("制御文字") });
    }
    // 見える文字があれば、見えない文字が混じっていてもよい。タブは空白になる
    expect(checkTextInput("a\u200bb", false)).toEqual({ ok: true, text: "a\u200bb" });
    expect(checkTextInput("a\tb", false)).toEqual({ ok: true, text: "a b" });
  });

  it("refuses text longer than the limit", () => {
    expect(checkTextInput("x".repeat(MAX_TEXT_LENGTH), false).ok).toBe(true);
    expect(checkTextInput("x".repeat(MAX_TEXT_LENGTH + 1), false)).toMatchObject({ ok: false, message: expect.stringContaining("長すぎます") });
  });
});