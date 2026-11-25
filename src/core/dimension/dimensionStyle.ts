// 寸法スタイル(名前を付けた、寸法の見た目の組)。画面にもファイル形式にも依存しない純粋な処理。
//
// 寸法は、描いたときのスタイルの値を、そのまま持つ(コピー)。スタイル名は記録するだけで、スタイルを後で変えても、
// すでに描いた寸法は変わらない(文字スタイルと同じ。連動して変わる仕組みは、プロパティ・スタイル管理の Phase で検討する)。
// スタイルの一覧は、図面のデータではなく、利用者ごとの設定(このブラウザに保存)。図面ファイルへの保存は、保存の Phase で行う。
//
// 寸法の見た目のうち、文字の高さ・矢印・小数桁・単位・補助線の間隔は、寸法の中(CadDimensionValues)に持つ。
// 色・レイヤー・線種は、描く図形そのものの属性(color・layer・lineDash)になる。
import type { CadDimensionKind, CadDimensionUnit, CadDimensionValues, LineDash } from "../../types/cad";
import { DIMENSION_UNITS, MAX_DECIMALS } from "./dimensionFormat";
import { normalizeDashPattern } from "../style/lineDash";

/** 寸法の線種(新しい寸法に付ける。線種の管理は、Layer / Linetype の Phase で整える) */
export type DimensionLinetype = "continuous" | "dashed" | "center" | "phantom";

export type DimensionStyle = {
  name: string;
  textHeight: number;
  arrowSize: number;
  decimals: number;
  angleDecimals: number;
  unit: CadDimensionUnit;
  showUnit: boolean;
  extensionOffset: number;
  /** 色(#rrggbb)。null = 描くレイヤーの色 */
  color: string | null;
  /** レイヤー名。null = 現在のレイヤー */
  layer: string | null;
  linetype: DimensionLinetype;
};

export const STANDARD_DIMENSION_STYLE_NAME = "Standard";

export const DEFAULT_DIMENSION_STYLE: DimensionStyle = {
  name: STANDARD_DIMENSION_STYLE_NAME,
  textHeight: 100,
  arrowSize: 100,
  decimals: 0,
  angleDecimals: 1,
  unit: "mm",
  showUnit: false,
  extensionOffset: 50,
  color: null,
  layer: null,
  linetype: "continuous",
};

/** 値の範囲(これを超える値は、断る) */
export const DIMENSION_STYLE_LIMITS = {
  minSize: 0.001,
  maxSize: 1e6,
  maxExtensionOffset: 1e6,
  maxNameLength: 64,
  maxLayerLength: 255,
  maxStyles: 100,
} as const;

export const DIMENSION_LINETYPES: readonly DimensionLinetype[] = ["continuous", "dashed", "center", "phantom"];

export const DIMENSION_LINETYPE_LABELS: Readonly<Record<DimensionLinetype, string>> = {
  continuous: "実線",
  dashed: "破線",
  center: "中心線",
  phantom: "一点鎖線",
};

export const DIMENSION_KIND_LABELS: Readonly<Record<CadDimensionKind, string>> = {
  linear: "Linear",
  aligned: "Aligned",
  radius: "Radius",
  diameter: "Diameter",
  angular: "Angular",
};

const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/** 線種の模様(文字の高さ 2.5mm を基準にした、線・空きの長さの並び。文字の高さに比例して伸び縮みする) */
const LINETYPE_PATTERNS: Readonly<Record<Exclude<DimensionLinetype, "continuous">, readonly number[]>> = {
  dashed: [12, -6],
  center: [32, -6, 6, -6],
  phantom: [25, -6, 6, -6, 6, -6],
};

/**
 * 線種から、寸法に付ける破線のパターンを作る(実線は undefined)。文字の高さに比例した長さにする
 * (寸法のスタイルの文字の高さが、図面の縮尺に合わせた大きさになっているため)。
 */
export function dimensionLineDash(linetype: DimensionLinetype, textHeight: number): LineDash | undefined {
  if (linetype === "continuous") return undefined;
  const scale = textHeight / 2.5;
  const pattern = normalizeDashPattern(LINETYPE_PATTERNS[linetype], scale);
  if (pattern === null) return undefined;
  return { key: `dim:${linetype}:${scale}`, name: DIMENSION_LINETYPE_LABELS[linetype], pattern };
}

const inRange = (value: number, min: number, max: number): boolean => Number.isFinite(value) && value >= min && value <= max;

