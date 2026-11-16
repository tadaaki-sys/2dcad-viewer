import { distance, normalizeArcSpan, pointOnArc, pointOnEllipse } from "../geometry/geometry";
import { getEntitySegments } from "../geometry/entityGeometry";
import type { CadEntity, Point2D } from "../../types/cad";
import type { SpatialIndex } from "../spatial/SpatialIndex";
import { collectCenterCandidates, collectQuadrantCandidates } from "./centerQuadrantCandidates";
import { collectExtensionCandidates } from "./extensionCandidates";
import { collectIntersectionCandidates } from "./intersectionCandidates";
import { collectPerpendicularCandidates, collectTangentCandidates } from "./perpendicularTangentCandidates";
import type { GeneratorContext } from "./snapContext";
import { nearestPointOnEntity } from "./snapGeometry";
import type { SnapCandidate, SnapType } from "./snapTypes";

export type { SnapCandidate, SnapType } from "./snapTypes";

// 全周(または全周とみなせる誤差)のCIRCLE/ELLIPSEには自然な端点/中点がないため候補から除外する際の許容誤差
const FULL_SWEEP_EPSILON = 1e-6;

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

function collectEndpointCandidates({ entities, visibleLayerNames, worldPoint, toleranceWorld }: GeneratorContext): SnapCandidate[] {
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

function collectMidpointCandidates({ entities, visibleLayerNames, worldPoint, toleranceWorld }: GeneratorContext): SnapCandidate[] {
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
   * 端点・中点・交点などが見つからなかったとき、この距離以内の線上の最も近い点へ吸い付く(ワールド単位)。
   * toleranceWorldより大きくてもよい。未指定なら最近点スナップは行わない。
   */
  nearestToleranceWorld?: number;
  /**
   * 有効にする種類。未指定なら、これまでどおり(端点・中点・交点。最近点は nearestToleranceWorld を指定したとき)。
   * 指定したときは、ここに含まれる種類だけを調べる(最近点は、"nearest" を含み、nearestToleranceWorld が正のとき)。
   * "grid" を含めると、図形への吸着が無いとき、格子点へ吸い付く(gridSpacing が必要)。
   */
  enabledTypes?: ReadonlySet<SnapType>;
  /** 垂線・接線の基準の点(作図中の直前の点など)。無ければ、垂線・接線は出さない */
  fromPoint?: Point2D | null;
  /** 格子の間隔(mm)。"grid" が有効なときに使う */
  gridSpacing?: number;
  /** 延長の対象にする、端点とカーソルの最大距離(ワールド単位)。未指定なら、延長は出さない */
  extensionAcquireWorld?: number;
};

type NamedGenerator = { type: SnapType; generate: (context: GeneratorContext) => SnapCandidate[] };

/**
 * 候補を調べる順。距離が同じときは、あとの種類が選ばれる。
 * これまでの3種類(端点・中点・交点)の順は変えない(同じ距離のときの結果を変えないため)。新しい種類は、その前に置く。
 */
const GENERATORS: readonly NamedGenerator[] = [
  { type: "extension", generate: collectExtensionCandidates },
  { type: "tangent", generate: collectTangentCandidates },
  { type: "perpendicular", generate: collectPerpendicularCandidates },
  { type: "quadrant", generate: collectQuadrantCandidates },
  { type: "center", generate: collectCenterCandidates },
  { type: "endpoint", generate: collectEndpointCandidates },
  { type: "midpoint", generate: collectMidpointCandidates },
  { type: "intersection", generate: collectIntersectionCandidates },
];

const DEFAULT_ENABLED_TYPES: ReadonlySet<SnapType> = new Set<SnapType>(["endpoint", "midpoint", "intersection", "nearest"]);

// 円弧・楕円の中心の索引(中心の Snap 用)。外接の矩形がカーソルから離れていても、中心はカーソルの近くにあり得るため、
// 空間索引(外接の矩形による)では探せない。中心の x 座標で並べておき、二分探索で、カーソルの近くの中心だけを取り出す
// (円弧が非常に多い図面で、毎回全件を調べないため)。空間索引ごとに1回だけ作る(索引は、図面が変わるたびに作り直される)。
type CenterIndex = { entities: CadEntity[]; xs: Float64Array };
const centerIndexCache = new WeakMap<SpatialIndex, CenterIndex>();

function centerIndexOf(entities: readonly CadEntity[], index: SpatialIndex): CenterIndex {
  let built = centerIndexCache.get(index);
  if (built === undefined) {
    const owners = entities.filter(
      (entity): entity is Extract<CadEntity, { type: "ARC" | "ELLIPSE" }> =>
        (entity.type === "ARC" || entity.type === "ELLIPSE") && Number.isFinite(entity.center.x) && Number.isFinite(entity.center.y),
    );
    // 並べ替えは、図形のオブジェクトではなく、番号の配列(型付き配列)で行う(円弧が非常に多いとき、こちらが速い)
    const unsortedXs = Float64Array.from(owners, (entity) => entity.center.x);
    const order = Uint32Array.from(owners, (_, i) => i).sort((a, b) => unsortedXs[a] - unsortedXs[b]);
    built = {
      entities: Array.from(order, (i) => owners[i] as CadEntity),
      xs: Float64Array.from(order, (i) => unsortedXs[i]),
    };
    centerIndexCache.set(index, built);
  }
  return built;
}

/** xs(昇順)のうち、value 以上になる最初の位置 */
function lowerBound(xs: Float64Array, value: number): number {
  let low = 0;
  let high = xs.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (xs[mid] < value) low = mid + 1;
    else high = mid;
  }
  return low;
}

