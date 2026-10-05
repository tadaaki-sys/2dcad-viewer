import type { CadEntity, CadText, Measurement, Point2D } from "../../types/cad";
import { computeMeasurementDistances } from "../measurement/Measurement";
import { formatMm } from "../../utils/format";
import { normalizeArcSpan, pointOnEllipse } from "../../utils/geometry";
import type { Camera } from "../camera/Camera";
import type { DragSelectionBox, Renderer, RenderParams } from "./Renderer";
import { TEXT_LINE_HEIGHT_FACTOR } from "../entityGeometry";
import { BOUNDS_STRIDE } from "../spatial/entityBounds";

const LINE_WIDTH_PX = 1;
const HIGHLIGHT_LINE_WIDTH_PX = 2.5;
const HIGHLIGHT_COLOR = "#ffff00";
const WINDOW_BOX_COLOR = "#4a90e2";
const CROSSING_BOX_COLOR = "#50c878";
const MEASUREMENT_COLOR = "#ff8c00";
const MEASUREMENT_MARKER_RADIUS_PX = 4;
const MEASUREMENT_FONT = "11px sans-serif";

// 画面上でこれより小さいフォントサイズになったTEXTは、視認できず描画コストだけかかるため省略する
const MIN_TEXT_RENDER_PX = 3;

// 画面上の大きさ(縦横とも)がこれ未満の図形は、ほとんど見えず描画コストだけかかるため描画しない
const MIN_ENTITY_SCREEN_SIZE_PX = 0.5;

// ズーム倍率に応じた楕円の分割数(画面上で1segmentがおおよそこのpx幅に収まるようにする)。円/弧はブラウザ標準のarcで描く。
const ARC_SEGMENT_TARGET_PX = 3;
const MIN_ARC_SEGMENTS_PER_FULL_CIRCLE = 12;
const MAX_ARC_SEGMENTS_PER_FULL_CIRCLE = 128;

function computeAdaptiveSegmentCount(radiusWorld: number, spanRadians: number, scale: number): number {
  const screenRadius = Math.abs(radiusWorld * scale);
  const fullCircleSegments = Math.min(
    MAX_ARC_SEGMENTS_PER_FULL_CIRCLE,
    Math.max(MIN_ARC_SEGMENTS_PER_FULL_CIRCLE, Math.ceil((2 * Math.PI * screenRadius) / ARC_SEGMENT_TARGET_PX)),
  );
  const fraction = Math.min(1, spanRadians / (Math.PI * 2));
  return Math.max(2, Math.round(fullCircleSegments * fraction));
}

// 以下のパス構築関数は、ワールド→スクリーン変換(Y反転)を数値のまま展開して書く。
// 点ごとにオブジェクトを作ると、数十万点の描画でGCが支配的になるため。
//   screenX = worldX * k + ox,  screenY = oy - worldY * k

function appendPolyline(
  path: CanvasPath,
  vertices: readonly Point2D[],
  closed: boolean,
  k: number,
  ox: number,
  oy: number,
): void {
  for (let i = 0; i < vertices.length; i++) {
    const x = vertices[i].x * k + ox;
    const y = oy - vertices[i].y * k;
    if (i === 0) path.moveTo(x, y);
    else path.lineTo(x, y);
  }
  if (closed) path.closePath();
}

function appendEllipse(
  path: CanvasPath,
  entity: Extract<CadEntity, { type: "ELLIPSE" }>,
  k: number,
  ox: number,
  oy: number,
): void {
  const span = normalizeArcSpan(entity.startParam, entity.endParam);
  const segmentCount = computeAdaptiveSegmentCount(Math.max(entity.majorRadius, entity.minorRadius), span, k);
  for (let i = 0; i <= segmentCount; i++) {
    const p = pointOnEllipse(
      entity.center,
      entity.majorRadius,
      entity.minorRadius,
      entity.rotation,
      entity.startParam + (span * i) / segmentCount,
    );
    const x = p.x * k + ox;
    const y = oy - p.y * k;
    if (i === 0) path.moveTo(x, y);
    else path.lineTo(x, y);
  }
}

/** 図形1つ分のパスをpath(CanvasRenderingContext2DまたはPath2D)へ追加する */
function appendEntity(path: CanvasPath, entity: Exclude<CadEntity, CadText>, k: number, ox: number, oy: number): void {
  switch (entity.type) {
    case "LINE":
      path.moveTo(entity.start.x * k + ox, oy - entity.start.y * k);
      path.lineTo(entity.end.x * k + ox, oy - entity.end.y * k);
      return;
    case "CIRCLE": {
      const x = entity.center.x * k + ox;
      const y = oy - entity.center.y * k;
      const r = entity.radius * k;
      path.moveTo(x + r, y);
      path.arc(x, y, r, 0, Math.PI * 2);
      return;
    }
    case "ARC": {
      const x = entity.center.x * k + ox;
      const y = oy - entity.center.y * k;
      const r = entity.radius * k;
      const span = normalizeArcSpan(entity.startAngle, entity.endAngle);
      // Y軸が反転しているため、ワールドのCCW(角度増加)はcanvasの角度では符号が逆で、反時計回り指定になる
      path.moveTo(x + r * Math.cos(entity.startAngle), y - r * Math.sin(entity.startAngle));
      path.arc(x, y, r, -entity.startAngle, -(entity.startAngle + span), true);
      return;
    }
    case "ELLIPSE":
      appendEllipse(path, entity, k, ox, oy);
      return;
    case "SPLINE":
      appendPolyline(path, entity.points, entity.closed, k, ox, oy);
      return;
    case "LWPOLYLINE":
    case "POLYLINE":
      appendPolyline(path, entity.vertices, entity.closed, k, ox, oy);
      return;
  }
}