/** スタイルの値を確かめる。正しければ null、正しくなければ理由 */
export function validateDimensionStyle(style: DimensionStyle): string | null {
  const name = style.name;
  if (name !== name.trim() || name === "") return "スタイルの名前を入力してください(前後の空白は付けられません)";
  if (name.length > DIMENSION_STYLE_LIMITS.maxNameLength) return `スタイルの名前は ${DIMENSION_STYLE_LIMITS.maxNameLength} 文字以内にしてください`;
  const { minSize, maxSize } = DIMENSION_STYLE_LIMITS;
  if (!inRange(style.textHeight, minSize, maxSize)) return `文字の高さは、${minSize} 〜 ${maxSize} mm の数にしてください`;
  if (!inRange(style.arrowSize, minSize, maxSize)) return `矢印の大きさは、${minSize} 〜 ${maxSize} mm の数にしてください`;
  if (!inRange(style.extensionOffset, 0, DIMENSION_STYLE_LIMITS.maxExtensionOffset)) return `補助線の間隔は、0 〜 ${DIMENSION_STYLE_LIMITS.maxExtensionOffset} mm の数にしてください`;
  if (!Number.isInteger(style.decimals) || style.decimals < 0 || style.decimals > MAX_DECIMALS) return `小数桁は、0 〜 ${MAX_DECIMALS} の整数にしてください`;
  if (!Number.isInteger(style.angleDecimals) || style.angleDecimals < 0 || style.angleDecimals > MAX_DECIMALS) return `角度の小数桁は、0 〜 ${MAX_DECIMALS} の整数にしてください`;
  if (!DIMENSION_UNITS.includes(style.unit)) return "単位が正しくありません";
  if (typeof style.showUnit !== "boolean") return "単位の表示の指定が正しくありません";
  if (style.color !== null && (typeof style.color !== "string" || !COLOR_PATTERN.test(style.color))) return "色は、#rrggbb の形で入力してください";
  if (style.layer !== null && (typeof style.layer !== "string" || style.layer === "" || style.layer.length > DIMENSION_STYLE_LIMITS.maxLayerLength)) return "レイヤー名が正しくありません";
  if (!DIMENSION_LINETYPES.includes(style.linetype)) return "線種が正しくありません";
  return null;
}

/** スタイルから、寸法に持たせる値(描いたときの値のコピー)を取り出す */
export function dimensionValuesOf(style: DimensionStyle): CadDimensionValues {
  return {
    textHeight: style.textHeight,
    arrowSize: style.arrowSize,
    decimals: style.decimals,
    angleDecimals: style.angleDecimals,
    unit: style.unit,
    showUnit: style.showUnit,
    extensionOffset: style.extensionOffset,
  };
}

/** スタイルの一覧と、現在のスタイル(名前) */
export type DimensionStyleTable = { styles: readonly DimensionStyle[]; current: string };

export function defaultDimensionStyleTable(): DimensionStyleTable {
  return { styles: [DEFAULT_DIMENSION_STYLE], current: STANDARD_DIMENSION_STYLE_NAME };
}

/** 保存された値(信用できない)から、正しいスタイルの一覧を作る。正しくないスタイルは捨てる。Standard が無ければ、補う */
export function normalizeDimensionStyleTable(raw: unknown): DimensionStyleTable {
  const fallback = defaultDimensionStyleTable();
  if (typeof raw !== "object" || raw === null) return fallback;
  const record = raw as { styles?: unknown; current?: unknown };
  const styles: DimensionStyle[] = [];
  if (Array.isArray(record.styles)) {
    // 読む要素数も制限する(不正な要素ばかりの、巨大な配列でも、重くならない)
    for (const item of record.styles.slice(0, DIMENSION_STYLE_LIMITS.maxStyles * 4)) {
      if (styles.length >= DIMENSION_STYLE_LIMITS.maxStyles) break;
      if (typeof item !== "object" || item === null) continue;
      const s = item as Partial<Record<keyof DimensionStyle, unknown>>;
      const num = (value: unknown): number => (typeof value === "number" ? value : Number.NaN);
      const style: DimensionStyle = {
        name: typeof s.name === "string" ? s.name : "",
        textHeight: num(s.textHeight),
        arrowSize: num(s.arrowSize),
        decimals: num(s.decimals),
        angleDecimals: num(s.angleDecimals),
        unit: s.unit as CadDimensionUnit,
        showUnit: s.showUnit as boolean,
        extensionOffset: num(s.extensionOffset),
        color: s.color as string | null,
        layer: s.layer as string | null,
        linetype: s.linetype as DimensionLinetype,
      };
      if (validateDimensionStyle(style) !== null) continue;
      if (styles.some((existing) => existing.name === style.name)) continue;
      styles.push(style);
    }
  }
  // Standard が無ければ補う。補っても、上限を超えない(最後の1つを、あきらめる)
  if (!styles.some((style) => style.name === STANDARD_DIMENSION_STYLE_NAME)) {
    if (styles.length >= DIMENSION_STYLE_LIMITS.maxStyles) styles.length = DIMENSION_STYLE_LIMITS.maxStyles - 1;
    styles.unshift(DEFAULT_DIMENSION_STYLE);
  }
  const current = typeof record.current === "string" && styles.some((style) => style.name === record.current) ? record.current : STANDARD_DIMENSION_STYLE_NAME;
  return { styles, current };
}

