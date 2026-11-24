// 文字の行の分け方・大きさの見積もり・範囲(Phase 14)
import { describe, expect, it } from "vitest";
import type { CadText } from "../../types/cad";
import { distanceFromPointToText, getTextBoundingBoxCorners } from "../geometry/entityGeometry";
import { transformEntityGeometry } from "../geometry/transform";
import { MAX_WRAP_CHARACTERS, estimateWrapWidthInEm, layoutTextLines, measureTextBlock } from "./textLayout";

/** 書記素の数(結合文字・ZWJ の絵文字・国旗を、1つと数える) */
const graphemeCount = (value: string): number => Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value)).length;

const text = (overrides: Partial<CadText> = {}): CadText => ({
  id: "t",
  type: "TEXT",
  layer: "0",
  color: "#ffffff",
  position: { x: 0, y: 0 },
  text: "abc",
  height: 10,
  rotation: 0,
  horizontalAlign: "left",
  verticalAlign: "baseline",
  ...overrides,
});

const trimmed = (lines: string[]): string[] => lines.map((line) => line.trimEnd());

describe("layoutTextLines", () => {
  it("without a box width: only the line breaks (\\n) split the text (as before Phase 14)", () => {
    expect(layoutTextLines(text({ text: "a\nb" }))).toEqual(["a", "b"]);
    expect(layoutTextLines(text({ text: "" }))).toEqual([""]);
    expect(layoutTextLines(text({ text: "a very long line that is never wrapped without a box" }))).toHaveLength(1);
    expect(layoutTextLines(text({ text: "a\n\nb" }))).toEqual(["a", "", "b"]);
  });

  it("wraps English words at spaces (width estimated at 0.65 em per character)", () => {
    // maxEm = 40 / 10 = 4: "aaa " = 2.6, adding "bbb" (1.95) would be 4.55 > 4
    expect(trimmed(layoutTextLines(text({ text: "aaa bbb ccc", boxWidth: 40 })))).toEqual(["aaa", "bbb", "ccc"]);
    // maxEm = 6: "aaa bbb " fits (4.55), "ccc" does not
    expect(trimmed(layoutTextLines(text({ text: "aaa bbb ccc", boxWidth: 60 })))).toEqual(["aaa bbb", "ccc"]);
    // a wide box: one line
    expect(layoutTextLines(text({ text: "aaa bbb ccc", boxWidth: 1000 }))).toEqual(["aaa bbb ccc"]);
  });

  it("wraps Japanese text between characters (1 em each), and keeps punctuation off the start of a line", () => {
    expect(layoutTextLines(text({ text: "あいうえお", boxWidth: 30 }))).toEqual(["あいう", "えお"]);
    // 句読点は、行の先頭に来ない: 「い。」は1つの塊
    expect(layoutTextLines(text({ text: "あい。うえ", boxWidth: 20 }))).toEqual(["あ", "い。", "うえ"]);
  });

  it("a word longer than the box is split by characters", () => {
    expect(layoutTextLines(text({ text: "abcdefghij", boxWidth: 20 }))).toEqual(["abc", "def", "ghi", "j"]);
  });

  it("the width factor makes the characters wider (fewer fit in the box)", () => {
    // maxEm = 60 / (10 * 2) = 3 → "あいう" の 3 文字
    expect(layoutTextLines(text({ text: "あいうえお", boxWidth: 60, widthFactor: 2 }))).toEqual(["あいう", "えお"]);
    expect(layoutTextLines(text({ text: "あいうえお", boxWidth: 60, widthFactor: 1 }))).toEqual(["あいうえお"]);
  });

  it("keeps empty lines and wraps each paragraph on its own", () => {
    expect(trimmed(layoutTextLines(text({ text: "aaa bbb\n\nccc", boxWidth: 40 })))).toEqual(["aaa", "bbb", "", "ccc"]);
  });

  it("always makes progress: a box narrower than one character puts one character on each line", () => {
    expect(layoutTextLines(text({ text: "abc", boxWidth: 1 }))).toEqual(["a", "b", "c"]);
  });

  it("does not wrap when the box or the size is not usable (0, negative, NaN, Infinity), or the text is extremely long", () => {
    for (const boxWidth of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(layoutTextLines(text({ text: "aaa bbb ccc", boxWidth }))).toEqual(["aaa bbb ccc"]);
    }
    expect(layoutTextLines(text({ text: "aaa bbb ccc", boxWidth: 40, height: 0 }))).toEqual(["aaa bbb ccc"]);
    expect(layoutTextLines(text({ text: "aaa bbb ccc", boxWidth: 40, widthFactor: 0 }))).toEqual(["aaa bbb ccc"]);
    expect(layoutTextLines(text({ text: "a ".repeat(MAX_WRAP_CHARACTERS), boxWidth: 40 }))).toHaveLength(1);
  });

  function randomTexts(alphabet: string[], seed: number, count: number): Array<{ body: string; boxWidth: number; height: number }> {
    let state = seed;
    const rand = (): number => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 4294967296;
    };
    const result: Array<{ body: string; boxWidth: number; height: number }> = [];
    for (let i = 0; i < count; i++) {
      const length = Math.floor(rand() * 60);
      let body = "";
      for (let j = 0; j < length; j++) body += alphabet[Math.floor(rand() * alphabet.length)];
      result.push({ body, boxWidth: 5 + rand() * 120, height: 5 + rand() * 20 });
    }
    return result;
  }

  it("never loses or reorders characters, and lines fit the box (random text without punctuation: exact)", () => {
    for (const { body, boxWidth, height } of randomTexts(["a", "b", "W", "i", " ", " ", "あ", "い", "漢", "1", "-"], 7, 400)) {
      const lines = layoutTextLines(text({ text: body, boxWidth, height }));
      expect(lines.join("")).toBe(body);
      const maxEm = boxWidth / height;
      for (const line of lines) {
        // 1文字だけの行は、収まらなくてよい。それ以外は、行末の空白を除いた幅が、枠に収まる
        if (Array.from(line.trimEnd()).length > 1) expect(estimateWrapWidthInEm(line.trimEnd())).toBeLessThanOrEqual(maxEm + 1e-9);
      }
    }
  });

  it("never loses or reorders characters (random text with punctuation, combining marks and emoji); a line is at most one hanging punctuation wider than the box (or than one character)", () => {
    const alphabet = ["a", " ", "あ", "い。", "、", "ー", "漢", "e\u0301", "か\u3099", "👩\u200d💻", "🇯🇵", "。", "」"];
    for (const { body, boxWidth, height } of randomTexts(alphabet, 11, 400)) {
      const lines = layoutTextLines(text({ text: body, boxWidth, height }));
      expect(lines.join("")).toBe(body);
      const maxEm = boxWidth / height;
      for (const line of lines) {
        if (graphemeCount(line.trimEnd()) > 1) expect(estimateWrapWidthInEm(line.trimEnd())).toBeLessThanOrEqual(Math.max(maxEm, 1) + 1 + 1e-9);
      }
    }
  });

  it("punctuation never starts a line when the previous character is not punctuation (a box narrower than the pair keeps them together)", () => {
    // 枠が1文字分(1em)しかなくても、「あ」と「。」は、同じ行(はみ出す)
    expect(layoutTextLines(text({ text: "あ。", boxWidth: 10 }))).toEqual(["あ。"]);
    expect(layoutTextLines(text({ text: "あ。い", boxWidth: 10 }))).toEqual(["あ。", "い"]);
    expect(layoutTextLines(text({ text: "A。", boxWidth: 5 }))).toEqual(["A。"]);
    // 句読点が何個も続いても、はみ出すのは、1個だけ(あとは、折り返す)
    const many = layoutTextLines(text({ text: "あ。。。。", boxWidth: 10 }));
    expect(many.join("")).toBe("あ。。。。");
    expect(many.length).toBeGreaterThan(1);
  });

  it("combining marks, ZWJ emoji and flags are never split (one grapheme = one character) and are not counted twice", () => {
    for (const unit of ["e\u0301", "か\u3099", "👩\u200d💻", "🇯🇵", "👍🏽"]) {
      const lines = layoutTextLines(text({ text: unit.repeat(4), boxWidth: 5 }));
      expect(lines.join("")).toBe(unit.repeat(4));
      // 1行に1つの塊(書記素)だけ: 塊の途中で、改行されない
      for (const line of lines) expect(line.length % unit.length).toBe(0);
    }
    // e + 結合アクセントは、1文字分の幅(0.65 em)。枠が 1.4 em なら、2つ(1.3 em)まで1行に入る
    expect(layoutTextLines(text({ text: "e\u0301e\u0301e\u0301", boxWidth: 14 }))).toEqual(["e\u0301e\u0301", "e\u0301"]);
  });
  it("a 100,000-character text is wrapped quickly", () => {
    const body = "word ".repeat(20_000);
    const started = performance.now();
    const lines = layoutTextLines(text({ text: body, boxWidth: 300 }));
    expect(performance.now() - started).toBeLessThan(2000);
    expect(lines.join("")).toBe(body);
  });
});