/** 選択ハイライトなど、図形を個別にctxへ描くためのパス作成 */
function traceEntityPath(ctx: CanvasRenderingContext2D, camera: Camera, entity: Exclude<CadEntity, CadText>): void {
  ctx.beginPath();
  appendEntity(ctx, entity, camera.scale, camera.offsetX, camera.offsetY);
}

/** ワールド座標系(Y-up)の位置・回転をスクリーン座標系(Y-down)へ変換してTEXT/MTEXTを描画する */
function drawTextEntity(ctx: CanvasRenderingContext2D, camera: Camera, entity: CadText, color: string): void {
  const fontSizePx = entity.height * camera.scale;
  if (!(fontSizePx >= MIN_TEXT_RENDER_PX)) return;

  const screenPosition = camera.worldToScreen(entity.position);
  const lines = entity.text.length > 0 ? entity.text.split("\n") : [""];
  const lineHeightPx = fontSizePx * TEXT_LINE_HEIGHT_FACTOR;

  ctx.save();
  ctx.translate(screenPosition.x, screenPosition.y);
  // worldToScreenはY軸を反転するため、ワールドでのCCW回転(entity.rotation)はスクリーン上では逆向きになる
  ctx.rotate(-entity.rotation);
  ctx.fillStyle = color;
  ctx.font = `${fontSizePx}px sans-serif`;
  ctx.textAlign = entity.horizontalAlign;

  if (entity.verticalAlign === "baseline") {
    ctx.textBaseline = "alphabetic";
    lines.forEach((line, index) => ctx.fillText(line, 0, index * lineHeightPx));
  } else {
    ctx.textBaseline = "top";
    const blockHeightPx = lineHeightPx * lines.length;
    const startY =
      entity.verticalAlign === "top" ? 0 : entity.verticalAlign === "middle" ? -blockHeightPx / 2 : -blockHeightPx;
    lines.forEach((line, index) => ctx.fillText(line, 0, startY + index * lineHeightPx));
  }

  ctx.restore();
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
    spatialIndex,
  }: RenderParams): void {
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, viewportWidth, viewportHeight);

    ctx.lineWidth = LINE_WIDTH_PX;

    const { entities } = model;
    const entityBounds = spatialIndex?.entityBounds ?? model.entityBounds;
    const k = camera.scale;
    const minWorldSize = MIN_ENTITY_SCREEN_SIZE_PX / k;
    const hasSelection = selectedEntityIds.size > 0;

    // 画面に映る範囲(ワールド座標)。線幅分の余白を持たせる。画面が図面全体を含むなら絞り込み不要。
    const margin = 2 / k;
    const viewMinX = (0 - camera.offsetX) / k - margin;
    const viewMaxX = (viewportWidth - camera.offsetX) / k + margin;
    const viewMinY = (camera.offsetY - viewportHeight) / k - margin;
    const viewMaxY = camera.offsetY / k + margin;
    const world = spatialIndex?.worldBounds ?? null;
    const viewCoversWorld =
      world !== null &&
      viewMinX <= world.min.x &&
      viewMaxX >= world.max.x &&
      viewMinY <= world.min.y &&
      viewMaxY >= world.max.y;
    const candidateIndices =
      spatialIndex && !viewCoversWorld ? spatialIndex.grid.queryRect(viewMinX, viewMinY, viewMaxX, viewMaxY, false) : null;
    const candidateCount = candidateIndices ? candidateIndices.length : entities.length;

    // 同じ色の図形は1本のパスにまとめて1回のstrokeで描く(図形ごとにstrokeするとEntity数に比例して遅くなる)
    const pathsByColor = new Map<string, Path2D>();
    const texts: CadText[] = [];
    const selectedEntities: CadEntity[] = [];

    for (let n = 0; n < candidateCount; n++) {
      const i = candidateIndices ? candidateIndices[n] : n;
      const entity = entities[i];
      if (!visibleLayerNames.has(entity.layer)) continue;
      if (hasSelection && selectedEntityIds.has(entity.id)) {
        selectedEntities.push(entity);
        continue;
      }

      const o = i * BOUNDS_STRIDE;
      if (entityBounds[o + 2] - entityBounds[o] < minWorldSize && entityBounds[o + 3] - entityBounds[o + 1] < minWorldSize) {
        continue;
      }

      if (entity.type === "TEXT") {
        texts.push(entity);
        continue;
      }
      let path = pathsByColor.get(entity.color);
      if (!path) {
        path = new Path2D();
        pathsByColor.set(entity.color, path);
      }
      appendEntity(path, entity, k, camera.offsetX, camera.offsetY);
    }

    for (const [color, path] of pathsByColor) {
      ctx.strokeStyle = color;
      ctx.stroke(path);
    }
    for (const text of texts) {
      drawTextEntity(ctx, camera, text, text.color);
    }

    if (selectedEntities.length > 0) {
      ctx.strokeStyle = HIGHLIGHT_COLOR;
      ctx.lineWidth = HIGHLIGHT_LINE_WIDTH_PX;
      for (const entity of selectedEntities) {
        if (entity.type === "TEXT") {
          drawTextEntity(ctx, camera, entity, HIGHLIGHT_COLOR);
          continue;
        }
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
