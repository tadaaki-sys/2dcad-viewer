import type { CadModel } from "../../types/cad";
import type { Camera } from "../camera/Camera";

export type RenderParams = {
  ctx: CanvasRenderingContext2D;
  viewportWidth: number;
  viewportHeight: number;
  model: CadModel;
  camera: Camera;
  visibleLayerNames: ReadonlySet<string>;
};

export interface Renderer {
  render(params: RenderParams): void;
}
