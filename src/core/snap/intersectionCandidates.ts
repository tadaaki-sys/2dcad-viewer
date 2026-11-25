// 交点の Snap。直線どうしは線分の交点、円・円弧が絡むものは、折れ線への近似ではなく、解析的に求める。
// (楕円・スプラインは、これまでどおり折れ線の近似)
import { distance, intersectSegments, pointToSegmentDistance } from "../geometry/geometry";
import { getEntitySegments } from "../geometry/entityGeometry";
import { intersectCircles, intersectSegmentCircle, isPointInArcSweep } from "../geometry/curves";
import type { CadArc, CadCircle, Point2D } from "../../types/cad";
import type { GeneratorContext } from "./snapContext";
import { distanceToCurve } from "./snapGeometry";
import type { SnapCandidate } from "./snapTypes";

// 同じ頂点とみなす距離(mm)
const SHARED_VERTEX_EPSILON = 1e-9;

// カーソル近傍の線分・曲線の数がこれを超える場合は交点スナップを計算しない(総当たりは数の2乗)
const MAX_INTERSECTION_ITEMS = 600;

/** segmentの(スナップ半径分だけ広げた)バウンディングボックスがworldPointを含むか */
function isSegmentNearPoint(a: Point2D, b: Point2D, worldPoint: Point2D, radius: number): boolean {
  const minX = Math.min(a.x, b.x) - radius;
  const maxX = Math.max(a.x, b.x) + radius;
  const minY = Math.min(a.y, b.y) - radius;
  const maxY = Math.max(a.y, b.y) + radius;
  return worldPoint.x >= minX && worldPoint.x <= maxX && worldPoint.y >= minY && worldPoint.y <= maxY;
}

type Curve = CadCircle | CadArc;

/** 交点が、その曲線(円は全周、円弧は範囲内)の上にあるか */
function isOnCurve(curve: Curve, point: Point2D): boolean {
  return curve.type === "CIRCLE" || isPointInArcSweep(curve.center, point, curve.startAngle, curve.endAngle);
}

/** 図形の線分の一覧(getEntitySegments)での、線分の位置の情報 */
type SegmentInfo = { a: Point2D; b: Point2D; owner: number; index: number; count: number; closedLoop: boolean };

function nearPoint(p: Point2D, q: Point2D): boolean {
  return Math.abs(p.x - q.x) <= SHARED_VERTEX_EPSILON && Math.abs(p.y - q.y) <= SHARED_VERTEX_EPSILON;
}

/**
 * 同じ図形の、隣り合う2本の線分(続けて並んでいる、または、閉じた図形で、最初と最後)が、point の頂点を共有しているか。
 * 隣り合わない線分が、同じ点で交わるもの(折れ線が自分自身と交わる点)は、含めない。
 */
function isAdjacentSharedVertex(point: Point2D, first: SegmentInfo, second: SegmentInfo): boolean {
  if (first.owner !== second.owner) return false;
  const consecutive = Math.abs(first.index - second.index) === 1;
  const wrapsAround =
    first.closedLoop && ((first.index === 0 && second.index === first.count - 1) || (second.index === 0 && first.index === first.count - 1));
  if (!consecutive && !wrapsAround) return false;
  const atEnd = (segment: SegmentInfo) => nearPoint(point, segment.a) || nearPoint(point, segment.b);
  return atEnd(first) && atEnd(second);
}

export function collectIntersectionCandidates(context: GeneratorContext): SnapCandidate[] {
  const { entities, visibleLayerNames, worldPoint, toleranceWorld } = context;
  // 交点がtoleranceWorld以内になり得るのは、両方の図形がカーソル近傍を通る場合のみ。
  // 全図形同士の総当たりを避けるため、まずカーソル近傍を通る線分・曲線だけに絞り込む(正確性を保った絞り込み)。
  // 線分が属する図形と、その中での位置の情報を持つ(同じ図形の、隣り合う線分が頂点で接しているのを、交点と取り違えないために使う)
  const nearbySegments: SegmentInfo[] = [];
  const nearbyCurves: Curve[] = [];
  for (let owner = 0; owner < entities.length; owner++) {
    const entity = entities[owner];
    if (!visibleLayerNames.has(entity.layer)) continue;
    // 寸法は、スナップの対象にしない(寸法線・矢印・補助線は、吸着の候補を増やすだけ。連動寸法の Phase で見直す)
    if (entity.type === "DIMENSION") continue;
    if (entity.type === "CIRCLE" || entity.type === "ARC") {
      if (distanceToCurve(entity, worldPoint) <= toleranceWorld) nearbyCurves.push(entity);
      continue;
    }
    const segments = getEntitySegments(entity);
    // 閉じた図形(最後の線分の終点が、最初の線分の始点)か
    const closedLoop = segments.length > 2 && nearPoint(segments[0][0], segments[segments.length - 1][1]);
    for (let index = 0; index < segments.length; index++) {
      const segment = segments[index];
      // 安価なバウンディングボックス判定で粗く絞ってから、実距離で絞る(後段の総当たりが大きく減る)
      if (
        isSegmentNearPoint(segment[0], segment[1], worldPoint, toleranceWorld) &&
        pointToSegmentDistance(worldPoint, segment[0], segment[1]) <= toleranceWorld
      ) {
        nearbySegments.push({ a: segment[0], b: segment[1], owner, index, count: segments.length, closedLoop });
      }
    }
  }

  // 線分が極端に密集している箇所(ハッチングなど)で総当たりをすると操作が固まるため、交点スナップは諦める
  if (nearbySegments.length + nearbyCurves.length > MAX_INTERSECTION_ITEMS) return [];

  const results: SnapCandidate[] = [];
  const add = (point: Point2D | null) => {
    if (point && distance(point, worldPoint) <= toleranceWorld) results.push({ point, type: "intersection" });
  };

  for (let i = 0; i < nearbySegments.length; i++) {
    for (let j = i + 1; j < nearbySegments.length; j++) {
      const first = nearbySegments[i];
      const second = nearbySegments[j];
      const point = intersectSegments(first.a, first.b, second.a, second.b);
      // 同じ図形の、隣り合う線分が、共有する頂点で接しているだけのものは、交点ではない
      // (楕円・スプラインは折れ線に近似しているので、近似の頂点が、交点として吸着してしまう。折れ線の頂点は、端点で吸着できる)
      if (point !== null && isAdjacentSharedVertex(point, first, second)) continue;
      add(point);
    }
  }
  for (const curve of nearbyCurves) {
    for (const { a, b } of nearbySegments) {
      for (const point of intersectSegmentCircle(a, b, curve.center, curve.radius)) {
        if (isOnCurve(curve, point)) add(point);
      }
    }
  }
  for (let i = 0; i < nearbyCurves.length; i++) {
    for (let j = i + 1; j < nearbyCurves.length; j++) {
      const a = nearbyCurves[i];
      const b = nearbyCurves[j];
      for (const point of intersectCircles(a.center, a.radius, b.center, b.radius)) {
        if (isOnCurve(a, point) && isOnCurve(b, point)) add(point);
      }
    }
  }
  return results;
}
