import type { CadModel, Measurement, Point2D } from "../../types/cad";
import type { Camera } from "../camera/Camera";
import type { SpatialIndex } from "../spatial/SpatialIndex";

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
  /** 画面外の図形を描画対象から外すための空間索引。無ければ全図形を走査する */
  spatialIndex: SpatialIndex | null;
};

export interface Renderer {
  render(params: RenderParams): void;
}