/** 中心の x 座標が [minX, maxX] にある、円弧・楕円 */
function centerOwnersNear(entities: readonly CadEntity[], index: SpatialIndex, minX: number, maxX: number): CadEntity[] {
  const built = centerIndexOf(entities, index);
  const result: CadEntity[] = [];
  for (let i = lowerBound(built.xs, minX); i < built.xs.length && built.xs[i] <= maxX; i++) result.push(built.entities[i]);
  return result;
}

/** 格子点のうち、point に最も近い点。間隔が使えない値、または結果が有限でないときは null */
export function nearestGridPoint(point: Point2D, spacing: number): Point2D | null {
  if (!(spacing > 0) || !Number.isFinite(spacing)) return null;
  const x = Math.round(point.x / spacing) * spacing;
  const y = Math.round(point.y / spacing) * spacing;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  // -0 は 0 にそろえる
  return { x: x === 0 ? 0 : x, y: y === 0 ? 0 : y };
}

/**
 * worldPointからtoleranceWorld以内にある最も近いSnap候補を返す。
 * 種類は、端点・中点・交点・中心・四半円点・垂線・接線・延長(図形への吸着)、最近点、格子(options.enabledTypes で選ぶ)。
 * 非表示レイヤーのEntityはSnap対象から除外する。
 * 優先順位: 図形への吸着のうち、カーソルに最も近いもの → 無ければ最近点 → 無ければ格子。
 */
export function findSnapPoint(
  entities: readonly CadEntity[],
  visibleLayerNames: ReadonlySet<string>,
  worldPoint: Point2D,
  toleranceWorld: number,
  index?: SpatialIndex | null,
  options: SnapOptions = {},
): SnapCandidate | null {
  const enabled = options.enabledTypes ?? DEFAULT_ENABLED_TYPES;
  const nearestTolerance = enabled.has("nearest") ? (options.nearestToleranceWorld ?? 0) : 0;
  const acquire = enabled.has("extension") ? (options.extensionAcquireWorld ?? 0) : 0;

  const queryEntities = (radius: number): readonly CadEntity[] =>
    index
      ? index.grid
          .queryRect(worldPoint.x - radius, worldPoint.y - radius, worldPoint.x + radius, worldPoint.y + radius)
          .map((i) => entities[i])
      : entities;

  // 端点・中点・交点・最近点などは図形自身の上にあるので、カーソル周辺にバウンディングボックスがある図形だけ調べればよい
  const nearbyEntities = queryEntities(Math.max(toleranceWorld, nearestTolerance));

  let best: SnapCandidate | null = null;
  const objectTypesEnabled = GENERATORS.some((g) => enabled.has(g.type));
  if (objectTypesEnabled) {
    const wantsCenter = enabled.has("center");
    const context: GeneratorContext = {
      entities: nearbyEntities,
      visibleLayerNames,
      worldPoint,
      toleranceWorld,
      fromPoint: options.fromPoint ?? null,
      centerEntities: wantsCenter
        ? index
          ? [
              ...nearbyEntities.filter((entity) => entity.type === "CIRCLE"),
              ...centerOwnersNear(entities, index, worldPoint.x - toleranceWorld, worldPoint.x + toleranceWorld),
            ]
          : entities
        : [],
      extensionEntities: acquire > 0 ? queryEntities(acquire) : [],
      extensionAcquireWorld: acquire,
    };
    let bestDistance = toleranceWorld;
    for (const { type, generate } of GENERATORS) {
      if (!enabled.has(type)) continue;
      for (const candidate of generate(context)) {
        const dist = distance(candidate.point, worldPoint);
        if (dist <= bestDistance) {
          bestDistance = dist;
          best = candidate;
        }
      }
    }
  }

  // 端点などが無いときだけ、近くの線の上の最も近い点へ吸い付く(端点などが常に優先)
  if (!best && nearestTolerance > 0) best = findNearestOnLine(nearbyEntities, visibleLayerNames, worldPoint, nearestTolerance);

  // それも無いときだけ、格子点へ吸い付く(許容距離は無く、いちばん近い格子点)
  if (!best && enabled.has("grid") && options.gridSpacing !== undefined) {
    const point = nearestGridPoint(worldPoint, options.gridSpacing);
    if (point !== null) best = { point, type: "grid" };
  }
  return best;
}
