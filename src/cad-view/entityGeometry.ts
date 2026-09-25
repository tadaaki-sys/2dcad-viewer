import type { CadEntity, Point2D } from "../types/cad";

export function getEntityPoints(entity: CadEntity): Point2D[] {
  return entity.type === "LINE" ? [entity.start, entity.end] : entity.vertices;
}

/** Entityを構成する線分の一覧を返す(閉じたPOLYLINE/LWPOLYLINEは閉じる線分も含む) */
export function getEntitySegments(entity: CadEntity): Array<[Point2D, Point2D]> {
  const points = getEntityPoints(entity);
  const segments: Array<[Point2D, Point2D]> = [];
  for (let i = 0; i < points.length - 1; i++) {
    segments.push([points[i], points[i + 1]]);
  }
  if (entity.type !== "LINE" && entity.closed && points.length > 2) {
    segments.push([points[points.length - 1], points[0]]);
  }
  return segments;
}
