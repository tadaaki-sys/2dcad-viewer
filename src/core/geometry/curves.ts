// 円・円弧に関する幾何計算(Snap の交点・接線など)。画面にも図面データにも依存しない純粋な処理。
// 角度はラジアンで、+X軸から反時計回り(図面の円弧と同じ)。
import type { Point2D } from "../../types/cad";
import { isAngleInSweep, normalizeArcSpan } from "./geometry";

/** 接する(重根)ときの判定の許容。半径に対する割合 */
const TANGENT_RELATIVE_EPSILON = 1e-9;

/** 線分 a-b と、円(中心 center、半径 radius)の交点(0〜2個)。線分の上にあるものだけ */
export function intersectSegmentCircle(a: Point2D, b: Point2D, center: Point2D, radius: number): Point2D[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const fx = a.x - center.x;
  const fy = a.y - center.y;
  const A = dx * dx + dy * dy;
  if (!(A > 0) || !(radius > 0)) return [];
  const B = 2 * (fx * dx + fy * dy);
  const C = fx * fx + fy * fy - radius * radius;
  let discriminant = B * B - 4 * A * C;
  if (!Number.isFinite(discriminant)) return [];
  if (discriminant < 0) {
    // ほぼ接している(わずかに負)ときは、接点として扱う
    if (discriminant < -TANGENT_RELATIVE_EPSILON * Math.max(B * B, 4 * A * Math.abs(C), 1)) return [];
    discriminant = 0;
  }
  const root = Math.sqrt(discriminant);
  const parameters = root === 0 ? [-B / (2 * A)] : [(-B - root) / (2 * A), (-B + root) / (2 * A)];
  const points: Point2D[] = [];
  for (const t of parameters) {
    if (t < -1e-12 || t > 1 + 1e-12) continue;
    const clamped = Math.min(1, Math.max(0, t));
    points.push({ x: a.x + dx * clamped, y: a.y + dy * clamped });
  }
  return points;
}

/** 2つの円の交点(0〜2個) */
export function intersectCircles(c1: Point2D, r1: number, c2: Point2D, r2: number): Point2D[] {
  const dx = c2.x - c1.x;
  const dy = c2.y - c1.y;
  const d = Math.hypot(dx, dy);
  if (!(d > 0) || !(r1 > 0) || !(r2 > 0)) return [];
  const eps = TANGENT_RELATIVE_EPSILON * Math.max(r1, r2, d);
  if (d > r1 + r2 + eps || d < Math.abs(r1 - r2) - eps) return [];
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const hSquared = r1 * r1 - a * a;
  const h = hSquared > 0 ? Math.sqrt(hSquared) : 0;
  const mx = c1.x + (a * dx) / d;
  const my = c1.y + (a * dy) / d;
  if (h === 0) return [{ x: mx, y: my }];
  const ox = (-dy / d) * h;
  const oy = (dx / d) * h;
  return [
    { x: mx + ox, y: my + oy },
    { x: mx - ox, y: my - oy },
  ];
}

/** 点 from から、円(中心 center、半径 radius)へ引いた接線の接点(0〜2個)。from が円の上または中にあるときは無い */
export function tangentPointsFromPoint(from: Point2D, center: Point2D, radius: number): Point2D[] {
  const dx = from.x - center.x;
  const dy = from.y - center.y;
  const d = Math.hypot(dx, dy);
  if (!(radius > 0) || !(d > radius * (1 + TANGENT_RELATIVE_EPSILON))) return [];
  const base = Math.atan2(dy, dx);
  const offset = Math.acos(radius / d);
  return [base + offset, base - offset].map((angle) => ({
    x: center.x + radius * Math.cos(angle),
    y: center.y + radius * Math.sin(angle),
  }));
}

/** 角度の範囲の端の判定の許容(ラジアン)。端点の上の交点・四半円点が、丸め誤差で範囲外にならないようにする */
const SWEEP_EDGE_EPSILON = 1e-9;

/** 点 point が、円弧(startAngle から終点 endAngle へ反時計回り)の角度の範囲に入っているか(中心の方向で判定。端は含む) */
export function isPointInArcSweep(center: Point2D, point: Point2D, startAngle: number, endAngle: number): boolean {
  return isAngleInArcSweep(Math.atan2(point.y - center.y, point.x - center.x), startAngle, endAngle);
}

/** 角度 angle が、円弧(startAngle から endAngle へ反時計回り)の範囲に入っているか(端は含む) */
export function isAngleInArcSweep(angle: number, startAngle: number, endAngle: number): boolean {
  const span = normalizeArcSpan(startAngle, endAngle);
  if (isAngleInSweep(angle, startAngle, span + SWEEP_EDGE_EPSILON)) return true;
  // 始点のわずかに手前(丸め誤差)
  const twoPi = Math.PI * 2;
  const delta = (((angle - startAngle) % twoPi) + twoPi) % twoPi;
  return twoPi - delta <= SWEEP_EDGE_EPSILON;
}
