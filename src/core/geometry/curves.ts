// 円・円弧に関する幾何計算(Snap の交点・接線など)。画面にも図面データにも依存しない純粋な処理。
// 角度はラジアンで、+X軸から反時計回り(図面の円弧と同じ)。
import type { Point2D } from "../../types/cad";
import { isAngleInSweep, normalizeArcSpan } from "./geometry";

/** 接する(重根)ときの判定の許容。(小さい方の)半径に対する割合 */
const TANGENT_RELATIVE_EPSILON = 1e-9;
/** 線分の端の判定の許容(mm)。端の上の交点が、丸め誤差で線分の外になるのを防ぐ */
const SEGMENT_END_EPSILON = 1e-9;

/**
 * 線分 a-b と、円(中心 center、半径 radius)の交点(0〜2個)。線分の上にあるものだけ。
 * 判別式ではなく、中心から直線までの距離(垂線の長さ)と、垂線の足の位置で求める
 * (線分が円に比べて非常に長いときに、桁落ちで、離れた線を接線と取り違えたり、交点を失ったりしないため)。
 */
export function intersectSegmentCircle(a: Point2D, b: Point2D, center: Point2D, radius: number): Point2D[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (!(length > 0) || !Number.isFinite(length) || !(radius > 0)) return [];
  const ux = dx / length;
  const uy = dy / length;
  const fx = center.x - a.x;
  const fy = center.y - a.y;
  const along = fx * ux + fy * uy; // a から、中心の垂線の足までの、線に沿った距離
  const distanceToLine = Math.abs(fx * uy - fy * ux); // 中心から直線までの距離
  if (!Number.isFinite(along) || !Number.isFinite(distanceToLine)) return [];
  if (distanceToLine > radius * (1 + TANGENT_RELATIVE_EPSILON)) return [];
  // 接する(距離が半径とほぼ同じ)ときは、足が接点。そうでなければ、足から両側へ、弦の半分の長さ
  const half = distanceToLine >= radius ? 0 : Math.sqrt((radius - distanceToLine) * (radius + distanceToLine));
  const positions = half === 0 ? [along] : [along - half, along + half];
  const points: Point2D[] = [];
  for (const position of positions) {
    if (position < -SEGMENT_END_EPSILON || position > length + SEGMENT_END_EPSILON) continue;
    const clamped = Math.min(length, Math.max(0, position));
    points.push({ x: a.x + ux * clamped, y: a.y + uy * clamped });
  }
  return points;
}

/** 2つの円の交点(0〜2個) */
export function intersectCircles(c1: Point2D, r1: number, c2: Point2D, r2: number): Point2D[] {
  const dx = c2.x - c1.x;
  const dy = c2.y - c1.y;
  const d = Math.hypot(dx, dy);
  if (!(d > 0) || !Number.isFinite(d) || !(r1 > 0) || !(r2 > 0)) return [];
  // 接するときの許容は、小さい方の円に合わせる(大きな円の半径に比例させると、小さな円との間の隙間を、接していると取り違える)
  const eps = TANGENT_RELATIVE_EPSILON * Math.min(r1, r2);
  if (d > r1 + r2 + eps || d < Math.abs(r1 - r2) - eps) return [];
  // c1 から、2つの交点を結ぶ線(共通弦)までの距離 a。(d² + r1² - r2²) / (2d) と同じ値を、桁落ちしにくい形で求める
  const a = (d + ((r1 - r2) * (r1 + r2)) / d) / 2;
  const hSquared = (r1 - a) * (r1 + a);
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
