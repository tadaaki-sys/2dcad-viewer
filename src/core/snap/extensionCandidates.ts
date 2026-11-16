// 延長の Snap。線・円弧・折れ線の端点を、その向きに延長した線(端点より先の側だけ)の上に吸着する。
// 対象は、カーソルの近く(acquire の距離以内)に端点がある図形だけ(遠くの図形の延長線に、常に引き寄せられないように)。
import { distance, normalizeArcSpan, pointOnArc } from "../geometry/geometry";
import { isAngleInArcSweep } from "../geometry/curves";
import type { CadEntity, Point2D } from "../../types/cad";
import type { GeneratorContext } from "./snapContext";
import type { SnapCandidate } from "./snapTypes";

type EndRay = { end: Point2D; direction: Point2D };

/** 端点と、その端点で外へ向かう向き(長さ1)。2点が同じ(向きが決まらない)ときは作らない */
function ray(from: Point2D, end: Point2D): EndRay | null {
  const length = distance(from, end);
  if (!(length > 0)) return null;
  return { end, direction: { x: (end.x - from.x) / length, y: (end.y - from.y) / length } };
}

/** 直線の端(線の両端、開いた折れ線の両端の線分)の延長 */
function straightRays(entity: CadEntity): EndRay[] {
  const rays: Array<EndRay | null> = [];
  if (entity.type === "LINE") {
    rays.push(ray(entity.start, entity.end), ray(entity.end, entity.start));
  } else if ((entity.type === "LWPOLYLINE" || entity.type === "POLYLINE") && !entity.closed && entity.vertices.length >= 2) {
    const v = entity.vertices;
    rays.push(ray(v[1], v[0]), ray(v[v.length - 2], v[v.length - 1]));
  }
  return rays.filter((r): r is EndRay => r !== null);
}

export function collectExtensionCandidates(context: GeneratorContext): SnapCandidate[] {
  const { extensionEntities, visibleLayerNames, worldPoint, toleranceWorld, extensionAcquireWorld } = context;
  const results: SnapCandidate[] = [];

  for (const entity of extensionEntities) {
    if (!visibleLayerNames.has(entity.layer)) continue;

    if (entity.type === "ARC") {
      // 円弧の延長は、同じ円の続き。弧の範囲の外で、円周に近い点
      const dx = worldPoint.x - entity.center.x;
      const dy = worldPoint.y - entity.center.y;
      const fromCenter = Math.hypot(dx, dy);
      if (!(fromCenter > 0)) continue;
      const angle = Math.atan2(dy, dx);
      if (isAngleInArcSweep(angle, entity.startAngle, entity.endAngle)) continue;
      const span = normalizeArcSpan(entity.startAngle, entity.endAngle);
      const start = pointOnArc(entity.center, entity.radius, entity.startAngle);
      const end = pointOnArc(entity.center, entity.radius, entity.startAngle + span);
      // カーソルに近い方の端点が、acquire の距離以内にあること
      if (Math.min(distance(start, worldPoint), distance(end, worldPoint)) > extensionAcquireWorld) continue;
      const point = { x: entity.center.x + (dx / fromCenter) * entity.radius, y: entity.center.y + (dy / fromCenter) * entity.radius };
      if (distance(point, worldPoint) <= toleranceWorld) results.push({ point, type: "extension" });
      continue;
    }

    for (const { end, direction } of straightRays(entity)) {
      if (distance(end, worldPoint) > extensionAcquireWorld) continue;
      const along = (worldPoint.x - end.x) * direction.x + (worldPoint.y - end.y) * direction.y;
      if (!(along > 0)) continue; // 端点より先の側だけ(図形そのものの上は、近接など別の種類)
      const point = { x: end.x + direction.x * along, y: end.y + direction.y * along };
      if (distance(point, worldPoint) <= toleranceWorld) results.push({ point, type: "extension" });
    }
  }
  return results;
}
