// 文字スタイルの一覧の保存(このブラウザの localStorage)。Snap の設定と同じ、利用者ごとの設定で、図面のデータではない
// (文字は、描いたときのスタイルの値を持つので、図面は、この設定に依存しない)。
// 保存先が使えない環境(プライベートウィンドウなど)でも、動きは変えない(初期設定で動き、保存だけが行われない)。
import { defaultTextStyleTable, normalizeTextStyleTable } from "../core/text/textStyle";
import type { TextStyleTable } from "../core/text/textStyle";

export const TEXT_STYLE_STORAGE_KEY = "cad-viewer.text-styles.v1";

export function loadTextStyleTable(): TextStyleTable {
  try {
    const raw = window.localStorage.getItem(TEXT_STYLE_STORAGE_KEY);
    return raw === null ? defaultTextStyleTable() : normalizeTextStyleTable(JSON.parse(raw));
  } catch {
    return defaultTextStyleTable();
  }
}

export function saveTextStyleTable(table: TextStyleTable): void {
  try {
    window.localStorage.setItem(TEXT_STYLE_STORAGE_KEY, JSON.stringify(table));
  } catch {
    // 保存できなくても、そのまま続ける
  }
}