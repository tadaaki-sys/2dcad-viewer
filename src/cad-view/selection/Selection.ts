import { pointToSegmentDistance, segmentsIntersect } from "../../utils/geometry";
import { distanceFromPointToText, getEntityPoints, getEntitySegments } from "../entityGeometry";
import type { CadEntity, Point2D } from "../../types/cad";

export type SelectionBox = {
  min: Point2D;
  max: Point2D;
};

export type BoxSelectionMode = "window" | "crossing";

/**
 * どのEntity種別でも、構成する線分(CIRCLE/ARCはテッセレーション済み)への最短距離で判定する。
 * TEXTだけは中身が詰まった矩形として扱い、バウンディングボックスの内側なら距離0(クリックしやすさ優先)。
 */
function distanceFromEntity(entity: CadEntity, point: Point2D): number {
  if (entity.type === "TEXT") return distanceFromPointToText(entity, point);
  let minDistance = Infinity;
  for (const [a, b] of getEntitySegments(entity)) {
    minDistance = Math.min(minDistance, pointToSegmentDistance(point, a, b));
  }
  return minDistance;
}

/**
 * ワールド座標point付近でtoleranceWorld以内にあるEntityを、距離が近い順にすべて返す。
 * 非表示レイヤー(visibleLayerNamesに含まれない)のEntityは選択対象から除外する。
 * 重なったEntityの巡回選択(Phase9)で候補一覧として使用する。
 */
export function findEntitiesNearPoint(
  entities: readonly CadEntity[],
  visibleLayerNames: ReadonlySet<string>,
  point: Point2D,
  toleranceWorld: number,
): CadEntity[] {
  const candidates: Array<{ entity: CadEntity; distance: number }> = [];

  for (const entity of entities) {
    if (!visibleLayerNames.has(entity.layer)) continue;
    const dist = distanceFromEntity(entity, point);
    if (dist <= toleranceWorld) {
      candidates.push({ entity, distance: dist });
    }
  }

  candidates.sort((a, b) => a.distance - b.distance);
  return candidates.map((candidate) => candidate.entity);
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
  return findEntitiesNearPoint(entities, visibleLayerNames, point, toleranceWorld)[0] ?? null;
}

function isPointInBox(point: Point2D, box: SelectionBox): boolean {
  return point.x >= box.min.x && point.x <= box.max.x && point.y >= box.min.y && point.y <= box.max.y;
}

function segmentIntersectsBox(a: Point2D, b: Point2D, box: SelectionBox): boolean {
  if (isPointInBox(a, box) || isPointInBox(b, box)) return true;

  const corners: Point2D[] = [
    { x: box.min.x, y: box.min.y },
    { x: box.max.x, y: box.min.y },
    { x: box.max.x, y: box.max.y },
    { x: box.min.x, y: box.max.y },
  ];
  for (let i = 0; i < corners.length; i++) {
    const c1 = corners[i];
    const c2 = corners[(i + 1) % corners.length];
    if (segmentsIntersect(a, b, c1, c2)) return true;
  }
  return false;
}

/** boxに完全に囲まれている(全頂点がbox内)場合のみtrue(Window Selection) */
export function isEntityFullyInsideBox(entity: CadEntity, box: SelectionBox): boolean {
  return getEntityPoints(entity).every((point) => isPointInBox(point, box));
}

/** boxに一部でも触れていればtrue(Crossing Selection) */
export function isEntityTouchingBox(entity: CadEntity, box: SelectionBox): boolean {
  const points = getEntityPoints(entity);
  if (points.some((point) => isPointInBox(point, box))) return true;
  return getEntitySegments(entity).some(([a, b]) => segmentIntersectsBox(a, b, box));
}

/**
 * 矩形範囲選択の対象Entityを返す。
 * mode="window": 完全に囲まれたEntityのみ(左→右ドラッグ)
 * mode="crossing": 範囲に触れたEntityも含む(右→左ドラッグ)
 */
export function findEntitiesInBox(
  entities: readonly CadEntity[],
  visibleLayerNames: ReadonlySet<string>,
  box: SelectionBox,
  mode: BoxSelectionMode,
): CadEntity[] {
  const test = mode === "window" ? isEntityFullyInsideBox : isEntityTouchingBox;
  return entities.filter((entity) => visibleLayerNames.has(entity.layer) && test(entity, box));
}
