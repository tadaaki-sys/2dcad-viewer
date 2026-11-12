// CAD(AutoCAD系)の画面表示と同じ考え方: 線の太さは拡大率に関係なく画面上で一定で、96dpi換算のpx幅になる。
// 0.25mm以下は1pxに丸められるので細い線は変わらず、0.50mmなら約2pxの太線として見える。
const CSS_PX_PER_MM = 96 / 25.4;
const MIN_LINE_WIDTH_PX = 1;
const WIDTH_STEP_PX = 0.5;

/** これ以下(0.27mm)の太さは常に1pxで描くので、図形へ保持する必要がない */
export const THIN_LINE_WEIGHT_LIMIT = 27;

/** 線の太さ(1/100mm)を、画面上の線幅px(0.5px刻み)へ換算する。無効な値や細い線は1px */
export function lineWeightToScreenWidthPx(lineWeightHundredthMm: number): number {
  if (!Number.isFinite(lineWeightHundredthMm) || lineWeightHundredthMm <= 0) return MIN_LINE_WIDTH_PX;
  const px = (lineWeightHundredthMm / 100) * CSS_PX_PER_MM;
  return Math.max(MIN_LINE_WIDTH_PX, Math.round(px / WIDTH_STEP_PX) * WIDTH_STEP_PX);
}
