import { normalizeArcSpan, pointOnArc, pointOnEllipse } from "../utils/geometry";
import type { CadEntity, CadText, Point2D } from "../types/cad";

// 選択のヒットテストやWindow/Crossing判定用の固定分割数(描画時の解像度とは別、ズームに依存しない)
const FIXED_ARC_SEGMENTS_PER_FULL_CIRCLE = 48;

// TEXTの選択・バウンディングボックス用の概算値(実際のグリフ幅を測るのではなく、文字種ごとの固定幅の近似)
export const TEXT_CHAR_WIDTH_FACTOR = 0.65;
export const TEXT_LINE_HEIGHT_FACTOR = 1.2;
// 日本語などの全角文字は、文字高とほぼ同じ幅になる
const FULL_WIDTH_CHAR_WIDTH_FACTOR = 1;
const FIRST_FULL_WIDTH_CODE_POINT = 0x2e80;

function estimateLineWidthInEm(line: string): number {
  let width = 0;
  for (const char of line) {
    const codePoint = char.codePointAt(0) ?? 0;
    width += codePoint >= FIRST_FULL_WIDTH_CODE_POINT ? FULL_WIDTH_CHAR_WIDTH_FACTOR : TEXT_CHAR_WIDTH_FACTOR;
  }
  return width;
}

function measureTextBlock(entity: CadText): { width: number; height: number; lineCount: number } {
  const lines = entity.text.split("\n");
  const longestLineWidthInEm = Math.max(TEXT_CHAR_WIDTH_FACTOR, ...lines.map(estimateLineWidthInEm));
  return {
    width: longestLineWidthInEm * entity.height * (entity.widthFactor ?? 1),
    height: lines.length * entity.height * TEXT_LINE_HEIGHT_FACTOR,
    lineCount: lines.length,
  };
}

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
  if (entity.type === "SPLINE") return entity.points;
  return entity.vertices;
}

/** Entityを構成する線分の一覧を返す(閉じたPOLYLINE/LWPOLYLINEは閉じる線分も含む。CIRCLE/TEXTはテッセレーション・バウンディングボックスにより自然に閉じる) */
export function getEntitySegments(entity: CadEntity): Array<[Point2D, Point2D]> {
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
