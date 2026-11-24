// 文字スタイル(名前を付けた、フォント・高さ・幅係数・斜体・配置の組)。画面にもファイル形式にも依存しない純粋な処理。
//
// 文字は、描いたときのスタイルの値を、そのまま持つ(コピー)。スタイル名は記録するだけで、スタイルを後で変えても、
// すでに描いた文字は変わらない(連動して変わる仕組みは、プロパティ・スタイル管理の Phase で検討する)。
// スタイルの一覧は、図面のデータではなく、利用者ごとの設定(このブラウザに保存)。図面ファイルへの保存は、保存の Phase で行う。
import type { CadHorizontalAlign, CadVerticalAlign } from "../../types/cad";

export type TextStyle = {
  name: string;
  /** フォント名(CSS のフォント名。"sans-serif" などの総称、または、フォントの名前) */
  fontFamily: string;
  /** 文字の高さ(mm) */
  height: number;
  /** 文字の横幅の倍率 */
  widthFactor: number;
  italic: boolean;
  horizontalAlign: CadHorizontalAlign;
  verticalAlign: CadVerticalAlign;
};

export const STANDARD_STYLE_NAME = "Standard";

export const DEFAULT_TEXT_STYLE: TextStyle = {
  name: STANDARD_STYLE_NAME,
  fontFamily: "sans-serif",
  height: 100,
  widthFactor: 1,
  italic: false,
  horizontalAlign: "left",
  verticalAlign: "baseline",
};

/** 値の範囲(これを超える値は、断る) */
export const TEXT_STYLE_LIMITS = {
  minHeight: 0.001,
  maxHeight: 1e6,
  minWidthFactor: 0.1,
  maxWidthFactor: 10,
  maxNameLength: 64,
  maxFontLength: 100,
  maxStyles: 100,
} as const;

/** 入力欄の候補にするフォント(自由に入力もできる。入っていないフォントは、ブラウザが代わりのフォントで描く) */
export const FONT_SUGGESTIONS: readonly string[] = ["sans-serif", "serif", "monospace", "MS ゴシック", "MS 明朝", "メイリオ", "游ゴシック", "游明朝"];

const GENERIC_FAMILIES = new Set(["sans-serif", "serif", "monospace", "cursive", "fantasy", "system-ui"]);
const HORIZONTAL: readonly CadHorizontalAlign[] = ["left", "center", "right"];
const VERTICAL: readonly CadVerticalAlign[] = ["baseline", "bottom", "middle", "top"];

