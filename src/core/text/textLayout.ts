// 文字(TEXT・MTEXT)の行の分け方と、大きさの見積もり。画面にもファイル形式にも依存しない純粋な処理。
// 描画(CanvasRenderer)と、選択・範囲の計算(entityGeometry)が、同じ関数を使う。そのため、見た目と選択範囲がずれない。
//
// 字幅は、実際のグリフの幅を測らず、文字の種類ごとの固定幅で見積もる(半角 0.65 em、全角 1 em)。
// 折り返し(MTEXT の枠の幅)も、この見積もりで決める。フォントによって、実際の字幅は、わずかに異なる。
import type { CadText } from "../../types/cad";

/** 半角の文字の幅(文字の高さに対する割合の見積もり) */
export const TEXT_CHAR_WIDTH_FACTOR = 0.65;
/** 行の送り(文字の高さに対する割合) */
export const TEXT_LINE_HEIGHT_FACTOR = 1.2;
/** 日本語などの全角文字は、文字高とほぼ同じ幅になる */
const FULL_WIDTH_CHAR_WIDTH_FACTOR = 1;
const FIRST_FULL_WIDTH_CODE_POINT = 0x2e80;
/** 日本語の禁則: この文字は、行の先頭に来ない(前の行の終わりに付ける) */
const NO_LINE_START = new Set(Array.from(",.)]}!?:;、。，．）］｝〕〉》」』】！？：；ー・…ゝゞぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮ"));

/** 1文字の幅(文字の高さを 1 としたときの見積もり) */
function charWidthInEm(char: string): number {
  const codePoint = char.codePointAt(0) ?? 0;
  return codePoint >= FIRST_FULL_WIDTH_CODE_POINT ? FULL_WIDTH_CHAR_WIDTH_FACTOR : TEXT_CHAR_WIDTH_FACTOR;
}

/** 1行の幅の見積もり(文字の高さを 1 としたときの、幅の幅係数を掛ける前の値) */
export function estimateLineWidthInEm(line: string): number {
  let width = 0;
  for (const char of line) width += charWidthInEm(char);
  return width;
}

/** 折り返しの計算で、扱う文字数の上限(これを超える文字は、折り返しを行わず、改行だけで分ける。極端に長い入力で、重くならないように) */
export const MAX_WRAP_CHARACTERS = 200_000;

/** 文字として入力できる長さの上限(UTF-16 の長さ) */
export const MAX_TEXT_LENGTH = 100_000;

// ---- 折り返し ----
// 折り返し(と、折り返した文字の外形)は、書記素(結合文字・ZWJ の絵文字・国旗を、1文字として扱う単位)で数える。
// 枠を持たない文字の字幅の見積もり(estimateLineWidthInEm)は、Phase 13 までと同じ(コードポイントごと)のままにする。

/** コードポイントの途中で、書記素を分けてはいけない文字(結合文字・異体字セレクタ・ZWJ・国旗・肌の色)の範囲 */
const GRAPHEME_EXTENDING_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0300, 0x036f],
  [0x1ab0, 0x1aff],
  [0x1dc0, 0x1dff],
  [0x20d0, 0x20ff],
  [0x3099, 0x309a],
  [0x200d, 0x200d],
  [0xfe00, 0xfe0f],
  [0x1f1e6, 0x1f1ff],
  [0x1f3fb, 0x1f3ff],
  [0xe0100, 0xe01ef],
];

/** 書記素に分けないと、途中で分けてしまう文字を含むか(含まなければ、コードポイントごとで足りる。高速) */
function needsSegmenter(text: string): boolean {
  for (const char of text) {
    const codePoint = char.codePointAt(0) ?? 0;
    if (codePoint < 0x0300) continue;
    for (const [from, to] of GRAPHEME_EXTENDING_RANGES) {
      if (codePoint >= from && codePoint <= to) return true;
    }
  }
  return false;
}
const segmenter: Intl.Segmenter | null = typeof Intl !== "undefined" && typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;

/** 文字列を、書記素の配列にする(特別な文字が無ければ、コードポイントごと。高速) */
function graphemesOf(text: string): string[] {
  if (segmenter === null || !needsSegmenter(text)) return Array.from(text);
  return Array.from(segmenter.segment(text), (part) => part.segment);
}

/** 書記素1つの幅(最初のコードポイントの幅。結合文字・ZWJ は、幅を足さない) */
function graphemeWidthInEm(grapheme: string): number {
  return charWidthInEm(grapheme);
}

/** 折り返し・折り返した文字の外形で使う、1行の幅の見積もり(書記素ごと) */
export function estimateWrapWidthInEm(line: string): number {
  let width = 0;
  for (const grapheme of graphemesOf(line)) width += graphemeWidthInEm(grapheme);
  return width;
}

type Token = { text: string; /** 行末の空白を除いた幅(em) */ width: number; /** 空白を含む幅(em) */ fullWidth: number };

const isWide = (grapheme: string): boolean => (grapheme.codePointAt(0) ?? 0) >= FIRST_FULL_WIDTH_CODE_POINT;

