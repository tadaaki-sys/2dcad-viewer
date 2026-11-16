// トラッキングの設定の保存(このブラウザの localStorage)。Snap の設定と同じ、利用者ごとの設定で、図面のデータではない。
// 保存先が使えない環境でも、動きは変えない(初期設定で動き、保存だけが行われない)。
import { normalizeTrackingSettings } from "../core/tracking/trackingSettings";
import type { TrackingSettings } from "../core/tracking/trackingSettings";

export const TRACKING_SETTINGS_STORAGE_KEY = "cad-viewer.tracking-settings.v1";

export function loadTrackingSettings(): TrackingSettings {
  try {
    const raw = window.localStorage.getItem(TRACKING_SETTINGS_STORAGE_KEY);
    return normalizeTrackingSettings(raw === null ? null : JSON.parse(raw));
  } catch {
    return normalizeTrackingSettings(null);
  }
}

export function saveTrackingSettings(settings: TrackingSettings): void {
  try {
    window.localStorage.setItem(TRACKING_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // 保存できなくても、そのまま続ける
  }
}
