import {
  closestPointOnSegment,
  distance,
  intersectSegments,
  isAngleInSweep,
  normalizeArcSpan,
  pointOnArc,
  pointOnEllipse,
  pointToSegmentDistance,
} from "../../utils/geometry";
import { getEntitySegments } from "../entityGeometry";
import type { CadEntity, Point2D } from "../../types/cad";
import type { SpatialIndex } from "../spatial/SpatialIndex";

export type SnapType = "endpoint" | "midpoint" | "intersection" | "nearest";

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

// 全周(または全周とみなせる誤差)のCIRCLE/ELLIPSEには自然な端点/中点がないため候補から除外する際の許容誤差
const FULL_SWEEP_EPSILON = 1e-6;

// カーソル近傍の線分数がこれを超える場合は交点スナップを計算しない(総当たりは線分数の2乗)
const MAX_INTERSECTION_SEGMENTS = 600;

function isFullSweep(span: number): boolean {
  return span >= Math.PI * 2 - FULL_SWEEP_EPSILON;
}

/** CIRCLE/TEXT、および全周のELLIPSEには自然な「端点」概念がないため候補を出さない。ARC/部分ELLIPSEは始点/終点の厳密座標を2点返す */
function endpointsOf(entity: CadEntity): Point2D[] {
  if (entity.type === "LINE") return [entity.start, entity.end];
  if (entity.type === "POINT") return [entity.position]; // 点そのものが「節点」スナップの対象
  if (entity.type === "CIRCLE" || entity.type === "TEXT") return [];
  // SPLINEは近似点列の中間点を端点として拾わず、開いている場合のみ両端を返す
  if (entity.type === "SPLINE") {
    return entity.closed || entity.points.length < 2 ? [] : [entity.points[0], entity.points[entity.points.length - 1]];
  }
  if (entity.type === "ARC") return [pointOnArc(entity.center, entity.radius, entity.startAngle), pointOnArc(entity.center, entity.radius, entity.endAngle)];
  if (entity.type === "ELLIPSE") {
    const span = normalizeArcSpan(entity.startParam, entity.endParam);
    if (isFullSweep(span)) return [];
    return [
      pointOnEllipse(entity.center, entity.majorRadius, entity.minorRadius, entity.rotation, entity.startParam),
      pointOnEllipse(entity.center, entity.majorRadius, entity.minorRadius, entity.rotation, entity.endParam),
    ];
  }
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

    // CIRCLE/TEXT、および全周のELLIPSEには自然な中点がないため候補を出さない。ARC/部分ELLIPSEは弧の中央角度の厳密な1点のみ(テッセレーション頂点は使わない)
    if (entity.type === "CIRCLE" || entity.type === "TEXT" || entity.type === "SPLINE" || entity.type === "POINT") continue;
    if (entity.type === "ARC") {
      const span = normalizeArcSpan(entity.startAngle, entity.endAngle);
      const midpoint = pointOnArc(entity.center, entity.radius, entity.startAngle + span / 2);
      if (distance(midpoint, worldPoint) <= toleranceWorld) {
        results.push({ point: midpoint, type: "midpoint" });
      }
      continue;
    }
    if (entity.type === "ELLIPSE") {
      const span = normalizeArcSpan(entity.startParam, entity.endParam);
      if (isFullSweep(span)) continue;
      const midpoint = pointOnEllipse(entity.center, entity.majorRadius, entity.minorRadius, entity.rotation, entity.startParam + span / 2);
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
      // 交点は両方の線分上にあり、かつカーソルからtoleranceWorld以内なので、各線分自身がその範囲に入っている必要がある。
      // 安価なバウンディングボックス判定で粗く絞ってから、実距離で絞ると、後段の総当たり(線分数の2乗)が大きく減る。
      if (
        isSegmentNearPoint(segment[0], segment[1], worldPoint, toleranceWorld) &&
        pointToSegmentDistance(worldPoint, segment[0], segment[1]) <= toleranceWorld
      ) {
        nearbySegments.push(segment);
      }
    }
  }

  // 線分が極端に密集している箇所(ハッチングなど)で総当たりをすると操作が固まるため、交点スナップは諦める
  if (nearbySegments.length > MAX_INTERSECTION_SEGMENTS) return [];

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

/** entity上でworldPointに最も近い点。TEXTなど線を持たない図形はnull */
function nearestPointOnEntity(entity: CadEntity, worldPoint: Point2D): Point2D | null {
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

/** 線の上の最も近い点(最近点スナップ)。端点・中点・交点が無いときの代わりに使う */
function findNearestOnLine(
  entities: readonly CadEntity[],
  visibleLayerNames: ReadonlySet<string>,
  worldPoint: Point2D,
  toleranceWorld: number,
): SnapCandidate | null {
  let best: SnapCandidate | null = null;
  let bestDistance = toleranceWorld;
  for (const entity of entities) {
    if (!visibleLayerNames.has(entity.layer)) continue;
    const point = nearestPointOnEntity(entity, worldPoint);
    if (!point) continue;
    const d = distance(point, worldPoint);
    if (d <= bestDistance) {
      bestDistance = d;
      best = { point, type: "nearest" };
    }
  }
  return best;
}

export type SnapOptions = {
  /**
   * 端点・中点・交点が見つからなかったとき、この距離以内の線上の最も近い点へ吸い付く(ワールド単位)。
   * toleranceWorldより大きくてもよい。未指定なら最近点スナップは行わない。
   */
  nearestToleranceWorld?: number;
};

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
  index?: SpatialIndex | null,
  options: SnapOptions = {},
): SnapCandidate | null {
  let best: SnapCandidate | null = null;
  let bestDistance = toleranceWorld;
  const nearestTolerance = options.nearestToleranceWorld ?? 0;

  // 端点・中点・交点・最近点はいずれも図形自身の上にあるので、カーソル周辺にバウンディングボックスがある図形だけ調べればよい
  const queryTolerance = Math.max(toleranceWorld, nearestTolerance);
  const nearbyEntities = index
    ? index.grid
        .queryRect(worldPoint.x - queryTolerance, worldPoint.y - queryTolerance, worldPoint.x + queryTolerance, worldPoint.y + queryTolerance)
        .map((i) => entities[i])
    : entities;

  for (const generate of CANDIDATE_GENERATORS) {
    for (const candidate of generate(nearbyEntities, visibleLayerNames, worldPoint, toleranceWorld)) {
      const dist = distance(candidate.point, worldPoint);
      if (dist <= bestDistance) {
        bestDistance = dist;
        best = candidate;
      }
    }
  }

  // 端点・中点・交点が無いときだけ、近くの線の上の最も近い点へ吸い付く(端点などが常に優先)
  if (!best && nearestTolerance > 0) {
    return findNearestOnLine(nearbyEntities, visibleLayerNames, worldPoint, nearestTolerance);
  }
  return best;
}
