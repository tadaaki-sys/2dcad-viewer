import type { CadModel, Measurement, Point2D } from "../../types/cad";
import type { Camera } from "../../core/view/Camera";
import type { SpatialIndex } from "../../core/spatial/SpatialIndex";
import type { PreviewShape } from "../../core/commands";

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
  /** 測定モードでカーソルが吸い付いている位置。目印を描く。無ければnull(省略可) */
  snapMarkerPoint?: Point2D | null;
  /** 作図中のゴム紐(描いている途中の仮の図形)。図面のデータではなく、重ねて描くだけ。無ければ省略 */
  previewShapes?: readonly PreviewShape[];
  /** 画面外の図形を描画対象から外すための空間索引。無ければ全図形を走査する */
  spatialIndex: SpatialIndex | null;
};

export interface Renderer {
  render(params: RenderParams): void;
}
