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
