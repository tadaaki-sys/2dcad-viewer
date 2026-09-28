import { distance, intersectSegments, normalizeArcSpan, pointOnArc } from "../../utils/geometry";
import { getEntitySegments } from "../entityGeometry";
import type { CadEntity, Point2D } from "../../types/cad";

export type SnapType = "endpoint" | "midpoint" | "intersection";

export type SnapCandidate = {
  point: Point2D;
  type: SnapType;
};

type CandidateGenerator = (
  entities: readonly CadEntity[],
  visibleLayerNames: ReadonlySet<string>,
  worldPoint: Point2D,
  toleranceWorld: number,
) => SnapCandidate[];

/** CIRCLE/TEXTには自然な「端点」概念がないため候補を出さない。ARCは始点/終点の厳密座標を2点返す */
function endpointsOf(entity: CadEntity): Point2D[] {
  if (entity.type === "LINE") return [entity.start, entity.end];
  if (entity.type === "CIRCLE" || entity.type === "TEXT") return [];
  if (entity.type === "ARC") return [pointOnArc(entity.center, entity.radius, entity.startAngle), pointOnArc(entity.center, entity.radius, entity.endAngle)];
  return entity.vertices;
}

function collectEndpointCandidates(
  entities: readonly CadEntity[],
  visibleLayerNames: ReadonlySet<string>,
  worldPoint: Point2D,
  toleranceWorld: number,
): SnapCandidate[] {
  const results: SnapCandidate[] = [];
  for (const entity of entities) {
    if (!visibleLayerNames.has(entity.layer)) continue;
    for (const point of endpointsOf(entity)) {
      if (distance(point, worldPoint) <= toleranceWorld) {
        results.push({ point, type: "endpoint" });
      }
    }
  }
  return results;
}

function collectMidpointCandidates(
  entities: readonly CadEntity[],
  visibleLayerNames: ReadonlySet<string>,
  worldPoint: Point2D,
  toleranceWorld: number,
): SnapCandidate[] {
  const results: SnapCandidate[] = [];
  for (const entity of entities) {
    if (!visibleLayerNames.has(entity.layer)) continue;

    // CIRCLE/TEXTには自然な中点がないため候補を出さない。ARCは弧の中央角度の厳密な1点のみ(テッセレーション頂点は使わない)
    if (entity.type === "CIRCLE" || entity.type === "TEXT") continue;
    if (entity.type === "ARC") {
      const span = normalizeArcSpan(entity.startAngle, entity.endAngle);
      const midpoint = pointOnArc(entity.center, entity.radius, entity.startAngle + span / 2);
      if (distance(midpoint, worldPoint) <= toleranceWorld) {
        results.push({ point: midpoint, type: "midpoint" });
      }
      continue;
    }

    for (const [a, b] of getEntitySegments(entity)) {
      const midpoint: Point2D = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (distance(midpoint, worldPoint) <= toleranceWorld) {
        results.push({ point: midpoint, type: "midpoint" });
      }
    }
  }
  return results;
}

/** segmentの(スナップ半径分だけ広げた)バウンディングボックスがworldPointを含むか */
function isSegmentNearPoint(a: Point2D, b: Point2D, worldPoint: Point2D, radius: number): boolean {
  const minX = Math.min(a.x, b.x) - radius;
  const maxX = Math.max(a.x, b.x) + radius;
  const minY = Math.min(a.y, b.y) - radius;
  const maxY = Math.max(a.y, b.y) + radius;
  return worldPoint.x >= minX && worldPoint.x <= maxX && worldPoint.y >= minY && worldPoint.y <= maxY;
}

function collectIntersectionCandidates(
  entities: readonly CadEntity[],
  visibleLayerNames: ReadonlySet<string>,
  worldPoint: Point2D,
  toleranceWorld: number,
): SnapCandidate[] {
  // 交点がtoleranceWorld以内になり得るのは、両方の線分がカーソル近傍を通る場合のみ。
  // 全Entity同士の総当たりを避けるため、まずカーソル近傍の線分だけに絞り込む(正確性を保った絞り込み)。
  const nearbySegments: Array<[Point2D, Point2D]> = [];
  for (const entity of entities) {
    if (!visibleLayerNames.has(entity.layer)) continue;
    for (const segment of getEntitySegments(entity)) {
      if (isSegmentNearPoint(segment[0], segment[1], worldPoint, toleranceWorld)) {
        nearbySegments.push(segment);
      }
    }
  }

  const results: SnapCandidate[] = [];
  for (let i = 0; i < nearbySegments.length; i++) {
    for (let j = i + 1; j < nearbySegments.length; j++) {
      const point = intersectSegments(
        nearbySegments[i][0],
        nearbySegments[i][1],
        nearbySegments[j][0],
        nearbySegments[j][1],
      );
      if (point && distance(point, worldPoint) <= toleranceWorld) {
        results.push({ point, type: "intersection" });
      }
    }
  }
  return results;
}

const CANDIDATE_GENERATORS: CandidateGenerator[] = [
  collectEndpointCandidates,
  collectMidpointCandidates,
  collectIntersectionCandidates,
];

/**
 * worldPointからtoleranceWorld以内にある最も近いSnap候補(Endpoint/Midpoint/Intersection)を返す。
 * 非表示レイヤーのEntityはSnap対象から除外する。将来Snap種類を追加する場合はCANDIDATE_GENERATORSに追加する。
 */
export function findSnapPoint(
  entities: readonly CadEntity[],
  visibleLayerNames: ReadonlySet<string>,
  worldPoint: Point2D,
  toleranceWorld: number,
): SnapCandidate | null {
  let best: SnapCandidate | null = null;
  let bestDistance = toleranceWorld;

  for (const generate of CANDIDATE_GENERATORS) {
    for (const candidate of generate(entities, visibleLayerNames, worldPoint, toleranceWorld)) {
      const dist = distance(candidate.point, worldPoint);
      if (dist <= bestDistance) {
        bestDistance = dist;
        best = candidate;
      }
    }
  }

  return best;
}
