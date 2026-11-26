// CAD(AutoCAD系)の画面表示と同じ考え方: 線の太さは拡大率に関係なく画面上で一定で、96dpi換算のpx幅になる。
// 0.25mm以下は1pxに丸められるので細い線は変わらず、0.50mmなら約2pxの太線として見える。
const CSS_PX_PER_MM = 96 / 25.4;
const MIN_LINE_WIDTH_PX = 1;
const WIDTH_STEP_PX = 0.5;

/** これ以下(0.27mm)の太さは常に1pxで描くので、図形へ保持する必要がない */
export const THIN_LINE_WEIGHT_LIMIT = 27;

/** 標準の線の太さ(AutoCAD と同じ。1/100mm)。レイヤーの線の太さは、この値から選ぶ */
export const STANDARD_LINE_WEIGHTS: readonly number[] = [0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140, 158, 200, 211];

export function isStandardLineWeight(value: number): boolean {
  return STANDARD_LINE_WEIGHTS.includes(value);
}

/** 線の太さの表示名(例: 0.25 mm) */
export function lineWeightLabel(hundredthMm: number): string {
  return `${(hundredthMm / 100).toFixed(2)} mm`;
}

/** 線の太さ(1/100mm)を、画面上の線幅px(0.5px刻み)へ換算する。無効な値や細い線は1px */
export function lineWeightToScreenWidthPx(lineWeightHundredthMm: number): number {
  if (!Number.isFinite(lineWeightHundredthMm) || lineWeightHundredthMm <= 0) return MIN_LINE_WIDTH_PX;
  const px = (lineWeightHundredthMm / 100) * CSS_PX_PER_MM;
  return Math.max(MIN_LINE_WIDTH_PX, Math.round(px / WIDTH_STEP_PX) * WIDTH_STEP_PX);
}
