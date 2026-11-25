import { isAngleInSweep, normalizeArcSpan, pointOnArc, pointOnEllipse, pointToSegmentDistance } from "./geometry";
import { dimensionArcPoints, dimensionDefiningPoints, dimensionLineSegments, dimensionTextEntity, layoutDimension } from "../dimension/dimensionGeometry";
import type { DimensionLayout } from "../dimension/dimensionGeometry";
import { measureTextBlock } from "../text/textLayout";
import type { CadDimension, CadEntity, CadText, Point2D } from "../../types/cad";

// 選択のヒットテストやWindow/Crossing判定用の固定分割数(描画時の解像度とは別、ズームに依存しない)
const FIXED_ARC_SEGMENTS_PER_FULL_CIRCLE = 48;

// TEXTの選択・バウンディングボックス用の概算(行の分け方・字幅の見積もりは、描画と同じ core/text/textLayout.ts)
export { TEXT_CHAR_WIDTH_FACTOR, TEXT_LINE_HEIGHT_FACTOR } from "../text/textLayout";

/** 基準点(position)からの相対座標系(回転前)でのバウンディングボックス。ワールドはY-upなので上方向は+Y */
function textLocalBounds(entity: CadText): { minX: number; maxX: number; minY: number; maxY: number } {
  const { width, height } = measureTextBlock(entity);
  const minX = entity.horizontalAlign === "left" ? 0 : entity.horizontalAlign === "right" ? -width : -width / 2;
  const maxX = minX + width;
  const minY = entity.verticalAlign === "top" ? -height : entity.verticalAlign === "middle" ? -height / 2 : 0;
  const maxY = minY + height;
  return { minX, maxX, minY, maxY };
}

/** TEXTの(回転を反映した)バウンディングボックス4隅。Window/Crossing選択やbounds計算に使う */
export function getTextBoundingBoxCorners(entity: CadText): Point2D[] {
  const { minX, maxX, minY, maxY } = textLocalBounds(entity);
  const localCorners: Point2D[] = [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];
  const cos = Math.cos(entity.rotation);
  const sin = Math.sin(entity.rotation);
  return localCorners.map((p) => ({
    x: entity.position.x + p.x * cos - p.y * sin,
    y: entity.position.y + p.x * sin + p.y * cos,
  }));
}

/** ワールド座標pointからTEXTのバウンディングボックスまでの最短距離(内側なら0) */
export function distanceFromPointToText(entity: CadText, point: Point2D): number {
  const cos = Math.cos(-entity.rotation);
  const sin = Math.sin(-entity.rotation);
  const dx = point.x - entity.position.x;
  const dy = point.y - entity.position.y;
  const localX = dx * cos - dy * sin;
  const localY = dx * sin + dy * cos;
  const { minX, maxX, minY, maxY } = textLocalBounds(entity);
  const clampedX = Math.max(minX, Math.min(maxX, localX));
  const clampedY = Math.max(minY, Math.min(maxY, localY));
  return Math.hypot(localX - clampedX, localY - clampedY);
}

/** 寸法の、すべての点(線・矢印・弧・文字の外形)。形が決まらない寸法は、定義点 */
function getDimensionPoints(entity: CadDimension, layout: DimensionLayout | null): Point2D[] {
  if (layout === null) return dimensionDefiningPoints(entity);
  const points: Point2D[] = [...layout.segments.flat(), ...layout.arrows.flat(), ...getTextBoundingBoxCorners(dimensionTextEntity(entity, layout))];
  if (layout.arc !== null) points.push(...dimensionArcPoints(layout.arc));
  return points;
}

/** 寸法の、線の部分(文字を除く)と文字の外形の辺。文字の辺は、文字の枠を囲む線分 */
function getDimensionSegments(entity: CadDimension): Array<[Point2D, Point2D]> {
  const layout = layoutDimension(entity);
  const segments = dimensionLineSegments(entity, layout).map(([a, b]): [Point2D, Point2D] => [a, b]);
  if (layout !== null) {
    const corners = getTextBoundingBoxCorners(dimensionTextEntity(entity, layout));
    for (let i = 0; i < corners.length; i++) segments.push([corners[i], corners[(i + 1) % corners.length]]);
  }
  return segments;
}

/** ワールド座標pointから寸法までの最短距離。線・矢印・弧への距離と、文字の枠(内側なら0)への距離の小さい方 */
export function distanceFromPointToDimension(entity: CadDimension, point: Point2D): number {
  const layout = layoutDimension(entity);
  let min = Infinity;
  // 弧は、折れ線ではなく、解析的に(円弧 ARC と同じ。半径が大きいと、弦と弧の差が、選択の許容距離を超えるため)
  for (const [a, b] of dimensionLineSegments(entity, layout, false)) min = Math.min(min, pointToSegmentDistance(point, a, b));
  if (layout !== null) {
    min = Math.min(min, distanceFromPointToText(dimensionTextEntity(entity, layout), point));
    if (layout.arc !== null) min = Math.min(min, distanceFromPointToArc(layout.arc, point));
  }
  return min;
}

