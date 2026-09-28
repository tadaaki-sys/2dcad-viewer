import { normalizeArcSpan, pointOnArc } from "../utils/geometry";
import type { CadEntity, Point2D } from "../types/cad";

// 選択のヒットテストやWindow/Crossing判定用の固定分割数(描画時の解像度とは別、ズームに依存しない)
const FIXED_ARC_SEGMENTS_PER_FULL_CIRCLE = 48;

function tessellateArc(center: Point2D, radius: number, startAngle: number, span: number): Point2D[] {
  const segmentCount = Math.max(2, Math.round((span / (Math.PI * 2)) * FIXED_ARC_SEGMENTS_PER_FULL_CIRCLE));
  const points: Point2D[] = [];
  for (let i = 0; i <= segmentCount; i++) {
    points.push(pointOnArc(center, radius, startAngle + (span * i) / segmentCount));
  }
  return points;
}

/**
 * Entityを構成する頂点(または円/弧を近似した多角形の頂点)の一覧を返す。
 * CIRCLEは1周分、ARCはstartAngle〜endAngleのCCW区間をテッセレーションする。
 */
export function getEntityPoints(entity: CadEntity): Point2D[] {
  if (entity.type === "LINE") return [entity.start, entity.end];
  if (entity.type === "CIRCLE") return tessellateArc(entity.center, entity.radius, 0, Math.PI * 2);
  if (entity.type === "ARC") {
    const span = normalizeArcSpan(entity.startAngle, entity.endAngle);
    return tessellateArc(entity.center, entity.radius, entity.startAngle, span);
  }
  return entity.vertices;
}

/** Entityを構成する線分の一覧を返す(閉じたPOLYLINE/LWPOLYLINEは閉じる線分も含む。CIRCLEはテッセレーションにより自然に閉じる) */
export function getEntitySegments(entity: CadEntity): Array<[Point2D, Point2D]> {
  const points = getEntityPoints(entity);
  const segments: Array<[Point2D, Point2D]> = [];
  for (let i = 0; i < points.length - 1; i++) {
    segments.push([points[i], points[i + 1]]);
  }
  if ((entity.type === "LWPOLYLINE" || entity.type === "POLYLINE") && entity.closed && points.length > 2) {
    segments.push([points[points.length - 1], points[0]]);
  }
  return segments;
}
