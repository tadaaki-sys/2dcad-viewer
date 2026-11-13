/** 座標・寸法の表示(小数点以下3桁。-0 は 0 と表示する) */
export function formatCoordinate(value: number): string {
  const text = value.toFixed(3);
  return text === "-0.000" ? "0.000" : text;
}
