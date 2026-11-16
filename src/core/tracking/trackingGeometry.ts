// ORTHO・POLAR・OTRACK の計算。画面にも図面データにも依存しない純粋な処理。
// 角度は度で、+X方向が0、反時計回り。補助線は、基準の点(origin)から、その角度の方向に延びる線
// (oneSided が true なら、その向きだけの半直線。false なら、両側に延びる直線)。
import type { Point2D } from "../../types/cad";
import type { TrackingSettings } from "./trackingSettings";

export type TrackingKind = "ortho" | "polar" | "object";

/** 一時補助線(画面に描く線)。origin から angleDeg の向きに延びる */
export type TrackingGuide = {
  kind: TrackingKind;
  origin: Point2D;
  angleDeg: number;
  oneSided: boolean;
};

export type TrackingParams = {
  /** 極トラッキング・ORTHO の基準の点(作図中の直前の点、測定の1点目)。無ければ null(これらは効かない) */
  base: Point2D | null;
  /** OTRACK で取得している点 */
  acquired: readonly Point2D[];
  settings: TrackingSettings;
  /** 補助線に揃う距離(ワールド単位。画面上のpx ÷ 拡大率) */
  toleranceWorld: number;
};

export type TrackingResult = {
  /** 揃えたあとの点 */
  point: Point2D;
  /** その点を通っている補助線(ORTHO だけのときは、空) */
  guides: TrackingGuide[];
  /** 画面に出す短い説明(例: 極トラッキングの角度 "45°")。無ければ null */
  label: string | null;
};

/** 同じ点とみなす距離(ワールド単位)。補助線がある点を通っているかの判定に使う */
const ON_LINE_EPSILON = 1e-6;
/** 2本の線が平行とみなす、方向ベクトルの外積の大きさ(長さ1どうし) */
const PARALLEL_EPSILON = 1e-9;

function directionOf(angleDeg: number): Point2D {
  const radians = (angleDeg * Math.PI) / 180;
  return { x: Math.cos(radians), y: Math.sin(radians) };
}

/** 角度を 0 以上 360 未満にそろえる */
export function normalizeDegrees(degrees: number): number {
  const result = degrees % 360;
  const positive = result < 0 ? result + 360 : result;
  return positive >= 360 ? 0 : positive;
}

/** 角度の刻みの一覧(0 以上 360 未満)。例: 90 なら 0・90・180・270 */
export function polarAngles(incrementDeg: number): number[] {
  const count = Math.round(360 / incrementDeg);
  return Array.from({ length: count }, (_, i) => normalizeDegrees(i * incrementDeg));
}

/**
 * ORTHO: 基準点から、水平・垂直のうち、カーソルが離れている方(縦横の距離の大きい方)に揃える。
 * 縦横が同じ距離なら、水平。基準点と同じ点なら、そのまま。
 */
export function applyOrtho(base: Point2D, cursor: Point2D): Point2D {
  const dx = cursor.x - base.x;
  const dy = cursor.y - base.y;
  if (Math.abs(dx) >= Math.abs(dy)) return { x: cursor.x, y: base.y };
  return { x: base.x, y: cursor.y };
}

type Line = { kind: TrackingKind; origin: Point2D; angleDeg: number; oneSided: boolean };

/** 点 p から線までの距離。半直線で、p が起点の後ろ側にあるときは、起点までの距離 */
function distanceToLine(line: Line, p: Point2D): number {
  const d = directionOf(line.angleDeg);
  const vx = p.x - line.origin.x;
  const vy = p.y - line.origin.y;
  const along = vx * d.x + vy * d.y;
  if (line.oneSided && along < 0) return Math.hypot(vx, vy);
  return Math.abs(vx * d.y - vy * d.x);
}

/** p から線へ下ろした垂線の足。半直線で、p が起点の後ろ側にあるときは、起点 */
function footOnLine(line: Line, p: Point2D): Point2D {
  const d = directionOf(line.angleDeg);
  const vx = p.x - line.origin.x;
  const vy = p.y - line.origin.y;
  let along = vx * d.x + vy * d.y;
  if (line.oneSided && along < 0) along = 0;
  return { x: line.origin.x + d.x * along, y: line.origin.y + d.y * along };
}

/** 2本の線の交点。平行、または、半直線の起点より後ろにあるときは null */
function intersectLines(a: Line, b: Line): Point2D | null {
  const da = directionOf(a.angleDeg);
  const db = directionOf(b.angleDeg);
  const cross = da.x * db.y - da.y * db.x;
  if (Math.abs(cross) < PARALLEL_EPSILON) return null;
  const ox = b.origin.x - a.origin.x;
  const oy = b.origin.y - a.origin.y;
  const ta = (ox * db.y - oy * db.x) / cross;
  const tb = (ox * da.y - oy * da.x) / cross;
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return null;
  if ((a.oneSided && ta < 0) || (b.oneSided && tb < 0)) return null;
  return { x: a.origin.x + da.x * ta, y: a.origin.y + da.y * ta };
}

function sameOrigin(a: Point2D, b: Point2D): boolean {
  return Math.abs(a.x - b.x) < ON_LINE_EPSILON && Math.abs(a.y - b.y) < ON_LINE_EPSILON;
}

function formatAngle(angleDeg: number): string {
  const rounded = Math.round(normalizeDegrees(angleDeg) * 10) / 10;
  return `${rounded}°`;
}

