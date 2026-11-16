/** 座標・寸法の表示(小数点以下1桁。-0 は 0 と表示する)。表示だけで、内部の値は丸めない(仕様: mm、表示は小数1桁) */
export function formatCoordinate(value: number): string {
  const text = value.toFixed(1);
  return text === "-0.0" ? "0.0" : text;
}