describe("measureTextBlock and the bounding box", () => {
  it("a plain text: width = the longest line × height × width factor; height = lines × height × 1.2 (as before Phase 14)", () => {
    const m = measureTextBlock(text({ text: "abcd\nab", widthFactor: 2 }));
    expect(m.width).toBeCloseTo(4 * 0.65 * 10 * 2);
    expect(m.height).toBeCloseTo(2 * 10 * 1.2);
  });

  it("an MTEXT is as wide as its box, even when the text is shorter; plain text with a box width is not boxed", () => {
    expect(measureTextBlock(text({ text: "a", boxWidth: 100, isMText: true })).width).toBe(100);
    expect(measureTextBlock(text({ text: "a", boxWidth: 100 })).width).toBeCloseTo(0.65 * 10);
  });

  it("a line wider than the box (one character wider than the box, a hanging punctuation) is inside the bounds; trailing spaces are not counted", () => {
    // 枠 1mm・文字の高さ 100mm: 「あ」は 100mm 幅。枠の外に出た部分も、外形に含める
    expect(measureTextBlock(text({ text: "あ", height: 100, boxWidth: 1, isMText: true })).width).toBeCloseTo(100);
    expect(measureTextBlock(text({ text: "あ。", height: 10, boxWidth: 10, isMText: true })).width).toBeCloseTo(20);
    // 行末の空白は、数えない(枠のまま)
    expect(measureTextBlock(text({ text: "aaa bbb", height: 10, boxWidth: 40, isMText: true })).width).toBe(40);
    // 行が枠いっぱい(32.5mm)で、行末に空白がある(空白を入れると 39mm): 外形は、枠(33mm)のまま
    const full = text({ text: "aaaaa bbb", height: 10, boxWidth: 33, isMText: true });
    expect(layoutTextLines(full)[0]).toBe("aaaaa ");
    expect(measureTextBlock(full).width).toBe(33);
    // 枠に収まる文字は、枠の幅のまま
    expect(measureTextBlock(text({ text: "a", height: 10, boxWidth: 100, isMText: true })).width).toBe(100);
    // はみ出した部分をクリックしても、選択できる(距離 0)
    const wide = text({ text: "あ", height: 100, boxWidth: 1, isMText: true, verticalAlign: "top" });
    expect(distanceFromPointToText(wide, { x: 80, y: -50 })).toBe(0);
  });

  it("MTEXT corners follow the box and the (top) attachment; left, centre and right anchors", () => {
    const base = text({ text: "aaa bbb ccc", boxWidth: 40, isMText: true, verticalAlign: "top", position: { x: 100, y: 200 } });
    const left = getTextBoundingBoxCorners({ ...base, horizontalAlign: "left" });
    const xs = (c: ReturnType<typeof getTextBoundingBoxCorners>): number[] => c.map((p) => p.x).sort((a, b) => a - b);
    const ys = (c: ReturnType<typeof getTextBoundingBoxCorners>): number[] => c.map((p) => p.y).sort((a, b) => a - b);
    // 3行 × 10 × 1.2 = 36: 上端 y=200、下端 y=164
    expect(xs(left)[0]).toBeCloseTo(100);
    expect(xs(left)[3]).toBeCloseTo(140);
    expect(ys(left)[0]).toBeCloseTo(164);
    expect(ys(left)[3]).toBeCloseTo(200);
    const centre = getTextBoundingBoxCorners({ ...base, horizontalAlign: "center" });
    expect(xs(centre)[0]).toBeCloseTo(80);
    expect(xs(centre)[3]).toBeCloseTo(120);
    const right = getTextBoundingBoxCorners({ ...base, horizontalAlign: "right" });
    expect(xs(right)[0]).toBeCloseTo(60);
    expect(xs(right)[3]).toBeCloseTo(100);
  });

  it("rotation turns the box around the anchor; a point inside the box has distance 0, outside it does not", () => {
    const m = text({ text: "aaa bbb ccc", boxWidth: 40, isMText: true, verticalAlign: "top", rotation: Math.PI / 2 });
    const corners = getTextBoundingBoxCorners(m);
    // 90°回転(左回り): 幅 40 は、上向き(+y)に延びる。上端合わせの高さ 36 は、枠の下側(-y)が、+x へ回る
    expect(Math.max(...corners.map((p) => p.y))).toBeCloseTo(40);
    expect(Math.max(...corners.map((p) => p.x))).toBeCloseTo(36);
    expect(Math.min(...corners.map((p) => p.x))).toBeCloseTo(0);
    expect(distanceFromPointToText(m, { x: 18, y: 20 })).toBe(0);
    expect(distanceFromPointToText(m, { x: 50, y: 20 })).toBeCloseTo(14);
  });

  it("the wrapped height grows with a narrower box (the same function the renderer uses)", () => {
    const wide = measureTextBlock(text({ text: "aaa bbb ccc", boxWidth: 1000, isMText: true }));
    const narrow = measureTextBlock(text({ text: "aaa bbb ccc", boxWidth: 40, isMText: true }));
    expect(narrow.height).toBeGreaterThan(wide.height);
    expect(narrow.lines).toEqual(layoutTextLines(text({ text: "aaa bbb ccc", boxWidth: 40 })));
  });
});

