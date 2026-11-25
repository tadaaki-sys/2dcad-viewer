// 垂線(基準点から図形へ下ろした垂線の足)と、接線(基準点から円・円弧へ引いた接線の接点)の Snap。
// どちらも、基準点(作図中の直前の点など)があるときだけ働く。
import { distance } from "../geometry/geometry";
import { getEntitySegments } from "../geometry/entityGeometry";
import { isPointInArcSweep, tangentPointsFromPoint } from "../geometry/curves";
import type { Point2D } from "../../types/cad";
import type { GeneratorContext } from "./snapContext";
import type { SnapCandidate } from "./snapTypes";

/** 基準点 from から線分 a-b へ下ろした垂線の足(線分の上にあるときだけ)。無ければ null */
function footOnSegment(from: Point2D, a: Point2D, b: Point2D): Point2D | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!(lengthSquared > 0)) return null;
  const t = ((from.x - a.x) * dx + (from.y - a.y) * dy) / lengthSquared;
  if (t < 0 || t > 1) return null;
  return { x: a.x + dx * t, y: a.y + dy * t };
}

export function collectPerpendicularCandidates(context: GeneratorContext): SnapCandidate[] {
  const { entities, visibleLayerNames, worldPoint, toleranceWorld, fromPoint } = context;
  if (fromPoint === null) return [];
  const results: SnapCandidate[] = [];
  const add = (point: Point2D | null) => {
    if (point !== null && distance(point, worldPoint) <= toleranceWorld) results.push({ point, type: "perpendicular" });
  };
  for (const entity of entities) {
    if (!visibleLayerNames.has(entity.layer)) continue;
    if (entity.type === "CIRCLE" || entity.type === "ARC") {
      // 円周の法線は、中心を通る。基準点と中心を結ぶ直線が円周と交わる2点が、垂線の足
      const dx = fromPoint.x - entity.center.x;
      const dy = fromPoint.y - entity.center.y;
      const d = Math.hypot(dx, dy);
      if (!(d > 0)) continue;
      for (const sign of [1, -1]) {
        const point = { x: entity.center.x + (sign * dx * entity.radius) / d, y: entity.center.y + (sign * dy * entity.radius) / d };
        if (entity.type === "CIRCLE" || isPointInArcSweep(entity.center, point, entity.startAngle, entity.endAngle)) add(point);
      }
      continue;
    }
    if (entity.type === "TEXT" || entity.type === "POINT" || entity.type === "DIMENSION") continue;
    // 線・折れ線は線分ごと。楕円・スプラインは、折れ線の近似
    for (const [a, b] of getEntitySegments(entity)) add(footOnSegment(fromPoint, a, b));
  }
  return results;
}

export function collectTangentCandidates(context: GeneratorContext): SnapCandidate[] {
  const { entities, visibleLayerNames, worldPoint, toleranceWorld, fromPoint } = context;
  if (fromPoint === null) return [];
  const results: SnapCandidate[] = [];
  for (const entity of entities) {
    if (!visibleLayerNames.has(entity.layer)) continue;
    if (entity.type !== "CIRCLE" && entity.type !== "ARC") continue;
    for (const point of tangentPointsFromPoint(fromPoint, entity.center, entity.radius)) {
      if (distance(point, worldPoint) > toleranceWorld) continue;
      if (entity.type === "ARC" && !isPointInArcSweep(entity.center, point, entity.startAngle, entity.endAngle)) continue;
      results.push({ point, type: "tangent" });
    }
  }
  return results;
}
