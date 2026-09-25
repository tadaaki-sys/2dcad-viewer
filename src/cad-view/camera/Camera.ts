import type { CadBounds, Point2D } from "../../types/cad";

const DEFAULT_FIT_MARGIN_RATIO = 0.05;
const MIN_SCALE = 1e-6;
const MAX_SCALE = 1e6;

export class Camera {
  scale = 1;
  offsetX = 0;
  offsetY = 0;

  worldToScreen(point: Point2D): Point2D {
    return {
      x: point.x * this.scale + this.offsetX,
      y: -point.y * this.scale + this.offsetY,
    };
  }

  screenToWorld(point: Point2D): Point2D {
    return {
      x: (point.x - this.offsetX) / this.scale,
      y: -(point.y - this.offsetY) / this.scale,
    };
  }

  fit(
    bounds: CadBounds,
    viewportWidth: number,
    viewportHeight: number,
    marginRatio: number = DEFAULT_FIT_MARGIN_RATIO,
  ): void {
    const boundsWidth = bounds.max.x - bounds.min.x;
    const boundsHeight = bounds.max.y - bounds.min.y;
    const usableWidth = viewportWidth * (1 - marginRatio * 2);
    const usableHeight = viewportHeight * (1 - marginRatio * 2);

    const scaleX = boundsWidth > 0 ? usableWidth / boundsWidth : Infinity;
    const scaleY = boundsHeight > 0 ? usableHeight / boundsHeight : Infinity;
    let scale = Math.min(scaleX, scaleY);
    if (!Number.isFinite(scale) || scale <= 0) {
      scale = 1;
    }

    const centerWorldX = (bounds.min.x + bounds.max.x) / 2;
    const centerWorldY = (bounds.min.y + bounds.max.y) / 2;

    this.scale = scale;
    this.offsetX = viewportWidth / 2 - centerWorldX * scale;
    this.offsetY = viewportHeight / 2 + centerWorldY * scale;
  }

  /** カーソル位置(screenPoint)の直下のワールド座標を固定したままscaleにfactorを掛けてズームする */
  zoomAt(screenPoint: Point2D, factor: number): void {
    const worldPointUnderCursor = this.screenToWorld(screenPoint);
    const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, this.scale * factor));

    this.scale = nextScale;
    this.offsetX = screenPoint.x - worldPointUnderCursor.x * nextScale;
    this.offsetY = screenPoint.y + worldPointUnderCursor.y * nextScale;
  }

  /** スクリーン座標系での平行移動量だけビューをパンする */
  pan(deltaScreenX: number, deltaScreenY: number): void {
    this.offsetX += deltaScreenX;
    this.offsetY += deltaScreenY;
  }
}
