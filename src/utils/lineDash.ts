const MAX_PATTERN_ELEMENTS = 16;

/**
 * DXFのLTYPE要素列(正=線、負=空き、0=点)を、描画で使う[線,空き,線,空き,...]へ正規化する。
 * 連続する線同士・空き同士は1つに合算し、末尾が線なら長さ0の空きを足して偶数個にする。
 * 破線として意味のあるパターンでなければ(実線など)nullを返す。
 */
export function normalizeDashPattern(elements: readonly number[], scale: number): number[] | null {
  if (!(scale > 0) || elements.length < 2) return null;

  const out: number[] = [];
  for (const element of elements) {
    if (!Number.isFinite(element)) return null;
    const length = Math.abs(element) * scale;
    const nextIsDash = out.length % 2 === 0;

    if (element >= 0) {
      if (nextIsDash) out.push(length);
      else out[out.length - 1] += length;
    } else if (nextIsDash) {
      if (out.length === 0) out.push(0, length);
      else out[out.length - 1] += length;
    } else {
      out.push(length);
    }
  }
  if (out.length % 2 === 1) out.push(0);

  const period = out.reduce((sum, value) => sum + value, 0);
  if (!(period > 0) || !Number.isFinite(period) || out.length > MAX_PATTERN_ELEMENTS) return null;
  // 空きが1つも無ければ実線と同じ
  if (!out.some((value, index) => index % 2 === 1 && value > 0)) return null;
  return out;
}
