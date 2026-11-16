// トラッキングの設定(ORTHO・POLAR・OTRACK のオン・オフ、極トラッキングの角度の刻み、トラッキング間隔)。
// 画面にも保存先にも依存しない純粋な処理。
export type TrackingToggle = "ortho" | "polar" | "objectTracking";

export type TrackingSettings = {
  /** ORTHO: 基準点からの水平・垂直に揃える */
  ortho: boolean;
  /** POLAR(極トラッキング): 基準点から、角度の刻みの方向に揃える */
  polar: boolean;
  /** OTRACK(オブジェクトスナップトラッキング): 取得した吸着点から、水平・垂直(POLAR がオンなら角度の刻み)に揃える */
  objectTracking: boolean;
  /** 極トラッキングの角度の刻み(度) */
  polarAngleIncrement: number;
  /** トラッキング間隔(mm)。極トラッキングで揃えた方向の上で、基準点からの距離を、この倍数に揃える。0 なら、揃えない */
  distanceIncrement: number;
};

/** 角度の刻みとして選べる値(度) */
export const POLAR_ANGLE_INCREMENTS: readonly number[] = [5, 10, 15, 18, 22.5, 30, 45, 90];

/** トラッキング間隔の下限(mm。0 は「揃えない」)。極端に小さい値では、距離を間隔で割った値が溢れて、座標が有限でなくなる */
export const MIN_DISTANCE_INCREMENT = 0.001;
/** トラッキング間隔の上限(mm) */
export const MAX_DISTANCE_INCREMENT = 1_000_000;

/** 初期設定: 3つともオフ(従来の操作のまま)。刻みは 45°、間隔は無し */
export const DEFAULT_TRACKING_SETTINGS: TrackingSettings = {
  ortho: false,
  polar: false,
  objectTracking: false,
  polarAngleIncrement: 45,
  distanceIncrement: 0,
};

export const TRACKING_LABELS: Record<TrackingToggle, string> = {
  ortho: "ORTHO(直交)",
  polar: "POLAR(極トラッキング)",
  objectTracking: "OTRACK(オブジェクトスナップトラッキング)",
};

export function isValidAngleIncrement(value: unknown): value is number {
  return typeof value === "number" && POLAR_ANGLE_INCREMENTS.includes(value);
}

export function isValidDistanceIncrement(value: unknown): value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  return value === 0 || (value >= MIN_DISTANCE_INCREMENT && value <= MAX_DISTANCE_INCREMENT);
}

/** トラッキング間隔の文字(例: "10"、"２５"、"0")を読み取る。0 は「揃えない」 */
export function parseDistanceIncrement(text: string): { ok: true; value: number } | { ok: false; error: string } {
  const normalized = text.normalize("NFKC").trim();
  if (!/^(\d+\.?\d*|\.\d+)$/.test(normalized)) return { ok: false, error: "トラッキング間隔は、数値(mm)で入力してください(0 なら、揃えません)" };
  const value = Number(normalized);
  if (!isValidDistanceIncrement(value)) {
    return { ok: false, error: `トラッキング間隔は、0(揃えない)か、${MIN_DISTANCE_INCREMENT} 〜 ${MAX_DISTANCE_INCREMENT} mm の範囲にしてください` };
  }
  return { ok: true, value };
}

/** 保存されていた値(信用できないもの)から設定を作る。壊れている・足りない項目は、初期設定で補う。ORTHO と POLAR が両方オンなら、ORTHO だけを残す */
export function normalizeTrackingSettings(raw: unknown): TrackingSettings {
  const defaults = DEFAULT_TRACKING_SETTINGS;
  if (typeof raw !== "object" || raw === null) return { ...defaults };
  const source = raw as Record<string, unknown>;
  const ortho = typeof source.ortho === "boolean" ? source.ortho : defaults.ortho;
  const polar = typeof source.polar === "boolean" ? source.polar : defaults.polar;
  return {
    ortho,
    polar: ortho ? false : polar,
    objectTracking: typeof source.objectTracking === "boolean" ? source.objectTracking : defaults.objectTracking,
    polarAngleIncrement: isValidAngleIncrement(source.polarAngleIncrement) ? source.polarAngleIncrement : defaults.polarAngleIncrement,
    distanceIncrement: isValidDistanceIncrement(source.distanceIncrement) ? source.distanceIncrement : defaults.distanceIncrement,
  };
}

/**
 * ORTHO・POLAR・OTRACK のオン・オフを切り替える。ORTHO と POLAR は、同時にオンにできない
 * (片方をオンにすると、もう片方がオフになる)。切り替えたあとの設定と、表示するメッセージを返す。
 */
export function toggleTracking(settings: TrackingSettings, which: TrackingToggle): { settings: TrackingSettings; message: string } {
  const turningOn = !settings[which];
  const next: TrackingSettings = { ...settings, [which]: turningOn };
  let note = "";
  if (turningOn && which === "ortho" && settings.polar) {
    next.polar = false;
    note = "。POLAR はオフになりました";
  }
  if (turningOn && which === "polar" && settings.ortho) {
    next.ortho = false;
    note = "。ORTHO はオフになりました";
  }
  return { settings: next, message: `${TRACKING_LABELS[which]}: ${turningOn ? "オン" : "オフ"}${note}` };
}
