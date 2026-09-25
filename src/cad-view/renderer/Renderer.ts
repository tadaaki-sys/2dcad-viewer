import type { CadModel, Measurement, Point2D } from "../../types/cad";
import type { Camera } from "../camera/Camera";

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
  measurement: Measurement | null;
  pendingMeasurementPoint: Point2D | null;
};

export interface Renderer {
  render(params: RenderParams): void;
}
