// 折れ線の頂点の編集(追加・削除・閉じる/開く)(Phase 18)。画面にもファイル形式にも依存しない純粋な処理。
// 図形は書き換えず、新しい図形を返す。頂点が持つほかの値(bulge など)は、残す。
import type { CadEntity, Point2D } from "../../types/cad";

type Polyline = Extract<CadEntity, { type: "LWPOLYLINE" | "POLYLINE" }>;

export type VertexEdit = { ok: true; entity: CadEntity } | { ok: false; error: string };

const fail = (error: string): VertexEdit => ({ ok: false, error });

export const isPolyline = (entity: CadEntity): entity is Polyline => entity.type === "LWPOLYLINE" || entity.type === "POLYLINE";

/** 頂点の数の下限(開いた折れ線は2、閉じた折れ線は3) */
export function minimumVertexCount(closed: boolean): number {
  return closed ? 3 : 2;
}

/** 点から線分 a-b への、最も近い点(線分の上)と、a から b への位置(0〜1)と、距離 */
function nearestOnSegment(point: Point2D, a: Point2D, b: Point2D): { point: Point2D; t: number; distance: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length2 = dx * dx + dy * dy;
  const t = length2 > 0 && Number.isFinite(length2) ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length2)) : 0;
  const nearest = { x: a.x + dx * t, y: a.y + dy * t };
  return { point: nearest, t, distance: Math.hypot(point.x - nearest.x, point.y - nearest.y) };
}

/**
 * 点(クリックした位置)に最も近い線分に、頂点を足す。新しい頂点は、その線分の上の、最も近い点。
 * 頂点の位置に重なる(線分の端に近すぎる)ときは、断る。
 */
export function insertVertexNear(entity: CadEntity, point: Point2D): VertexEdit {
  if (!isPolyline(entity)) return fail("折れ線ではありません");
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return fail("位置が正しくありません");
  const n = entity.vertices.length;
  const segments = entity.closed ? n : n - 1;
  if (segments < 1) return fail("線分がありません");
  let best = -1;
  let bestHit: ReturnType<typeof nearestOnSegment> | null = null;
  for (let k = 0; k < segments; k++) {
    const hit = nearestOnSegment(point, entity.vertices[k], entity.vertices[(k + 1) % n]);
    if (bestHit === null || hit.distance < bestHit.distance) {
      best = k;
      bestHit = hit;
    }
  }
  if (bestHit === null || !Number.isFinite(bestHit.distance)) return fail("線分が見つかりません");
  const a = entity.vertices[best];
  const b = entity.vertices[(best + 1) % n];
  // 端(頂点)に重なる位置には、足さない(同じ位置の頂点が2つできる)
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (bestHit.t * length <= 1e-9 * Math.max(1, length) || (1 - bestHit.t) * length <= 1e-9 * Math.max(1, length)) return fail("頂点と同じ位置です。線分の途中をクリックしてください");
  const vertices = entity.vertices.slice();
  vertices.splice(best + 1, 0, { x: bestHit.point.x, y: bestHit.point.y });
  return { ok: true, entity: { ...entity, vertices } };
}

/** 点に最も近い頂点の番号と距離。頂点が無ければ null */
export function nearestVertex(entity: CadEntity, point: Point2D): { index: number; distance: number } | null {
  if (!isPolyline(entity)) return null;
  let index = -1;
  let distance = Infinity;
  entity.vertices.forEach((vertex, i) => {
    const d = Math.hypot(vertex.x - point.x, vertex.y - point.y);
    if (d < distance) {
      distance = d;
      index = i;
    }
  });
  return index < 0 || !Number.isFinite(distance) ? null : { index, distance };
}

/**
 * 点(クリックした位置)に最も近い頂点を削除する。tolerance(図面上の長さ)より離れているときは、断る
 * (線分の途中をクリックして、遠くの頂点が消えないように)。頂点が下限に達するときも、断る。
 */
export function deleteVertexNear(entity: CadEntity, point: Point2D, tolerance: number): VertexEdit {
  if (!isPolyline(entity)) return fail("折れ線ではありません");
  const nearest = nearestVertex(entity, point);
  if (nearest === null) return fail("頂点がありません");
  if (!(nearest.distance <= tolerance)) return fail("頂点の近くをクリックしてください");
  const minimum = minimumVertexCount(entity.closed);
  if (entity.vertices.length <= minimum) return fail(`頂点は、${minimum} 個より少なくできません(${entity.closed ? "閉じた" : "開いた"}折れ線)`);
  return { ok: true, entity: { ...entity, vertices: entity.vertices.filter((_, i) => i !== nearest.index) } };
}

/** 折れ線を、閉じる・開く。すでにその状態のとき、閉じるのに頂点が足りないときは、断る */
export function setPolylineClosed(entity: CadEntity, closed: boolean): VertexEdit {
  if (!isPolyline(entity)) return fail("折れ線ではありません");
  if (entity.closed === closed) return fail(closed ? "すでに閉じています" : "すでに開いています");
  if (closed && entity.vertices.length < minimumVertexCount(true)) return fail("頂点が 3 個以上ないと、閉じられません");
  return { ok: true, entity: { ...entity, closed } };
}
