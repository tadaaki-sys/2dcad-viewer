import { normalizeArcSpan } from "../../utils/geometry";
import type { CadArc, CadBounds, CadEntity } from "../../types/cad";
import { getEntityPoints } from "../entityGeometry";

export const BOUNDS_STRIDE = 4; // [minX, minY, maxX, maxY]

// 楕円は分割した点列(内接多角形)で範囲を求めるため、曲線が点列の外へはみ出す分をこの比率で余裕として足す
const ELLIPSE_BOUNDS_PADDING_RATIO = 0.01;

function writeBounds(out: Float64Array, offset: number, minX: number, minY: number, maxX: number, maxY: number): void {
  // 座標が有限でない図形は「どこにでも交差する」範囲にして、描画・選択から漏れないようにする
  if (!(Number.isFinite(minX) && Number.isFinite(minY) && Number.isFinite(maxX) && Number.isFinite(maxY))) {
    out[offset] = -Infinity;
    out[offset + 1] = -Infinity;
    out[offset + 2] = Infinity;
    out[offset + 3] = Infinity;
    return;
  }
  out[offset] = minX;
  out[offset + 1] = minY;
  out[offset + 2] = maxX;
  out[offset + 3] = maxY;
}

function writePointsBounds(out: Float64Array, offset: number, points: readonly { x: number; y: number }[], padding = 0): void {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  writeBounds(out, offset, minX - padding, minY - padding, maxX + padding, maxY + padding);
}

function isAngleInSweep(angle: number, start: number, span: number): boolean {
  const twoPi = Math.PI * 2;
  const delta = (((angle - start) % twoPi) + twoPi) % twoPi;
  return delta <= span;
}

function writeArcBounds(out: Float64Array, offset: number, arc: CadArc): void {
  const { center, radius, startAngle } = arc;
  const span = normalizeArcSpan(arc.startAngle, arc.endAngle);
  const endAngle = startAngle + span;
  let minX = Math.min(center.x + radius * Math.cos(startAngle), center.x + radius * Math.cos(endAngle));
  let maxX = Math.max(center.x + radius * Math.cos(startAngle), center.x + radius * Math.cos(endAngle));
  let minY = Math.min(center.y + radius * Math.sin(startAngle), center.y + radius * Math.sin(endAngle));
  let maxY = Math.max(center.y + radius * Math.sin(startAngle), center.y + radius * Math.sin(endAngle));
  // 弧が軸方向の極値(0/90/180/270度)をまたぐ場合は、その極値も範囲に含める
  if (isAngleInSweep(0, startAngle, span)) maxX = center.x + radius;
  if (isAngleInSweep(Math.PI / 2, startAngle, span)) maxY = center.y + radius;
  if (isAngleInSweep(Math.PI, startAngle, span)) minX = center.x - radius;
  if (isAngleInSweep((Math.PI * 3) / 2, startAngle, span)) minY = center.y - radius;
  writeBounds(out, offset, minX, minY, maxX, maxY);
}

/** 1つの図形のバウンディングボックスをout[offset..offset+3]へ書き込む */
export function writeEntityBounds(entity: CadEntity, out: Float64Array, offset: number): void {
  switch (entity.type) {
    case "LINE":
      writeBounds(
        out,
        offset,
        Math.min(entity.start.x, entity.end.x),
        Math.min(entity.start.y, entity.end.y),
        Math.max(entity.start.x, entity.end.x),
        Math.max(entity.start.y, entity.end.y),
      );
      return;
    case "LWPOLYLINE":
    case "POLYLINE":
      writePointsBounds(out, offset, entity.vertices);
      return;
    case "SPLINE":
      writePointsBounds(out, offset, entity.points);
      return;
    case "CIRCLE":
      writeBounds(
        out,
        offset,
        entity.center.x - entity.radius,
        entity.center.y - entity.radius,
        entity.center.x + entity.radius,
        entity.center.y + entity.radius,
      );
      return;
    case "ARC":
      writeArcBounds(out, offset, entity);
      return;
    case "ELLIPSE":
      writePointsBounds(out, offset, getEntityPoints(entity), Math.max(entity.majorRadius, entity.minorRadius) * ELLIPSE_BOUNDS_PADDING_RATIO);
      return;
    case "TEXT":
      writePointsBounds(out, offset, getEntityPoints(entity));
      return;
  }
}

/** 全図形のバウンディングボックスを [minX,minY,maxX,maxY] の繰り返しとして1本のFloat64Arrayにまとめる */
export function computeAllEntityBounds(entities: readonly CadEntity[]): Float64Array {
  const out = new Float64Array(entities.length * BOUNDS_STRIDE);
  for (let i = 0; i < entities.length; i++) {
    writeEntityBounds(entities[i], out, i * BOUNDS_STRIDE);
  }
  return out;
}

/** 有限な範囲を持つ図形すべてを含む全体のバウンディングボックス。1つも無ければnull */
export function unionOfEntityBounds(entityBounds: Float64Array): CadBounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < entityBounds.length; i += BOUNDS_STRIDE) {
    const bMinX = entityBounds[i];
    const bMinY = entityBounds[i + 1];
    const bMaxX = entityBounds[i + 2];
    const bMaxY = entityBounds[i + 3];
    if (!(Number.isFinite(bMinX) && Number.isFinite(bMaxX) && Number.isFinite(bMinY) && Number.isFinite(bMaxY))) continue;
    if (bMinX < minX) minX = bMinX;
    if (bMinY < minY) minY = bMinY;
    if (bMaxX > maxX) maxX = bMaxX;
    if (bMaxY > maxY) maxY = bMaxY;
  }
  return minX <= maxX ? { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } } : null;
}