/** フォント名として使えるか(引用符・バックスラッシュ・制御文字・CSS の区切りを含まない、長すぎない) */
export function isValidFontFamily(name: string): boolean {
  if (name.trim() === "" || name.length > TEXT_STYLE_LIMITS.maxFontLength) return false;
  // eslint-disable-next-line no-control-regex
  return !/["'\\;{}<>`\u0000-\u001f\u007f]/.test(name);
}

/** 描画に使う、CSS のフォント指定(代わりのフォントとして sans-serif を付ける)。正しくない名前・未指定は、sans-serif */
export function cssFontFamily(fontFamily: string | undefined): string {
  if (fontFamily === undefined) return "sans-serif";
  const name = fontFamily.trim();
  if (!isValidFontFamily(name)) return "sans-serif";
  if (GENERIC_FAMILIES.has(name.toLowerCase())) return name.toLowerCase();
  return `"${name}", sans-serif`;
}

/** スタイルの値を確かめる。正しければ null、正しくなければ理由 */
export function validateTextStyle(style: TextStyle): string | null {
  const name = style.name;
  if (name !== name.trim() || name === "") return "スタイルの名前を入力してください(前後の空白は付けられません)";
  if (name.length > TEXT_STYLE_LIMITS.maxNameLength) return `スタイルの名前は ${TEXT_STYLE_LIMITS.maxNameLength} 文字以内にしてください`;
  if (!isValidFontFamily(style.fontFamily)) return "フォント名が正しくありません(引用符・バックスラッシュ・制御文字は使えません)";
  if (!Number.isFinite(style.height) || style.height < TEXT_STYLE_LIMITS.minHeight || style.height > TEXT_STYLE_LIMITS.maxHeight) {
    return `文字の高さは、${TEXT_STYLE_LIMITS.minHeight} 〜 ${TEXT_STYLE_LIMITS.maxHeight} mm の数にしてください`;
  }
  if (!Number.isFinite(style.widthFactor) || style.widthFactor < TEXT_STYLE_LIMITS.minWidthFactor || style.widthFactor > TEXT_STYLE_LIMITS.maxWidthFactor) {
    return `幅係数は、${TEXT_STYLE_LIMITS.minWidthFactor} 〜 ${TEXT_STYLE_LIMITS.maxWidthFactor} の数にしてください`;
  }
  if (!HORIZONTAL.includes(style.horizontalAlign) || !VERTICAL.includes(style.verticalAlign)) return "配置が正しくありません";
  if (typeof style.italic !== "boolean") return "斜体の指定が正しくありません";
  return null;
}

/** スタイルの一覧と、現在のスタイル(名前) */
export type TextStyleTable = { styles: readonly TextStyle[]; current: string };

export function defaultTextStyleTable(): TextStyleTable {
  return { styles: [DEFAULT_TEXT_STYLE], current: STANDARD_STYLE_NAME };
}

/** 保存された値(信用できない)から、正しいスタイルの一覧を作る。正しくないスタイルは捨てる。Standard が無ければ、補う */
export function normalizeTextStyleTable(raw: unknown): TextStyleTable {
  const fallback = defaultTextStyleTable();
  if (typeof raw !== "object" || raw === null) return fallback;
  const record = raw as { styles?: unknown; current?: unknown };
  const styles: TextStyle[] = [];
  if (Array.isArray(record.styles)) {
    // 読む要素数も制限する(不正な要素ばかりの、巨大な配列でも、重くならない)
    for (const item of record.styles.slice(0, TEXT_STYLE_LIMITS.maxStyles * 4)) {
      if (styles.length >= TEXT_STYLE_LIMITS.maxStyles) break;
      if (typeof item !== "object" || item === null) continue;
      const s = item as Partial<Record<keyof TextStyle, unknown>>;
      const style: TextStyle = {
        name: typeof s.name === "string" ? s.name : "",
        fontFamily: typeof s.fontFamily === "string" ? s.fontFamily : "",
        height: typeof s.height === "number" ? s.height : Number.NaN,
        widthFactor: typeof s.widthFactor === "number" ? s.widthFactor : Number.NaN,
        italic: s.italic as boolean,
        horizontalAlign: s.horizontalAlign as CadHorizontalAlign,
        verticalAlign: s.verticalAlign as CadVerticalAlign,
      };
      if (validateTextStyle(style) !== null) continue;
      if (styles.some((existing) => existing.name === style.name)) continue;
      styles.push(style);
    }
  }
  // Standard が無ければ補う。補っても、上限を超えない(最後の1つを、あきらめる)
  if (!styles.some((style) => style.name === STANDARD_STYLE_NAME)) {
    if (styles.length >= TEXT_STYLE_LIMITS.maxStyles) styles.length = TEXT_STYLE_LIMITS.maxStyles - 1;
    styles.unshift(DEFAULT_TEXT_STYLE);
  }
  const current = typeof record.current === "string" && styles.some((style) => style.name === record.current) ? record.current : STANDARD_STYLE_NAME;
  return { styles, current };
}

export type TextStyleResult = { ok: true; table: TextStyleTable } | { ok: false; message: string };

const fail = (message: string): TextStyleResult => ({ ok: false, message });

/** 現在のスタイル */
export function currentTextStyle(table: TextStyleTable): TextStyle {
  return table.styles.find((style) => style.name === table.current) ?? table.styles.find((style) => style.name === STANDARD_STYLE_NAME) ?? DEFAULT_TEXT_STYLE;
}

/** 新しいスタイルを足す(現在のスタイルにする) */
export function addTextStyle(table: TextStyleTable, style: TextStyle): TextStyleResult {
  const invalid = validateTextStyle(style);
  if (invalid !== null) return fail(invalid);
  if (table.styles.some((existing) => existing.name === style.name)) return fail(`「${style.name}」という名前のスタイルが、すでにあります`);
  if (table.styles.length >= TEXT_STYLE_LIMITS.maxStyles) return fail(`スタイルは ${TEXT_STYLE_LIMITS.maxStyles} 個までです`);
  return { ok: true, table: { styles: [...table.styles, style], current: style.name } };
}

/** スタイルの値を変える(名前は変えない)。Standard も、値は変えられる */
export function updateTextStyle(table: TextStyleTable, name: string, patch: Partial<Omit<TextStyle, "name">>): TextStyleResult {
  const index = table.styles.findIndex((style) => style.name === name);
  if (index < 0) return fail(`「${name}」というスタイルがありません`);
  const next = { ...table.styles[index], ...patch };
  const invalid = validateTextStyle(next);
  if (invalid !== null) return fail(invalid);
  return { ok: true, table: { ...table, styles: table.styles.map((style, i) => (i === index ? next : style)) } };
}

/** スタイルの名前を変える(Standard は、名前を変えられない) */
export function renameTextStyle(table: TextStyleTable, from: string, to: string): TextStyleResult {
  if (from === STANDARD_STYLE_NAME) return fail(`「${STANDARD_STYLE_NAME}」の名前は変えられません`);
  const index = table.styles.findIndex((style) => style.name === from);
  if (index < 0) return fail(`「${from}」というスタイルがありません`);
  if (from === to) return { ok: true, table };
  const next = { ...table.styles[index], name: to };
  const invalid = validateTextStyle(next);
  if (invalid !== null) return fail(invalid);
  if (table.styles.some((style) => style.name === to)) return fail(`「${to}」という名前のスタイルが、すでにあります`);
  return { ok: true, table: { styles: table.styles.map((style, i) => (i === index ? next : style)), current: table.current === from ? to : table.current } };
}

/** スタイルを削除する(Standard は、削除できない)。現在のスタイルを削除したときは、Standard に戻る */
export function deleteTextStyle(table: TextStyleTable, name: string): TextStyleResult {
  if (name === STANDARD_STYLE_NAME) return fail(`「${STANDARD_STYLE_NAME}」は削除できません`);
  if (!table.styles.some((style) => style.name === name)) return fail(`「${name}」というスタイルがありません`);
  return { ok: true, table: { styles: table.styles.filter((style) => style.name !== name), current: table.current === name ? STANDARD_STYLE_NAME : table.current } };
}

/** 現在のスタイルを切り替える */
export function setCurrentTextStyle(table: TextStyleTable, name: string): TextStyleResult {
  if (!table.styles.some((style) => style.name === name)) return fail(`「${name}」というスタイルがありません`);
  return { ok: true, table: { ...table, current: name } };
}
