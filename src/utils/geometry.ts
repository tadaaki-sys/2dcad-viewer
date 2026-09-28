import type { Point2D } from "../types/cad";

export function distance(a: Point2D, b: Point2D): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function pointToSegmentDistance(point: Point2D, segStart: Point2D, segEnd: Point2D): number {
  const segDx = segEnd.x - segStart.x;
  const segDy = segEnd.y - segStart.y;
  const segLengthSquared = segDx * segDx + segDy * segDy;

  if (segLengthSquared === 0) {
    return distance(point, segStart);
  }

  const t = ((point.x - segStart.x) * segDx + (point.y - segStart.y) * segDy) / segLengthSquared;
  const clampedT = Math.max(0, Math.min(1, t));

  const closestPoint: Point2D = {
    x: segStart.x + clampedT * segDx,
    y: segStart.y + clampedT * segDy,
  };

  return distance(point, closestPoint);
}

/** 2つの線分(端点含む)の交点を返す。交差しない/平行な場合はnull(完全重複ケースは扱わない) */
export function intersectSegments(p1: Point2D, p2: Point2D, p3: Point2D, p4: Point2D): Point2D | null {
  const d1x = p2.x - p1.x;
  const d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x;
  const d2y = p4.y - p3.y;

  const denom = d1x * d2y - d1y * d2x;
  if (denom === 0) return null;

  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denom;
  const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / denom;

  if (t < 0 || t > 1 || u < 0 || u > 1) return null;

  return { x: p1.x + t * d1x, y: p1.y + t * d1y };
}

/** 2つの線分(端点含む)が交差しているかを判定する */
export function segmentsIntersect(p1: Point2D, p2: Point2D, p3: Point2D, p4: Point2D): boolean {
  return intersectSegments(p1, p2, p3, p4) !== null;
}

/**
 * ARCのstartAngleからendAngleまでCCW方向に進む角度差(0〜2πの範囲)を返す。
 * DXFの角度はCCWで進む前提のため、endAngleがstartAngleを超えて1周する場合も正しく扱う。
 * span=0(start===end)は「1周分」として扱う(CIRCLEやほぼ全周のARCに対応するため)。
 */
export function normalizeArcSpan(startAngle: number, endAngle: number): number {
  const twoPi = Math.PI * 2;
  let span = (endAngle - startAngle) % twoPi;
  if (span <= 0) span += twoPi;
  return span;
}

export function pointOnArc(center: Point2D, radius: number, angle: number): Point2D {
  return { x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) };
}

/** 楕円上でパラメータ角paramに対応する点。rotationはメジャー軸の向き(+X軸からCCW) */
export function pointOnEllipse(
  center: Point2D,
  majorRadius: number,
  minorRadius: number,
  rotation: number,
  param: number,
): Point2D {
  const localX = majorRadius * Math.cos(param);
  const localY = minorRadius * Math.sin(param);
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return {
    x: center.x + localX * cos - localY * sin,
    y: center.y + localX * sin + localY * cos,
  };
}

export function polylineLength(vertices: Point2D[], closed: boolean): number {
  let total = 0;
  for (let i = 0; i < vertices.length - 1; i++) {
    total += distance(vertices[i], vertices[i + 1]);
  }
  if (closed && vertices.length > 2) {
    total += distance(vertices[vertices.length - 1], vertices[0]);
  }
  return total;
}