/** 弧(中心・半径・開始角・掃引角)までの最短距離 */
function distanceFromPointToArc(arc: { center: Point2D; radius: number; startAngle: number; sweep: number }, point: Point2D): number {
  const angle = Math.atan2(point.y - arc.center.y, point.x - arc.center.x);
  if (isAngleInSweep(angle, arc.startAngle, arc.sweep)) return Math.abs(Math.hypot(point.x - arc.center.x, point.y - arc.center.y) - arc.radius);
  return Math.min(
    Math.hypot(point.x - (arc.center.x + arc.radius * Math.cos(arc.startAngle)), point.y - (arc.center.y + arc.radius * Math.sin(arc.startAngle))),
    Math.hypot(point.x - (arc.center.x + arc.radius * Math.cos(arc.startAngle + arc.sweep)), point.y - (arc.center.y + arc.radius * Math.sin(arc.startAngle + arc.sweep))),
  );
}

function tessellateArc(center: Point2D, radius: number, startAngle: number, span: number): Point2D[] {
  const segmentCount = Math.max(2, Math.round((span / (Math.PI * 2)) * FIXED_ARC_SEGMENTS_PER_FULL_CIRCLE));
  const points: Point2D[] = [];
  for (let i = 0; i <= segmentCount; i++) {
    points.push(pointOnArc(center, radius, startAngle + (span * i) / segmentCount));
  }
  return points;
}

function tessellateEllipse(
  center: Point2D,
  majorRadius: number,
  minorRadius: number,
  rotation: number,
  startParam: number,
  span: number,
): Point2D[] {
  const segmentCount = Math.max(2, Math.round((span / (Math.PI * 2)) * FIXED_ARC_SEGMENTS_PER_FULL_CIRCLE));
  const points: Point2D[] = [];
  for (let i = 0; i <= segmentCount; i++) {
    points.push(pointOnEllipse(center, majorRadius, minorRadius, rotation, startParam + (span * i) / segmentCount));
  }
  return points;
}

/**
 * Entityを構成する頂点(または円/弧/楕円を近似した多角形の頂点)の一覧を返す。
 * CIRCLE/ELLIPSE(全周)は1周分、ARC/ELLIPSE(一部)はstart〜endのCCW区間をテッセレーションする。
 */
export function getEntityPoints(entity: CadEntity): Point2D[] {
  if (entity.type === "LINE") return [entity.start, entity.end];
  if (entity.type === "CIRCLE") return tessellateArc(entity.center, entity.radius, 0, Math.PI * 2);
  if (entity.type === "ARC") {
    const span = normalizeArcSpan(entity.startAngle, entity.endAngle);
    return tessellateArc(entity.center, entity.radius, entity.startAngle, span);
  }
  if (entity.type === "ELLIPSE") {
    const span = normalizeArcSpan(entity.startParam, entity.endParam);
    return tessellateEllipse(entity.center, entity.majorRadius, entity.minorRadius, entity.rotation, entity.startParam, span);
  }
  if (entity.type === "TEXT") return getTextBoundingBoxCorners(entity);
  if (entity.type === "DIMENSION") return getDimensionPoints(entity, layoutDimension(entity));
  if (entity.type === "SPLINE") return entity.points;
  if (entity.type === "POINT") return [entity.position];
  return entity.vertices;
}

/** Entityを構成する線分の一覧を返す(閉じたPOLYLINE/LWPOLYLINEは閉じる線分も含む。CIRCLE/TEXTはテッセレーション・バウンディングボックスにより自然に閉じる) */
export function getEntitySegments(entity: CadEntity): Array<[Point2D, Point2D]> {
  if (entity.type === "DIMENSION") return getDimensionSegments(entity);
  const points = getEntityPoints(entity);
  const segments: Array<[Point2D, Point2D]> = [];
  for (let i = 0; i < points.length - 1; i++) {
    segments.push([points[i], points[i + 1]]);
  }
  const hasClosedFlag =
    (entity.type === "LWPOLYLINE" || entity.type === "POLYLINE" || entity.type === "SPLINE") && entity.closed;
  if ((hasClosedFlag || entity.type === "TEXT") && points.length > 2) {
    segments.push([points[points.length - 1], points[0]]);
  }
  return segments;
}