describe("transforms keep the box consistent", () => {
  const boxed = text({ text: "aaa bbb ccc", boxWidth: 100, isMText: true, fontFamily: "serif", italic: true, styleName: "Note" });

  it("SCALE scales the box width together with the height; the other attributes are kept", () => {
    const scaled = transformEntityGeometry(boxed, [2, 0, 0, 2, 0, 0]) as CadText;
    expect(scaled.height).toBeCloseTo(20);
    expect(scaled.boxWidth).toBeCloseTo(200);
    expect(scaled).toMatchObject({ isMText: true, fontFamily: "serif", italic: true, styleName: "Note" });
    // 倍率が2倍でも、折り返しの結果(行の分け方)は変わらない
    expect(layoutTextLines(scaled)).toEqual(layoutTextLines(boxed));
  });

  it("a plain move or rotation does not touch the box width; a text without a box gets no box width", () => {
    const moved = transformEntityGeometry(boxed, [1, 0, 0, 1, 50, 60]) as CadText;
    expect(moved.boxWidth).toBe(100);
    const plain = transformEntityGeometry(text(), [2, 0, 0, 2, 0, 0]) as CadText;
    expect("boxWidth" in plain).toBe(false);
  });

  it("MIRROR does not flip a text (its rotation stays); the box width stays", () => {
    const mirrored = transformEntityGeometry({ ...boxed, rotation: 0.3 }, [-1, 0, 0, 1, 0, 0]) as CadText;
    expect(mirrored.rotation).toBe(0.3);
    expect(mirrored.boxWidth).toBeCloseTo(100);
  });
});
