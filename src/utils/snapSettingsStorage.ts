// Snap の設定の保存(このブラウザの localStorage)。見た目の好みと同じ、利用者ごとの設定で、図面のデータではない。
// 保存先が使えない環境(プライベートウィンドウなど)でも、動きは変えない(初期設定で動き、保存だけが行われない)。
import { normalizeSnapSettings } from "../core/snap/snapSettings";
import type { SnapSettings } from "../core/snap/snapSettings";

export const SNAP_SETTINGS_STORAGE_KEY = "cad-viewer.snap-settings.v1";

export function loadSnapSettings(): SnapSettings {
  try {
    const raw = window.localStorage.getItem(SNAP_SETTINGS_STORAGE_KEY);
    return normalizeSnapSettings(raw === null ? null : JSON.parse(raw));
  } catch {
    return normalizeSnapSettings(null);
  }
}

export function saveSnapSettings(settings: SnapSettings): void {
  try {
    window.localStorage.setItem(SNAP_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // 保存できなくても、そのまま続ける
  }
}
