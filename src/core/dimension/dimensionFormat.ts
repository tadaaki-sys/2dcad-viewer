// 寸法の数値の整形(長さ・半径・直径・角度)。画面にもファイル形式にも依存しない純粋な処理。
import type { CadDimensionUnit, CadDimensionValues } from "../../types/cad";

/** 図面の単位(mm)を、表示の単位に換算するときの割る数 */
export const UNIT_DIVISOR: Readonly<Record<CadDimensionUnit, number>> = { mm: 1, cm: 10, m: 1000 };

export const DIMENSION_UNITS: readonly CadDimensionUnit[] = ["mm", "cm", "m"];

/** 小数桁の上限 */
export const MAX_DECIMALS = 8;

/** 数値を、小数桁を指定して文字にする。-0 は 0 にそろえる。桁が大きすぎて指数表記になる値は、指数表記のまま */
function formatNumber(value: number, decimals: number): string {
  if (!Number.isFinite(value)) return "?";
  const places = Math.min(MAX_DECIMALS, Math.max(0, Math.trunc(decimals)));
  const text = Math.abs(value) >= 1e21 ? value.toExponential(places) : value.toFixed(places);
  // 丸めて 0 になる負の値("-0.00")は、符号を付けない
  return /^-0(\.0*)?$/.test(text) ? text.slice(1) : text;
}

/** 長さ(図面の単位 mm)の表示。単位に換算し、小数桁に丸め、必要なら単位を付ける */
export function formatDimensionLength(lengthMm: number, values: Pick<CadDimensionValues, "decimals" | "unit" | "showUnit">): string {
  const text = formatNumber(lengthMm / UNIT_DIVISOR[values.unit], values.decimals);
  return values.showUnit ? `${text} ${values.unit}` : text;
}

/** 半径の表示("R" を付ける) */
export function formatDimensionRadius(radiusMm: number, values: Pick<CadDimensionValues, "decimals" | "unit" | "showUnit">): string {
  return `R${formatDimensionLength(radiusMm, values)}`;
}

/** 直径の表示("Ø" を付ける) */
export function formatDimensionDiameter(diameterMm: number, values: Pick<CadDimensionValues, "decimals" | "unit" | "showUnit">): string {
  return `Ø${formatDimensionLength(diameterMm, values)}`;
}

/** 角度(ラジアン)の表示。度に直し、小数桁に丸める("°" を付ける) */
export function formatDimensionAngle(radians: number, values: Pick<CadDimensionValues, "angleDecimals">): string {
  return `${formatNumber((radians * 180) / Math.PI, values.angleDecimals)}°`;
}
