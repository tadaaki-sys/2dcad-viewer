// 寸法スタイルの一覧の保存(このブラウザの localStorage)。文字スタイルと同じ、利用者ごとの設定で、図面のデータではない
// (寸法は、描いたときのスタイルの値を持つので、図面は、この設定に依存しない)。
// 保存先が使えない環境(プライベートウィンドウなど)でも、動きは変えない(初期設定で動き、保存だけが行われない)。
import { defaultDimensionStyleTable, normalizeDimensionStyleTable } from "../core/dimension/dimensionStyle";
import type { DimensionStyleTable } from "../core/dimension/dimensionStyle";

export const DIMENSION_STYLE_STORAGE_KEY = "cad-viewer.dimension-styles.v1";

export function loadDimensionStyleTable(): DimensionStyleTable {
  try {
    const raw = window.localStorage.getItem(DIMENSION_STYLE_STORAGE_KEY);
    return raw === null ? defaultDimensionStyleTable() : normalizeDimensionStyleTable(JSON.parse(raw));
  } catch {
    return defaultDimensionStyleTable();
  }
}

export function saveDimensionStyleTable(table: DimensionStyleTable): void {
  try {
    window.localStorage.setItem(DIMENSION_STYLE_STORAGE_KEY, JSON.stringify(table));
  } catch {
    // 保存できなくても、そのまま続ける
  }
}
