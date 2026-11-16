// Snap の各種類が共通で使う、図形上の点の計算。
import { closestPointOnSegment, distance, isAngleInSweep, normalizeArcSpan, pointOnArc } from "../geometry/geometry";
import { getEntitySegments } from "../geometry/entityGeometry";
import type { CadEntity, Point2D } from "../../types/cad";

/** entity上でworldPointに最も近い点。TEXTなど線を持たない図形はnull */
export function nearestPointOnEntity(entity: CadEntity, worldPoint: Point2D): Point2D | null {
  if (entity.type === "TEXT") return null;
  if (entity.type === "POINT") return entity.position;
  if (entity.type === "CIRCLE" || entity.type === "ARC") {
    const dx = worldPoint.x - entity.center.x;
    const dy = worldPoint.y - entity.center.y;
    const fromCenter = Math.hypot(dx, dy);
    if (entity.type === "ARC") {
      const span = normalizeArcSpan(entity.startAngle, entity.endAngle);
      if (!(fromCenter > 0) || !isAngleInSweep(Math.atan2(dy, dx), entity.startAngle, span)) {
        // 弧の範囲外では、近い方の端点が最も近い点
        const start = pointOnArc(entity.center, entity.radius, entity.startAngle);
        const end = pointOnArc(entity.center, entity.radius, entity.startAngle + span);
        return distance(start, worldPoint) <= distance(end, worldPoint) ? start : end;
      }
    }
    if (!(fromCenter > 0)) return null; // 円の中心からは最近点が定まらない
    return { x: entity.center.x + (dx / fromCenter) * entity.radius, y: entity.center.y + (dy / fromCenter) * entity.radius };
  }

  let best: Point2D | null = null;
  let bestDistance = Infinity;
  for (const [a, b] of getEntitySegments(entity)) {
    const candidate = closestPointOnSegment(worldPoint, a, b);
    const d = distance(candidate, worldPoint);
    if (d < bestDistance) {
      bestDistance = d;
      best = candidate;
    }
  }
  return best;
}

/** 円・円弧の線(円周)から、点までの距離。円・円弧以外は Infinity */
export function distanceToCurve(entity: CadEntity, point: Point2D): number {
  if (entity.type !== "CIRCLE" && entity.type !== "ARC") return Infinity;
  if (entity.type === "CIRCLE") return Math.abs(Math.hypot(point.x - entity.center.x, point.y - entity.center.y) - entity.radius);
  const nearest = nearestPointOnEntity(entity, point);
  return nearest === null ? Infinity : distance(nearest, point);
}
