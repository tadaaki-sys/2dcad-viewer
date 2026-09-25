import type { CadEntity } from "../../types/cad";
import type { Camera } from "../camera/Camera";
import type { DragSelectionBox, Renderer, RenderParams } from "./Renderer";

const LINE_WIDTH_PX = 1;
const HIGHLIGHT_LINE_WIDTH_PX = 2.5;
const HIGHLIGHT_COLOR = "#ffff00";
const WINDOW_BOX_COLOR = "#4a90e2";
const CROSSING_BOX_COLOR = "#50c878";

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
  }
}