/** 折り返しの単位に分ける: 全角の文字は1文字ずつ(禁則の文字は、前の文字に付ける)、半角の語は、後ろの空白を含めて1つ */
function tokensOf(paragraph: string): Token[] {
  const tokens: Token[] = [];
  const chars = graphemesOf(paragraph);
  let i = 0;
  while (i < chars.length) {
    const char = chars[i];
    if (isWide(char)) {
      let text = char;
      i++;
      // 行頭に来てはいけない文字(句読点など)は、前の文字に付ける
      while (i < chars.length && NO_LINE_START.has(chars[i])) {
        text += chars[i];
        i++;
      }
      const width = estimateWrapWidthInEm(text);
      tokens.push({ text, width, fullWidth: width });
      continue;
    }
    // 半角: 空白でない文字の連なり + 後ろの空白
    let word = "";
    while (i < chars.length && chars[i] !== " " && !isWide(chars[i])) {
      word += chars[i];
      i++;
    }
    let spaces = "";
    while (i < chars.length && chars[i] === " ") {
      spaces += chars[i];
      i++;
    }
    // 半角の語のあとに、行頭禁則の全角文字(「。」など)が続くときは、その文字を語に付ける
    while (i < chars.length && NO_LINE_START.has(chars[i]) && isWide(chars[i])) {
      word += spaces + chars[i];
      spaces = "";
      i++;
    }
    const width = estimateWrapWidthInEm(word);
    tokens.push({ text: word + spaces, width, fullWidth: estimateWrapWidthInEm(word + spaces) });
  }
  return tokens;
}

/** 1段落(改行を含まない)を、幅 maxEm(em)に収まるように分ける。1行に最低1文字は置く(必ず前に進む) */
function wrapParagraph(paragraph: string, maxEm: number): string[] {
  if (paragraph === "") return [""];
  const lines: string[] = [];
  let current = "";
  let used = 0; // 行の、空白を含む幅
  const push = (): void => {
    lines.push(current);
    current = "";
    used = 0;
  };
  // 1つの語が、1行に収まらないとき: 書記素ごとに置く(1文字は、収まらなくても置く)。
  // 行頭禁則の文字(句読点など)は、前の文字が禁則の文字でなければ、枠からはみ出しても、前の文字と同じ行に置く(連続しては、はみ出さない)
  const placeByCharacters = (text: string): void => {
    let previous = "";
    for (const grapheme of graphemesOf(text)) {
      const width = graphemeWidthInEm(grapheme);
      const hangs = NO_LINE_START.has(grapheme) && previous !== "" && !NO_LINE_START.has(previous);
      if (current !== "" && used + width > maxEm && !hangs) push();
      current += grapheme;
      used += width;
      previous = grapheme;
    }
  };
  for (const token of tokensOf(paragraph)) {
    // 行末の空白は、はみ出してよい(語の幅だけで判定する)
    if (current !== "" && used + token.width > maxEm) push();
    if (token.width > maxEm) {
      placeByCharacters(token.text);
      continue;
    }
    current += token.text;
    used += token.fullWidth;
  }
  if (current !== "") lines.push(current);
  return lines.length === 0 ? [""] : lines;
}

/** 折り返しに必要な、文字の見た目の大きさ。MTEXT の枠の幅(boxWidth)を持つ文字だけが、折り返される */
export type TextLayoutInput = Pick<CadText, "text" | "height" | "boxWidth" | "widthFactor">;

/**
 * 文字を、表示する行に分ける。改行(\n)で分け、枠の幅(boxWidth)があれば、その幅に収まるように折り返す。
 * 枠の幅が無い・有限でない・0 以下、または、文字の大きさが正しくない・文字が極端に長いときは、折り返さない(改行だけで分ける)。
 */
export function layoutTextLines(entity: TextLayoutInput): string[] {
  const paragraphs = entity.text.length > 0 ? entity.text.split("\n") : [""];
  const box = entity.boxWidth;
  const factor = entity.widthFactor ?? 1;
  if (box === undefined || !(box > 0) || !Number.isFinite(box) || !(entity.height > 0) || !(factor > 0) || !Number.isFinite(entity.height * factor) || entity.text.length > MAX_WRAP_CHARACTERS) {
    return paragraphs;
  }
  const maxEm = box / (entity.height * factor);
  if (!(maxEm > 0) || !Number.isFinite(maxEm)) return paragraphs;
  return paragraphs.flatMap((paragraph) => wrapParagraph(paragraph, maxEm));
}

/** 文字の外形の大きさの見積もり(回転・配置の前) */
export function measureTextBlock(entity: TextLayoutInput & Pick<CadText, "isMText">): { width: number; height: number; lines: string[] } {
  const lines = layoutTextLines(entity);
  const factor = entity.widthFactor ?? 1;
  const boxWidth = entity.boxWidth;
  // 枠の幅を持つ MTEXT は、枠の幅が外形の幅(文字が短くても、枠のまま)。ただし、枠より幅の広い行(1文字が枠より広い・行頭禁則の文字がはみ出した)があるときは、
  // そのはみ出しを含める(はみ出した部分も、選択できる)。行末の空白は、数えない
  if (boxWidth !== undefined && boxWidth > 0 && Number.isFinite(boxWidth) && entity.isMText === true) {
    let visible = 0;
    for (const line of lines) visible = Math.max(visible, estimateWrapWidthInEm(line.trimEnd()));
    return { width: Math.max(boxWidth, visible * entity.height * factor), height: lines.length * entity.height * TEXT_LINE_HEIGHT_FACTOR, lines };
  }
  let longest = TEXT_CHAR_WIDTH_FACTOR;
  for (const line of lines) longest = Math.max(longest, estimateLineWidthInEm(line));
  return { width: longest * entity.height * factor, height: lines.length * entity.height * TEXT_LINE_HEIGHT_FACTOR, lines };
}