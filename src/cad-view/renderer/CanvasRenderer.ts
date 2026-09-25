import type { CadEntity, Measurement, Point2D } from "../../types/cad";
import { computeMeasurementDistances } from "../measurement/Measurement";
import { formatMm } from "../../utils/format";
import type { Camera } from "../camera/Camera";
import type { DragSelectionBox, Renderer, RenderParams } from "./Renderer";

const LINE_WIDTH_PX = 1;
const HIGHLIGHT_LINE_WIDTH_PX = 2.5;
const HIGHLIGHT_COLOR = "#ffff00";
const WINDOW_BOX_COLOR = "#4a90e2";
const CROSSING_BOX_COLOR = "#50c878";
const MEASUREMENT_COLOR = "#ff8c00";
const MEASUREMENT_MARKER_RADIUS_PX = 4;
const MEASUREMENT_FONT = "11px sans-serif";

function traceEntityPath(ctx: CanvasRenderingContext2D, camera: Camera, entity: CadEntity): void {
  ctx.beginPath();

  if (entity.type === "LINE") {
    const start = camera.worldToScreen(entity.start);
    const end = camera.worldToScreen(entity.end);
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
  } else {
    entity.vertices.forEach((vertex, index) => {
      const screenPoint = camera.worldToScreen(vertex);
      if (index === 0) {
        ctx.moveTo(screenPoint.x, screenPoint.y);
      } else {
        ctx.lineTo(screenPoint.x, screenPoint.y);
      }
    });
    if (entity.closed) {
      ctx.closePath();
    }
  }
}

function drawDragSelectionBox(ctx: CanvasRenderingContext2D, box: DragSelectionBox): void {
  const { screenMin, screenMax, mode } = box;
  const width = screenMax.x - screenMin.x;
  const height = screenMax.y - screenMin.y;
  const color = mode === "window" ? WINDOW_BOX_COLOR : CROSSING_BOX_COLOR;

  ctx.save();
  ctx.fillStyle = `${color}26`; // ~15% alpha
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash(mode === "window" ? [] : [4, 3]);
  ctx.fillRect(screenMin.x, screenMin.y, width, height);
  ctx.strokeRect(screenMin.x, screenMin.y, width, height);
  ctx.restore();
}

function drawMeasurementMarker(ctx: CanvasRenderingContext2D, screenPoint: Point2D): void {
  const r = MEASUREMENT_MARKER_RADIUS_PX;
  ctx.beginPath();
  ctx.moveTo(screenPoint.x - r, screenPoint.y);
  ctx.lineTo(screenPoint.x + r, screenPoint.y);
  ctx.moveTo(screenPoint.x, screenPoint.y - r);
  ctx.lineTo(screenPoint.x, screenPoint.y + r);
  ctx.stroke();
}

function drawMeasurementLabel(ctx: CanvasRenderingContext2D, screenPoint: Point2D, text: string): void {
  ctx.fillText(text, screenPoint.x + 4, screenPoint.y - 4);
}

function midpoint(a: Point2D, b: Point2D): Point2D {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function drawMeasurement(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  measurement: Measurement,
  isSelected: boolean,
): void {
  const { pointA, pointB } = measurement;
  const distances = computeMeasurementDistances(pointA, pointB);
  const screenA = camera.worldToScreen(pointA);
  const screenB = camera.worldToScreen(pointB);
  const screenCorner = camera.worldToScreen({ x: pointB.x, y: pointA.y });

  ctx.save();
  ctx.strokeStyle = MEASUREMENT_COLOR;
  ctx.fillStyle = MEASUREMENT_COLOR;
  ctx.font = MEASUREMENT_FONT;
  ctx.lineWidth = isSelected ? HIGHLIGHT_LINE_WIDTH_PX : LINE_WIDTH_PX;

  // 水平・垂直の補助線(破線)
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(screenA.x, screenA.y);
  ctx.lineTo(screenCorner.x, screenCorner.y);
  ctx.moveTo(screenCorner.x, screenCorner.y);
  ctx.lineTo(screenB.x, screenB.y);
  ctx.stroke();
  ctx.setLineDash([]);

  // 直線距離(実線)
  ctx.beginPath();
  ctx.moveTo(screenA.x, screenA.y);
  ctx.lineTo(screenB.x, screenB.y);
  ctx.stroke();

  drawMeasurementMarker(ctx, screenA);
  drawMeasurementMarker(ctx, screenB);

  drawMeasurementLabel(ctx, midpoint(screenA, screenCorner), formatMm(distances.horizontal));
  drawMeasurementLabel(ctx, midpoint(screenCorner, screenB), formatMm(distances.vertical));
  drawMeasurementLabel(ctx, midpoint(screenA, screenB), formatMm(distances.direct));

  ctx.restore();
}

export class CanvasRenderer implements Renderer {
  render({
    ctx,
    viewportWidth,
    viewportHeight,
    model,
    camera,
    visibleLayerNames,
    selectedEntityIds,
    dragSelectionBox,
    measurements,
    selectedMeasurementId,
    pendingMeasurementPoint,
  }: RenderParams): void {
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, viewportWidth, viewportHeight);

    ctx.lineWidth = LINE_WIDTH_PX;

    const selectedEntities: CadEntity[] = [];

    for (const entity of model.entities) {
      if (!visibleLayerNames.has(entity.layer)) continue;
      if (selectedEntityIds.has(entity.id)) {
        selectedEntities.push(entity);
        continue;
      }

      ctx.strokeStyle = entity.color;
      traceEntityPath(ctx, camera, entity);
      ctx.stroke();
    }

    if (selectedEntities.length > 0) {
      ctx.strokeStyle = HIGHLIGHT_COLOR;
      ctx.lineWidth = HIGHLIGHT_LINE_WIDTH_PX;
      for (const entity of selectedEntities) {
        traceEntityPath(ctx, camera, entity);
        ctx.stroke();
      }
      ctx.lineWidth = LINE_WIDTH_PX;
    }

    if (dragSelectionBox) {
      drawDragSelectionBox(ctx, dragSelectionBox);
    }

    for (const measurement of measurements) {
      drawMeasurement(ctx, camera, measurement, measurement.id === selectedMeasurementId);
    }

    if (pendingMeasurementPoint) {
      ctx.save();
      ctx.strokeStyle = MEASUREMENT_COLOR;
      drawMeasurementMarker(ctx, camera.worldToScreen(pendingMeasurementPoint));
      ctx.restore();
    }
  }
}
