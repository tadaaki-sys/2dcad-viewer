// 線種の表(名前 → 要素列)と、線種から破線(LineDash)を作る処理。React にも画面にも依存しない(core: types だけに依存)。
import type { CadLineType, LineDash } from "../../types/cad";
import { normalizeDashPattern } from "./lineDash";

/** 実線の線種名。表には必ず入っていて、破線パターンは持たない */
export const CONTINUOUS = "CONTINUOUS";

/**
 * 標準の線種(AutoCAD の acadiso.lin と同じ、mm の定義)。取り込んだ図面に同じ名前の線種があれば、そちらが優先される。
 * 要素は、正=線・負=空き・0=点。
 */
export const STANDARD_LINE_TYPES: readonly CadLineType[] = [
  { name: "DASHED", elements: [12.7, -6.35] },
  { name: "DASHED2", elements: [6.35, -3.175] },
  { name: "DASHEDX2", elements: [25.4, -12.7] },
  { name: "HIDDEN", elements: [9.525, -6.35] },
  { name: "HIDDEN2", elements: [4.7625, -3.175] },
  { name: "CENTER", elements: [31.75, -6.35, 6.35, -6.35] },
  { name: "CENTER2", elements: [19.05, -3.175, 3.175, -3.175] },
  { name: "PHANTOM", elements: [31.75, -6.35, 6.35, -6.35, 6.35, -6.35] },
  { name: "DASHDOT", elements: [12.7, -6.35, 0, -6.35] },
  { name: "DOT", elements: [0, -6.35] },
  { name: "DIVIDE", elements: [12.7, -6.35, 0, -6.35, 0, -6.35] },
  { name: "BORDER", elements: [12.7, -6.35, 12.7, -6.35, 0, -6.35] },
];

/** 線種名の比較用(大文字・前後の空白なし)。DXF の線種名は、大文字小文字を区別しない */
export function lineTypeKeyOf(name: string): string {
  return name.trim().toUpperCase();
}

/**
 * 線種表を作る: 実線(CONTINUOUS)、取り込んだ線種(図面の LTYPE。名前の重複は最初のもの)、取り込まれていない標準の線種、の順。
 * BYLAYER・BYBLOCK は線種ではないので入れない。
 */
export function buildLineTypeTable(imported: readonly CadLineType[] | undefined): CadLineType[] {
  const table: CadLineType[] = [{ name: CONTINUOUS, elements: [] }];
  const seen = new Set<string>([CONTINUOUS]);
  const add = (lineType: CadLineType): void => {
    const key = lineTypeKeyOf(lineType.name);
    if (key === "" || key === "BYLAYER" || key === "BYBLOCK" || seen.has(key)) return;
    seen.add(key);
    table.push({ name: lineType.name.trim(), elements: lineType.elements.slice() });
  };
  for (const lineType of imported ?? []) add(lineType);
  for (const lineType of STANDARD_LINE_TYPES) add(lineType);
  return table;
}

/** 破線の鍵。`名前(大文字)@尺度`。取り込んだ図形も、同じ形で持っている */
export function dashKeyOf(name: string, scale: number): string {
  return `${lineTypeKeyOf(name)}@${scale}`;
}

/**
 * 破線の鍵から、図形ごとの線種尺度を取り戻す(鍵の尺度 ÷ 全体の線種尺度)。
 * 取り込んだ図形・新しい図形の鍵(`名前@尺度`)だけが対象。それ以外の鍵(寸法の `dim:…` など)・不正な値は null。
 */
export function entityDashScaleOf(dash: LineDash, ltScale: number): number | null {
  const at = dash.key.lastIndexOf("@");
  if (at < 0 || !(ltScale > 0)) return null;
  // 鍵の名前の部分が、破線の名前と一致するものだけ(別の用途の鍵を、線種の鍵と取り違えない)
  if (dash.key.slice(0, at) !== lineTypeKeyOf(dash.name)) return null;
  const total = Number(dash.key.slice(at + 1));
  // 割り算の最後の桁の誤差(2 が 2.0000000000000004 になるなど)を、有効数字12桁に丸めて取り除く
  const scale = Number((total / ltScale).toPrecision(12));
  return Number.isFinite(total) && total > 0 && Number.isFinite(scale) && scale > 0 ? scale : null;
}

/** 線種表から破線を作る入れ物。同じ線種・尺度の破線は、同じオブジェクトを共有する(取り込み時と同じ) */
export type DashFactory = {
  /** 線種名と図形ごとの尺度から、破線。実線・表に無い線種・破線にならない線種は undefined */
  make: (lineTypeName: string | undefined, entityScale: number) => LineDash | undefined;
  readonly ltScale: number;
};

export function createDashFactory(table: readonly CadLineType[], ltScale: number): DashFactory {
  const byKey = new Map<string, CadLineType>();
  for (const lineType of table) byKey.set(lineTypeKeyOf(lineType.name), lineType);
  const cache = new Map<string, LineDash | null>();
  const scaleBase = ltScale > 0 && Number.isFinite(ltScale) ? ltScale : 1;
  return {
    ltScale: scaleBase,
    make(lineTypeName, entityScale) {
      if (lineTypeName === undefined) return undefined;
      const key = lineTypeKeyOf(lineTypeName);
      if (key === CONTINUOUS || key === "") return undefined;
      const scale = scaleBase * (entityScale > 0 && Number.isFinite(entityScale) ? entityScale : 1);
      // 積が、桁あふれ・桁落ちで、有限の正の数にならないときは、破線にしない(鍵が `NAME@Infinity` になり、尺度を取り戻せなくなるため)
      if (!(scale > 0) || !Number.isFinite(scale)) return undefined;
      const dashKey = dashKeyOf(key, scale);
      let dash = cache.get(dashKey);
      if (dash === undefined) {
        const lineType = byKey.get(key);
        const pattern = lineType === undefined ? null : normalizeDashPattern(lineType.elements, scale);
        dash = pattern === null ? null : { key: dashKey, name: lineType!.name, pattern };
        cache.set(dashKey, dash);
      }
      return dash ?? undefined;
    },
  };
}
