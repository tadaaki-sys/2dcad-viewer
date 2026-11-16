// カーソルの点を決める。段階: 図形への吸着(近接を除く) → トラッキング(ORTHO・極トラッキング・OTRACK) → 近接 → グリッド。
// 画面にも図面データにも依存しない純粋な処理(CadCanvas は、これを呼ぶだけ)。
import type { CadEntity, Point2D } from "../../types/cad";
import { findSnapPoint, nearestGridPoint } from "../snap/SnapEngine";
import type { SnapCandidate, SnapOptions, SnapType } from "../snap/SnapEngine";
import type { SpatialIndex } from "../spatial/SpatialIndex";
import { trackCursor } from "./trackingGeometry";
import type { TrackingResult } from "./trackingGeometry";
import type { TrackingSettings } from "./trackingSettings";

/** OTRACK で「取得」できる吸着点の種類(カーソルをとどめると、補助線の起点になる) */
export const ACQUIRABLE_SNAP_TYPES: ReadonlySet<SnapType> = new Set<SnapType>(["endpoint", "midpoint", "intersection", "center", "quadrant"]);

export type ResolveCursorParams = {
  entities: readonly CadEntity[];
  visibleLayerNames: ReadonlySet<string>;
  /** マウスの位置(吸着前) */
  worldPoint: Point2D;
  toleranceWorld: number;
  index?: SpatialIndex | null;
  /** Snap の設定(有効な種類など)。fromPoint は、基準点(base)が代わりに使われる */
  snapOptions: SnapOptions;
  /** 基準の点(作図中の直前の点、測定の1点目)。無ければ null */
  base: Point2D | null;
  tracking: TrackingSettings;
  /** OTRACK で取得している点 */
  acquired: readonly Point2D[];
};

export type CursorResolution = {
  /** 決まった点 */
  point: Point2D;
  /** 図形・近接・グリッドへの吸着(目印を出す)。トラッキングで決まったときは null */
  snap: SnapCandidate | null;
  /** トラッキングで揃えたとき。補助線と説明 */
  tracking: TrackingResult | null;
  /** カーソルをとどめると OTRACK で取得できる吸着点。無ければ null */
  acquirable: SnapCandidate | null;
};

export function resolveCursor(params: ResolveCursorParams): CursorResolution {
  const { entities, visibleLayerNames, worldPoint, toleranceWorld, index, snapOptions, base, tracking, acquired } = params;
  const enabled = snapOptions.enabledTypes;
  const withTypes = (types: ReadonlySet<SnapType>): SnapOptions => ({ ...snapOptions, enabledTypes: types, fromPoint: base });

  // 段階1: 図形への吸着(近接・グリッドを除く)。見つかれば、トラッキングより優先する
  const objectTypes = new Set<SnapType>(enabled ?? []);
  objectTypes.delete("nearest");
  objectTypes.delete("grid");
  if (objectTypes.size > 0) {
    const snap = findSnapPoint(entities, visibleLayerNames, worldPoint, toleranceWorld, index, withTypes(objectTypes));
    if (snap !== null) {
      return { point: snap.point, snap, tracking: null, acquirable: ACQUIRABLE_SNAP_TYPES.has(snap.type) ? snap : null };
    }
  }

  // 段階2: トラッキング
  const tracked = trackCursor(worldPoint, { base, acquired, settings: tracking, toleranceWorld });
  if (tracked !== null) {
    let point = tracked.point;
    // ORTHO だけで揃えたとき(補助線との交点ではない)は、SNAP(グリッド)がオンなら、軸の上で、いちばん近い格子点にする
    if (tracking.ortho && base !== null && tracked.guides.length === 0 && enabled?.has("grid") && snapOptions.gridSpacing !== undefined) {
      const grid = nearestGridPoint(point, snapOptions.gridSpacing);
      if (grid !== null) point = point.y === base.y ? { x: grid.x, y: base.y } : { x: base.x, y: grid.y };
    }
    return { point, snap: null, tracking: tracked, acquirable: null };
  }

  // 段階3: 近接、グリッド
  const restTypes = new Set<SnapType>();
  if (enabled?.has("nearest")) restTypes.add("nearest");
  if (enabled?.has("grid")) restTypes.add("grid");
  if (restTypes.size > 0) {
    const snap = findSnapPoint(entities, visibleLayerNames, worldPoint, toleranceWorld, index, withTypes(restTypes));
    if (snap !== null) return { point: snap.point, snap, tracking: null, acquirable: null };
  }
  return { point: worldPoint, snap: null, tracking: null, acquirable: null };
}
