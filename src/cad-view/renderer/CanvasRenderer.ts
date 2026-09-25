import type { CadEntity } from "../../types/cad";
import type { Camera } from "../camera/Camera";
import type { Renderer, RenderParams } from "./Renderer";

const LINE_WIDTH_PX = 1;
const HIGHLIGHT_LINE_WIDTH_PX = 2.5;
const HIGHLIGHT_COLOR = "#ffff00";

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

export class CanvasRenderer implements Renderer {
  render({ ctx, viewportWidth, viewportHeight, model, camera, visibleLayerNames, selectedEntityId }: RenderParams): void {
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, viewportWidth, viewportHeight);

    ctx.lineWidth = LINE_WIDTH_PX;

    let selectedEntity: CadEntity | null = null;

    for (const entity of model.entities) {
      if (!visibleLayerNames.has(entity.layer)) continue;
      if (entity.id === selectedEntityId) {
        selectedEntity = entity;
        continue;
      }

      ctx.strokeStyle = entity.color;
      traceEntityPath(ctx, camera, entity);
      ctx.stroke();
    }

    if (selectedEntity) {
      ctx.strokeStyle = HIGHLIGHT_COLOR;
      ctx.lineWidth = HIGHLIGHT_LINE_WIDTH_PX;
      traceEntityPath(ctx, camera, selectedEntity);
      ctx.stroke();
      ctx.lineWidth = LINE_WIDTH_PX;
    }
  }
}
