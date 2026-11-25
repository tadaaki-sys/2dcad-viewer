// 寸法を作るときの、点の決め方(円・線から、定義点を求める)。画面にもファイル形式にも依存しない純粋な処理。
import type { Point2D } from "../../types/cad";

/** 円(または円弧)の上の、クリックした向きの点。クリックが中心と同じなら、+X 方向の点 */
export function pointOnCircleToward(center: Point2D, radius: number, toward: Point2D): Point2D {
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  const length = Math.hypot(dx, dy);
  if (!(length > 0) || !Number.isFinite(length)) return { x: center.x + radius, y: center.y };
  return { x: center.x + (dx / length) * radius, y: center.y + (dy / length) * radius };
}

export type LineSegment = { start: Point2D; end: Point2D };

/** 2本の線から、角度寸法の定義点(頂点・1本目の腕の上の点・2本目の腕の上の点)を求めた結果 */
export type AngularFromLines = { ok: true; vertex: Point2D; arm1: Point2D; arm2: Point2D } | { ok: false; reason: string };

const cross = (ax: number, ay: number, bx: number, by: number): number => ax * by - ay * bx;

/** 2本の線(無限に延ばした直線)の交点。平行(または長さ 0)のときは null */
export function intersectionOfLines(a: LineSegment, b: LineSegment): Point2D | null {
  const d1x = a.end.x - a.start.x;
  const d1y = a.end.y - a.start.y;
  const d2x = b.end.x - b.start.x;
  const d2y = b.end.y - b.start.y;
  const length1 = Math.hypot(d1x, d1y);
  const length2 = Math.hypot(d2x, d2y);
  if (!(length1 > 0) || !(length2 > 0) || !Number.isFinite(length1) || !Number.isFinite(length2)) return null;
  const denominator = cross(d1x / length1, d1y / length1, d2x / length2, d2y / length2);
  // ほぼ平行(0.001度未満)は、交点が定まらない
  if (!(Math.abs(denominator) > 1.7e-5)) return null;
  const t = cross(b.start.x - a.start.x, b.start.y - a.start.y, d2x / length2, d2y / length2) / denominator / length1;
  const point = { x: a.start.x + d1x * t, y: a.start.y + d1y * t };
  return Number.isFinite(point.x) && Number.isFinite(point.y) ? point : null;
}

/**
 * 2本の線と、寸法の弧が通る点から、角度寸法の定義点を求める。
 * 2本の線は、4つの角に分かれる。弧が通る点(頂点から見た向き)を含む角を測る。
 * 腕の上の点は、その向きの、線の端のうち頂点から遠い方(線が頂点に届かないときは、延長上)。
 */
export function angularFromLines(first: LineSegment, second: LineSegment, position: Point2D): AngularFromLines {
  const vertex = intersectionOfLines(first, second);
  if (vertex === null) return { ok: false, reason: "2本の線が平行(または長さ 0)で、角度を測れません" };
  const toPosition = { x: position.x - vertex.x, y: position.y - vertex.y };
  const unit = (line: LineSegment): Point2D => {
    const dx = line.end.x - line.start.x;
    const dy = line.end.y - line.start.y;
    const length = Math.hypot(dx, dy);
    return { x: dx / length, y: dy / length };
  };
  const u1 = unit(first);
  const u2 = unit(second);
  for (const s1 of [1, -1]) {
    for (const s2 of [1, -1]) {
      const a = { x: u1.x * s1, y: u1.y * s1 };
      const b = { x: u2.x * s2, y: u2.y * s2 };
      const sign = cross(a.x, a.y, b.x, b.y);
      const inside = sign * cross(a.x, a.y, toPosition.x, toPosition.y) >= 0 && sign * cross(toPosition.x, toPosition.y, b.x, b.y) >= 0;
      if (!inside) continue;
      const reach = (line: LineSegment, ray: Point2D): number => {
        const t1 = (line.start.x - vertex.x) * ray.x + (line.start.y - vertex.y) * ray.y;
        const t2 = (line.end.x - vertex.x) * ray.x + (line.end.y - vertex.y) * ray.y;
        return Math.max(t1, t2, 1e-6);
      };
      const reach1 = reach(first, a);
      const reach2 = reach(second, b);
      return {
        ok: true,
        vertex,
        arm1: { x: vertex.x + a.x * reach1, y: vertex.y + a.y * reach1 },
        arm2: { x: vertex.x + b.x * reach2, y: vertex.y + b.y * reach2 },
      };
    }
  }
  return { ok: false, reason: "弧を通る点の向きが、2本の線の間に決まりません" };
}
