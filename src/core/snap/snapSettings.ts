// Snap の設定(OSNAP・SNAP・GRID のオン・オフ、種類ごとのオン・オフ、グリッドの間隔)。画面にも保存先にも依存しない純粋な処理。
import { OBJECT_SNAP_TYPES } from "./snapTypes";
import type { SnapType } from "./snapTypes";

export type ObjectSnapType = Exclude<SnapType, "grid">;

export type SnapSettings = {
  /** OSNAP: 図形への吸着(端点・中点など)全体のオン・オフ */
  objectSnap: boolean;
  /** 図形への吸着の、種類ごとのオン・オフ */
  types: Record<ObjectSnapType, boolean>;
  /** GRID: 格子点の表示 */
  gridDisplay: boolean;
  /** SNAP: 格子点への吸着 */
  gridSnap: boolean;
  /** 格子の間隔(mm) */
  gridSpacing: number;
};

/** 格子の間隔として使える範囲(mm) */
export const MIN_GRID_SPACING = 0.001;
export const MAX_GRID_SPACING = 1_000_000;

/** 初期設定: 既存の4種類(端点・中点・交点・最近点)と、中心・四半円点が有効。垂線・接線・延長は、必要なときにオンにする */
export const DEFAULT_SNAP_SETTINGS: SnapSettings = {
  objectSnap: true,
  types: {
    endpoint: true,
    midpoint: true,
    intersection: true,
    center: true,
    quadrant: true,
    perpendicular: false,
    tangent: false,
    nearest: true,
    extension: false,
  },
  gridDisplay: false,
  gridSnap: false,
  gridSpacing: 10,
};

export function isValidGridSpacing(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= MIN_GRID_SPACING && value <= MAX_GRID_SPACING;
}

/** 格子の間隔の文字(例: "10"、"２５")を読み取る */
export function parseGridSpacing(text: string): { ok: true; value: number } | { ok: false; error: string } {
  const normalized = text.normalize("NFKC").trim();
  if (!/^(\d+\.?\d*|\.\d+)$/.test(normalized)) return { ok: false, error: "格子の間隔は、数値(mm)で入力してください" };
  const value = Number(normalized);
  if (!isValidGridSpacing(value)) {
    return { ok: false, error: `格子の間隔は ${MIN_GRID_SPACING} 〜 ${MAX_GRID_SPACING} mm の範囲にしてください` };
  }
  return { ok: true, value };
}

/** 保存されていた値(JSONなど、信用できないもの)から設定を作る。壊れている・足りない項目は、初期設定で補う */
export function normalizeSnapSettings(raw: unknown): SnapSettings {
  const defaults = DEFAULT_SNAP_SETTINGS;
  if (typeof raw !== "object" || raw === null) return { ...defaults, types: { ...defaults.types } };
  const source = raw as Record<string, unknown>;
  const rawTypes = typeof source.types === "object" && source.types !== null ? (source.types as Record<string, unknown>) : {};
  const types = { ...defaults.types };
  for (const type of OBJECT_SNAP_TYPES as readonly ObjectSnapType[]) {
    if (typeof rawTypes[type] === "boolean") types[type] = rawTypes[type];
  }
  return {
    objectSnap: typeof source.objectSnap === "boolean" ? source.objectSnap : defaults.objectSnap,
    types,
    gridDisplay: typeof source.gridDisplay === "boolean" ? source.gridDisplay : defaults.gridDisplay,
    gridSnap: typeof source.gridSnap === "boolean" ? source.gridSnap : defaults.gridSnap,
    gridSpacing: isValidGridSpacing(source.gridSpacing) ? source.gridSpacing : defaults.gridSpacing,
  };
}

/** 設定から、いま有効な Snap の種類を求める(OSNAP がオフなら、図形への吸着は無い。SNAP がオンなら、グリッドを加える) */
export function enabledSnapTypes(settings: SnapSettings): Set<SnapType> {
  const enabled = new Set<SnapType>();
  if (settings.objectSnap) {
    for (const type of OBJECT_SNAP_TYPES as readonly ObjectSnapType[]) {
      if (settings.types[type]) enabled.add(type);
    }
  }
  if (settings.gridSnap) enabled.add("grid");
  return enabled;
}
