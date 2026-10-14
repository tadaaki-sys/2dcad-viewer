import type { Point2D } from "../types/cad";

// 円弧区間を折れ線へ近似するときの1分割あたりの最大角(ラジアン)。10度ごと
const MAX_SEGMENT_ANGLE = Math.PI / 18;
const MIN_ARC_SEGMENTS = 2;
const MAX_ARC_SEGMENTS = 72;

export type BulgeVertex = { x: number; y: number; bulge?: number };

/**
 * 2点p→qを結ぶ円弧(bulge: 弧の中央の膨らみ/弦の半分。正=CCW、負=CW。tan(挟角/4))の途中の点を返す。
 * 端点p・qは含まない。bulgeが0・非有限、または弦の長さが0なら空。
 */
export function arcPointsBetween(p: Point2D, q: Point2D, bulge: number): Point2D[] {
  if (!Number.isFinite(bulge) || bulge === 0) return [];
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const chord = Math.hypot(dx, dy);
  if (!(chord > 0)) return [];

  const sweep = 4 * Math.atan(bulge);
  // 弦の中点から、弦の左向き法線方向へ中心までの符号付き距離
  const offset = (chord / 2) * ((1 - bulge * bulge) / (2 * bulge));
  const center = { x: (p.x + q.x) / 2 - (dy / chord) * offset, y: (p.y + q.y) / 2 + (dx / chord) * offset };
  const radius = Math.hypot(p.x - center.x, p.y - center.y);
  const startAngle = Math.atan2(p.y - center.y, p.x - center.x);

  const segments = Math.min(MAX_ARC_SEGMENTS, Math.max(MIN_ARC_SEGMENTS, Math.ceil(Math.abs(sweep) / MAX_SEGMENT_ANGLE)));
  const points: Point2D[] = [];
  for (let i = 1; i < segments; i++) {
    const angle = startAngle + (sweep * i) / segments;
    points.push({ x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) });
  }
  return points;
}

/**
 * LWPOLYLINE/POLYLINEの頂点列を、bulge(円弧区間)を折れ線へ展開した点列にする。
 * 閉じた折れ線では、最後の頂点のbulgeが最後→最初の区間を表す(最初の点は繰り返さない)。
 */
export function expandBulges(vertices: readonly BulgeVertex[], closed: boolean): Point2D[] {
  const points: Point2D[] = [];
  const segmentCount = closed ? vertices.length : vertices.length - 1;
  for (let i = 0; i < vertices.length; i++) {
    const current = vertices[i];
    points.push({ x: current.x, y: current.y });
    if (i < segmentCount) {
      const next = vertices[(i + 1) % vertices.length];
      points.push(...arcPointsBetween(current, next, current.bulge ?? 0));
    }
  }
  return points;
}
