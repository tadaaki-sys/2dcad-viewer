import { pointToSegmentDistance } from "../../utils/geometry";
import type { CadEntity, Point2D } from "../../types/cad";

function distanceFromEntity(entity: CadEntity, point: Point2D): number {
  if (entity.type === "LINE") {
    return pointToSegmentDistance(point, entity.start, entity.end);
  }

  const vertices = entity.vertices;
  let minDistance = Infinity;
  for (let i = 0; i < vertices.length - 1; i++) {
    minDistance = Math.min(minDistance, pointToSegmentDistance(point, vertices[i], vertices[i + 1]));
  }
  if (entity.closed && vertices.length > 2) {
    minDistance = Math.min(
      minDistance,
      pointToSegmentDistance(point, vertices[vertices.length - 1], vertices[0]),
    );
  }
  return minDistance;
}

/**
 * ワールド座標point付近でtoleranceWorld以内にある最も近いEntityを返す。
 * 非表示レイヤー(visibleLayerNamesに含まれない)のEntityは選択対象から除外する。
 */
export function findEntityAtPoint(
  entities: readonly CadEntity[],
  visibleLayerNames: ReadonlySet<string>,
  point: Point2D,
  toleranceWorld: number,
): CadEntity | null {
  let closestEntity: CadEntity | null = null;
  let closestDistance = toleranceWorld;

  for (const entity of entities) {
    if (!visibleLayerNames.has(entity.layer)) continue;
    const dist = distanceFromEntity(entity, point);
    if (dist <= closestDistance) {
      closestDistance = dist;
      closestEntity = entity;
    }
  }

  return closestEntity;
}