export type DimensionStyleResult = { ok: true; table: DimensionStyleTable } | { ok: false; message: string };

const fail = (message: string): DimensionStyleResult => ({ ok: false, message });

/** 現在のスタイル */
export function currentDimensionStyle(table: DimensionStyleTable): DimensionStyle {
  return table.styles.find((style) => style.name === table.current) ?? table.styles.find((style) => style.name === STANDARD_DIMENSION_STYLE_NAME) ?? DEFAULT_DIMENSION_STYLE;
}

/** 新しいスタイルを足す(現在のスタイルにする) */
export function addDimensionStyle(table: DimensionStyleTable, style: DimensionStyle): DimensionStyleResult {
  const invalid = validateDimensionStyle(style);
  if (invalid !== null) return fail(invalid);
  if (table.styles.some((existing) => existing.name === style.name)) return fail(`「${style.name}」という名前のスタイルが、すでにあります`);
  if (table.styles.length >= DIMENSION_STYLE_LIMITS.maxStyles) return fail(`スタイルは ${DIMENSION_STYLE_LIMITS.maxStyles} 個までです`);
  return { ok: true, table: { styles: [...table.styles, style], current: style.name } };
}

/** スタイルの値を変える(名前は変えない)。Standard も、値は変えられる */
export function updateDimensionStyle(table: DimensionStyleTable, name: string, patch: Partial<Omit<DimensionStyle, "name">>): DimensionStyleResult {
  const index = table.styles.findIndex((style) => style.name === name);
  if (index < 0) return fail(`「${name}」というスタイルがありません`);
  const next = { ...table.styles[index], ...patch };
  const invalid = validateDimensionStyle(next);
  if (invalid !== null) return fail(invalid);
  return { ok: true, table: { ...table, styles: table.styles.map((style, i) => (i === index ? next : style)) } };
}

/** スタイルの名前を変える(Standard は、名前を変えられない) */
export function renameDimensionStyle(table: DimensionStyleTable, from: string, to: string): DimensionStyleResult {
  if (from === STANDARD_DIMENSION_STYLE_NAME) return fail(`「${STANDARD_DIMENSION_STYLE_NAME}」の名前は変えられません`);
  const index = table.styles.findIndex((style) => style.name === from);
  if (index < 0) return fail(`「${from}」というスタイルがありません`);
  if (from === to) return { ok: true, table };
  const next = { ...table.styles[index], name: to };
  const invalid = validateDimensionStyle(next);
  if (invalid !== null) return fail(invalid);
  if (table.styles.some((style) => style.name === to)) return fail(`「${to}」という名前のスタイルが、すでにあります`);
  return { ok: true, table: { styles: table.styles.map((style, i) => (i === index ? next : style)), current: table.current === from ? to : table.current } };
}

/** スタイルを削除する(Standard は、削除できない)。現在のスタイルを削除したときは、Standard に戻る */
export function deleteDimensionStyle(table: DimensionStyleTable, name: string): DimensionStyleResult {
  if (name === STANDARD_DIMENSION_STYLE_NAME) return fail(`「${STANDARD_DIMENSION_STYLE_NAME}」は削除できません`);
  if (!table.styles.some((style) => style.name === name)) return fail(`「${name}」というスタイルがありません`);
  return { ok: true, table: { styles: table.styles.filter((style) => style.name !== name), current: table.current === name ? STANDARD_DIMENSION_STYLE_NAME : table.current } };
}

/** 現在のスタイルを切り替える */
export function setCurrentDimensionStyle(table: DimensionStyleTable, name: string): DimensionStyleResult {
  if (!table.styles.some((style) => style.name === name)) return fail(`「${name}」というスタイルがありません`);
  return { ok: true, table: { ...table, current: name } };
}
