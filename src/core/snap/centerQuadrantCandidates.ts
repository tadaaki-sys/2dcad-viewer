// 中心(円・円弧・楕円の中心)と、四半円点(0°・90°・180°・270° の点。楕円は長軸・短軸の端点)の Snap。
import { distance, normalizeArcSpan, pointOnArc, pointOnEllipse } from "../geometry/geometry";
import { isAngleInArcSweep } from "../geometry/curves";
import type { CadEntity, Point2D } from "../../types/cad";
import type { GeneratorContext } from "./snapContext";
import type { SnapCandidate } from "./snapTypes";

const HALF_PI = Math.PI / 2;

/** 図形の中心。中心を持たない図形は null */
function centerOf(entity: CadEntity): Point2D | null {
  if (entity.type === "CIRCLE" || entity.type === "ARC" || entity.type === "ELLIPSE") return entity.center;
  return null;
}

export function collectCenterCandidates(context: GeneratorContext): SnapCandidate[] {
  const { centerEntities, visibleLayerNames, worldPoint, toleranceWorld } = context;
  const results: SnapCandidate[] = [];
  for (const entity of centerEntities) {
    if (!visibleLayerNames.has(entity.layer)) continue;
    const center = centerOf(entity);
    if (center !== null && distance(center, worldPoint) <= toleranceWorld) results.push({ point: center, type: "center" });
  }
  return results;
}

/** 円・円弧の四半円点(円弧は、角度の範囲に入っているものだけ) */
function quadrantsOf(entity: CadEntity): Point2D[] {
  if (entity.type === "CIRCLE") {
    return [0, 1, 2, 3].map((i) => pointOnArc(entity.center, entity.radius, i * HALF_PI));
  }
  if (entity.type === "ARC") {
    return [0, 1, 2, 3]
      .map((i) => i * HALF_PI)
      .filter((angle) => isAngleInArcSweep(angle, entity.startAngle, entity.endAngle))
      .map((angle) => pointOnArc(entity.center, entity.radius, angle));
  }
  if (entity.type === "ELLIPSE") {
    // 長軸・短軸の端点(パラメータが 0・90°・180°・270° の点)。一部の楕円は、範囲に入っているものだけ
    const span = normalizeArcSpan(entity.startParam, entity.endParam);
    const full = span >= Math.PI * 2 - 1e-6;
    return [0, 1, 2, 3]
      .map((i) => i * HALF_PI)
      .filter((param) => full || isAngleInArcSweep(param, entity.startParam, entity.endParam))
      .map((param) => pointOnEllipse(entity.center, entity.majorRadius, entity.minorRadius, entity.rotation, param));
  }
  return [];
}

export function collectQuadrantCandidates(context: GeneratorContext): SnapCandidate[] {
  const { entities, visibleLayerNames, worldPoint, toleranceWorld } = context;
  const results: SnapCandidate[] = [];
  for (const entity of entities) {
    if (!visibleLayerNames.has(entity.layer)) continue;
    for (const point of quadrantsOf(entity)) {
      if (distance(point, worldPoint) <= toleranceWorld) results.push({ point, type: "quadrant" });
    }
  }
  return results;
}