/**
 * カーソルの点を、ORTHO・極トラッキング・OTRACK の補助線に揃える。
 * - ORTHO(基準点があるとき): 常に、基準点からの水平・垂直に揃える。取得した点からの補助線と交わるところでは、その交点に揃える。
 * - 極トラッキング(基準点があるとき): 角度の刻みの方向にカーソルが近づいたら(許容距離以内)、その方向に揃える。
 *   トラッキング間隔が正なら、基準点からの距離も、その倍数に揃える。
 * - OTRACK: 取得した点から、水平・垂直(極トラッキングがオンなら、角度の刻み)の補助線に近づいたら、揃える。
 * - 2本の補助線の両方に近づいたら、その交点に揃える(いちばん近い交点)。
 * どれにも揃わないときは null(ORTHO がオンで基準点があるときは、常に結果を返す)。
 */
export function trackCursor(cursor: Point2D, params: TrackingParams): TrackingResult | null {
  const { base, acquired, settings, toleranceWorld } = params;
  const orthoOn = settings.ortho && base !== null;
  // 極トラッキングの設定(ORTHO と同時にはオンにならない。両方オンの値が渡されたら、ORTHO が優先)
  const polarSetting = settings.polar && !settings.ortho;
  const polarOn = polarSetting && base !== null;
  const objectOn = settings.objectTracking && acquired.length > 0;
  if (!orthoOn && !polarOn && !objectOn) return null;

  let target = cursor;
  const lines: Line[] = [];

  if (orthoOn) {
    target = applyOrtho(base, cursor);
    const horizontal = target.y === base.y;
    // 揃えた方向の直線(両側)。取得した点からの補助線との交点を求めるために使う
    lines.push({ kind: "ortho", origin: base, angleDeg: horizontal ? 0 : 90, oneSided: false });
  }
  if (polarOn && Math.hypot(cursor.x - base.x, cursor.y - base.y) > toleranceWorld) {
    for (const angleDeg of polarAngles(settings.polarAngleIncrement)) {
      lines.push({ kind: "polar", origin: base, angleDeg, oneSided: true });
    }
  }
  if (objectOn) {
    // 取得した点からは、両側へ延びる直線。向きは、極トラッキングがオンなら角度の刻み(基準点が無くても)、そうでなければ水平・垂直
    const angles = polarSetting ? polarAngles(settings.polarAngleIncrement).filter((angle) => angle < 180) : [0, 90];
    for (const origin of acquired) {
      for (const angleDeg of angles) lines.push({ kind: "object", origin, angleDeg, oneSided: false });
    }
  }

  // ORTHO の直線は、常に対象。ほかは、カーソルから許容距離以内のものだけ
  const near = lines.filter((line) => line.kind === "ortho" || distanceToLine(line, target) <= toleranceWorld);
  const guidesAt = (point: Point2D) => near.filter((line) => distanceToLine(line, point) <= ON_LINE_EPSILON + 1e-9 * Math.abs(point.x + point.y));
  const toGuide = (line: Line): TrackingGuide => ({ kind: line.kind, origin: line.origin, angleDeg: line.angleDeg, oneSided: line.oneSided });

  // 2本の補助線の交点のうち、いちばん近いもの
  let best: { point: Point2D; distance: number } | null = null;
  for (let i = 0; i < near.length; i++) {
    for (let j = i + 1; j < near.length; j++) {
      if (sameOrigin(near[i].origin, near[j].origin)) continue; // 同じ点から出る線どうしは、その点で交わるだけ
      const point = intersectLines(near[i], near[j]);
      if (point === null) continue;
      const distance = Math.hypot(point.x - target.x, point.y - target.y);
      if (distance <= toleranceWorld && (best === null || distance < best.distance)) best = { point, distance };
    }
  }
  if (best !== null) {
    const guides = guidesAt(best.point).filter((line) => line.kind !== "ortho").map(toGuide);
    const polar = guides.find((guide) => guide.kind === "polar");
    return { point: best.point, guides, label: polar ? formatAngle(polar.angleDeg) : null };
  }

  // ORTHO は、交点が無くても、揃えた点を返す(補助線は描かない)
  if (orthoOn) return { point: target, guides: [], label: null };

  // 1本の補助線に揃える(いちばん近いもの)
  let nearest: { line: Line; distance: number } | null = null;
  for (const line of near) {
    const distance = distanceToLine(line, target);
    if (nearest === null || distance < nearest.distance) nearest = { line, distance };
  }
  if (nearest === null) return null;
  const { line } = nearest;
  let point = footOnLine(line, target);
  if (line.kind === "polar" && settings.distanceIncrement > 0) {
    // 基準点からの距離を、トラッキング間隔の倍数に揃える(0 以下になるときは、揃えない)
    const d = directionOf(line.angleDeg);
    const length = (point.x - line.origin.x) * d.x + (point.y - line.origin.y) * d.y;
    const stepped = Math.round(length / settings.distanceIncrement) * settings.distanceIncrement;
    if (stepped > 0) point = { x: line.origin.x + d.x * stepped, y: line.origin.y + d.y * stepped };
  }
  const guides = guidesAt(point).map(toGuide);
  return { point, guides: guides.length > 0 ? guides : [toGuide(line)], label: line.kind === "polar" ? formatAngle(line.angleDeg) : null };
}
