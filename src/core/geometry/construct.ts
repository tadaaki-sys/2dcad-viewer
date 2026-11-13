// 円・円弧を作る幾何計算(作図コマンド用)。画面にも図面データにも依存しない純粋な処理。
// 角度はラジアンで、+X軸から反時計回り(CCW)。保存する円弧は、常に「始点から終点へ反時計回り」で表す(DXFのARCと同じ)。
import type { Point2D } from "../../types/cad";

/** これより小さい半径(図面の単位=mm)の円・円弧は作らない(点と見分けがつかない) */
export const MIN_RADIUS = 1e-6;
/** これより大きい半径の円・円弧は作らない(ほぼ一直線の3点から、極端に大きな円ができるのを防ぐ) */
export const MAX_RADIUS = 1e9;

/** 一直線とみなす基準。2辺の間の角の sin がこれ以下なら、3点は一直線上にあるとして扱う */
const COLLINEAR_SIN_LIMIT = 1e-9;
/** 始点と終点の方向がこれ(ラジアン)より近いと、角度の範囲が0の円弧として扱い、作らない */
const MIN_ARC_SPAN = 1e-9;

const TWO_PI = Math.PI * 2;

export type ArcShape = { center: Point2D; radius: number; startAngle: number; endAngle: number };

/** 半径として使える値か(有限で、下限以上・上限以下) */
export function isUsableRadius(radius: number): boolean {
  return Number.isFinite(radius) && radius >= MIN_RADIUS && radius <= MAX_RADIUS;
}

/** 角度を 0 以上 2π 未満にそろえる */
export function normalizeAngle(angle: number): number {
  let result = angle % TWO_PI;
  if (result < 0) result += TWO_PI;
  // 非常に小さな負の値は、足すと 2π ちょうどになることがある
  return result >= TWO_PI ? 0 : result;
}

/** 中心から見た点の方向(0 以上 2π 未満) */
export function angleOf(center: Point2D, point: Point2D): number {
  return normalizeAngle(Math.atan2(point.y - center.y, point.x - center.x));
}

/** 始点から終点へ反時計回りに進む角度(0 より大きく 2π 以下。同じ方向なら 2π) */
function counterClockwiseSpan(startAngle: number, endAngle: number): number {
  const span = normalizeAngle(endAngle - startAngle);
  return span === 0 ? TWO_PI : span;
}

/** 始点と終点の方向が同じで、角度の範囲が(ほぼ)0か、または全周になる円弧か */
function isDegenerateSpan(startAngle: number, endAngle: number): boolean {
  const span = normalizeAngle(endAngle - startAngle);
  return span < MIN_ARC_SPAN || TWO_PI - span < MIN_ARC_SPAN;
}

/**
 * 3点を通る円弧。始点→通過点→終点の順に進む向きで描く。
 * 3点が一直線上にある、同じ点がある、半径が使えない値になるときは null。
 */
export function arcThroughThreePoints(start: Point2D, through: Point2D, end: Point2D): ArcShape | null {
  // 計算の誤差を減らすため、始点を原点にした座標で外心を求める
  const bx = through.x - start.x;
  const by = through.y - start.y;
  const cx = end.x - start.x;
  const cy = end.y - start.y;
  const cross = bx * cy - by * cx;
  const scale = Math.hypot(bx, by) * Math.hypot(cx, cy);
  if (!(scale > 0) || !Number.isFinite(scale)) return null;
  if (Math.abs(cross) <= COLLINEAR_SIN_LIMIT * scale) return null;

  const d = 2 * cross;
  const b2 = bx * bx + by * by;
  const c2 = cx * cx + cy * cy;
  const ux = (cy * b2 - by * c2) / d;
  const uy = (bx * c2 - cx * b2) / d;
  const center = { x: start.x + ux, y: start.y + uy };
  const radius = Math.hypot(ux, uy);
  if (!isUsableRadius(radius) || !Number.isFinite(center.x) || !Number.isFinite(center.y)) return null;

  // 始点→通過点→終点が反時計回りなら、そのまま。時計回りなら、始点と終点を入れ替えて、反時計回りで表す
  const counterClockwise = bx * (end.y - through.y) - by * (end.x - through.x) > 0;
  const first = counterClockwise ? start : end;
  const last = counterClockwise ? end : start;
  const startAngle = angleOf(center, first);
  const endAngle = angleOf(center, last);
  if (isDegenerateSpan(startAngle, endAngle)) return null;
  return { center, radius, startAngle, endAngle };
}

export type CenterStartEndFailure = "radius" | "end-at-center" | "same-direction";

/**
 * 中心・始点・終点から作る円弧。半径は中心から始点までの距離。終点は中心からの方向だけを使い、円の上になくてもよい。
 * 始点から終点へ、反時計回りに描く。作れないときは、理由を返す。
 */
export function arcFromCenterStartEnd(
  center: Point2D,
  start: Point2D,
  end: Point2D,
): { ok: true; arc: ArcShape } | { ok: false; reason: CenterStartEndFailure } {
  const radius = Math.hypot(start.x - center.x, start.y - center.y);
  if (!isUsableRadius(radius)) return { ok: false, reason: "radius" };
  if (Math.hypot(end.x - center.x, end.y - center.y) < MIN_RADIUS) return { ok: false, reason: "end-at-center" };
  const startAngle = angleOf(center, start);
  const endAngle = angleOf(center, end);
  if (isDegenerateSpan(startAngle, endAngle)) return { ok: false, reason: "same-direction" };
  return { ok: true, arc: { center: { ...center }, radius, startAngle, endAngle } };
}

/** 円弧の角度の範囲(反時計回り、0 より大きく 2π 以下)。テスト・表示用 */
export function arcSweep(arc: ArcShape): number {
  return counterClockwiseSpan(arc.startAngle, arc.endAngle);
}
