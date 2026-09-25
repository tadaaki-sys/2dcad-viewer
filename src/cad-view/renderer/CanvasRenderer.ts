import type { Renderer, RenderParams } from "./Renderer";

const LINE_WIDTH_PX = 1;

export class CanvasRenderer implements Renderer {
  render({ ctx, viewportWidth, viewportHeight, model, camera, visibleLayerNames }: RenderParams): void {
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, viewportWidth, viewportHeight);

    ctx.lineWidth = LINE_WIDTH_PX;

    for (const entity of model.entities) {
      if (!visibleLayerNames.has(entity.layer)) continue;

      ctx.strokeStyle = entity.color;
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

      ctx.stroke();
    }
  }
}
