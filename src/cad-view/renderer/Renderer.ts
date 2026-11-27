import type { CadModel, Measurement, Point2D } from "../../types/cad";
import type { Camera } from "../../core/view/Camera";
import type { SpatialIndex } from "../../core/spatial/SpatialIndex";
import type { PreviewShape } from "../../core/commands";
import type { SnapMarker } from "./snapMarker";
import type { TrackingGuide } from "../../core/tracking/trackingGeometry";
import type { TrackingLabel } from "./trackingRender";
import type { GripMark } from "./gripRender";

export type DragSelectionBox = {
  screenMin: Point2D;
  screenMax: Point2D;
  mode: "window" | "crossing";
};

export type RenderParams = {
  ctx: CanvasRenderingContext2D;
  viewportWidth: number;
  viewportHeight: number;
  model: CadModel;
  camera: Camera;
  visibleLayerNames: ReadonlySet<string>;
  selectedEntityIds: ReadonlySet<string>;
  dragSelectionBox: DragSelectionBox | null;
  measurements: readonly Measurement[];
  selectedMeasurementId: string | null;
  pendingMeasurementPoint: Point2D | null;
  /** カーソルが吸い付いている位置と、Snap の種類。種類ごとの形の目印と名前を描く。無ければnull(省略可) */
  snapMarker?: SnapMarker | null;
  /** 格子点の表示(GRID)。間隔(mm)。表示しないときは null(省略可) */
  gridSpacing?: number | null;
  /** トラッキングの一時補助線、OTRACK で取得した点、説明(角度など)(省略可) */
  trackingGuides?: readonly TrackingGuide[];
  acquiredPoints?: readonly Point2D[];
  trackingLabel?: TrackingLabel | null;
  /** 作図中のゴム紐(描いている途中の仮の図形)。図面のデータではなく、重ねて描くだけ。無ければ省略 */
  previewShapes?: readonly PreviewShape[];
  /** 画面外の図形を描画対象から外すための空間索引。無ければ全図形を走査する */
  spatialIndex: SpatialIndex | null;
  /** グリップ(選択した図形のつかむ点)。カーソルが乗っているものと、ホット(動かしている最中)のもの。無ければ省略 */
  grips?: readonly GripMark[];
  hoverGripKey?: string | null;
  hotGrip?: GripMark | null;
  /** ロックされたレイヤー(Phase 19)。その図形は、薄く(背景へ半分寄せた色で)描く。無ければ省略 */
  lockedLayerNames?: ReadonlySet<string>;
};

export interface Renderer {
  render(params: RenderParams): void;
}
