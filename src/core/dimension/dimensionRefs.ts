// 寸法の参照(Phase 16): 図形の上の位置(アンカー)を点に直す、点に一致するアンカーを探す。画面にもファイル形式にも依存しない純粋な処理。
//
// 参照できる位置: 線の start・end・mid、円弧の start・end・mid・center、円の center、折れ線の頂点。
// (Snap の「端点・中点・中心」に対応する。折れ線の線分の中点・四半円点・交点・楕円・スプラインは、対象にしない)
import type { CadEntity, DimensionAnchor, Point2D } from "../../types/cad";
import { normalizeArcSpan, pointOnArc } from "../geometry/geometry";
import { BOUNDS_STRIDE, computeAllEntityBounds } from "../spatial/entityBounds";

/** 点が、図形の位置に「一致している」とみなす距離(mm)。Snap で吸着した点は、図形の座標そのものなので、ほぼ 0 で一致する */
export const ANCHOR_TOLERANCE = 1e-6;

/** 許容の上限(mm)。巨大な座標(1e12 mm など)で、離れた点どうしを、一致とみなさない。この大きさは、1e11 mm の座標の丸め(約 1.5e-5)より大きい */
const MAX_ANCHOR_TOLERANCE = 1e-4;

/** 座標の大きさに応じた許容(巨大な座標の丸め誤差を、不一致としないため。上限つき) */
export function anchorToleranceAt(p: Point2D): number {
  return Math.min(MAX_ANCHOR_TOLERANCE, ANCHOR_TOLERANCE + 1e-12 * Math.max(Math.abs(p.x), Math.abs(p.y)));
}

/** 2点が、一致しているとみなせるか */
export function isSameAnchorPoint(a: Point2D, b: Point2D): boolean {
  const tolerance = Math.max(anchorToleranceAt(a), anchorToleranceAt(b));
  return Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance;
}

/** 2つの座標の中間(和が桁あふれしても、有限な中間なら求める。有限でない入力は、そのまま有限でない値になる) */
function midOf(a: number, b: number): number {
  const mid = (a + b) / 2;
  return Number.isFinite(mid) ? mid : a / 2 + b / 2;
}

/** 図形の、アンカーの位置。図形にその位置が無い(種類が合わない・頂点の番号が範囲外・座標が有限でない)ときは null */
export function resolveAnchor(entity: CadEntity, anchor: DimensionAnchor): Point2D | null {
  const finite = (p: Point2D): Point2D | null => (Number.isFinite(p.x) && Number.isFinite(p.y) ? { x: p.x, y: p.y } : null);
  switch (entity.type) {
    case "LINE":
      if (anchor.kind === "start") return finite(entity.start);
      if (anchor.kind === "end") return finite(entity.end);
      if (anchor.kind === "mid") return finite({ x: midOf(entity.start.x, entity.end.x), y: midOf(entity.start.y, entity.end.y) });
      return null;
    case "ARC": {
      if (anchor.kind === "center") return finite(entity.center);
      if (anchor.kind === "start") return finite(pointOnArc(entity.center, entity.radius, entity.startAngle));
      const span = normalizeArcSpan(entity.startAngle, entity.endAngle);
      if (anchor.kind === "end") return finite(pointOnArc(entity.center, entity.radius, entity.startAngle + span));
      if (anchor.kind === "mid") return finite(pointOnArc(entity.center, entity.radius, entity.startAngle + span / 2));
      return null;
    }
    case "CIRCLE":
      return anchor.kind === "center" ? finite(entity.center) : null;
    case "LWPOLYLINE":
    case "POLYLINE": {
      if (anchor.kind !== "vertex" || !Number.isInteger(anchor.index) || anchor.index < 0 || anchor.index >= entity.vertices.length) return null;
      return finite(entity.vertices[anchor.index]);
    }
    default:
      return null;
  }
}

/** 図形の上に、アンカーを持てる種類か(参照の対象にできる図形) */
export function isReferenceTarget(entity: CadEntity): boolean {
  return entity.type === "LINE" || entity.type === "ARC" || entity.type === "CIRCLE" || entity.type === "LWPOLYLINE" || entity.type === "POLYLINE";
}

const NAMED_ANCHORS: readonly DimensionAnchor[] = [{ kind: "start" }, { kind: "end" }, { kind: "mid" }, { kind: "center" }];

/** 点に一致する、図形のアンカー(複数あるときは、start・end・mid・center・頂点の順)。一致しなければ null */
export function anchorMatching(entity: CadEntity, point: Point2D): DimensionAnchor | null {
  for (const anchor of NAMED_ANCHORS) {
    const at = resolveAnchor(entity, anchor);
    if (at !== null && isSameAnchorPoint(at, point)) return anchor;
  }
  if (entity.type === "LWPOLYLINE" || entity.type === "POLYLINE") {
    for (let i = 0; i < entity.vertices.length; i++) {
      if (isSameAnchorPoint(entity.vertices[i], point)) return { kind: "vertex", index: i };
    }
  }
  return null;
}

export type FoundAnchor = { id: string; anchor: DimensionAnchor };

/**
 * 点ごとに、その点に一致するアンカーを持つ図形を探す(表示中のレイヤーの図形だけ)。
 * 同じ点に複数の図形が一致するとき(共有する角)は、描画順で最前面(後ろにある)図形を選ぶ。
 * 全図形の範囲は、1回だけ計算する(点が複数でも、1回の走査)。見つからない点は null。
 */
export function findAnchorsAt(entities: readonly CadEntity[], visibleLayerNames: ReadonlySet<string>, points: readonly Point2D[]): Array<FoundAnchor | null> {
  const found: Array<FoundAnchor | null> = points.map(() => null);
  if (points.length === 0) return found;
  const bounds = computeAllEntityBounds(entities);
  for (let i = entities.length - 1; i >= 0; i--) {
    const entity = entities[i];
    if (!isReferenceTarget(entity) || !visibleLayerNames.has(entity.layer)) continue;
    const o = i * BOUNDS_STRIDE;
    for (let k = 0; k < points.length; k++) {
      if (found[k] !== null) continue;
      const p = points[k];
      const tolerance = anchorToleranceAt(p);
      if (p.x < bounds[o] - tolerance || p.x > bounds[o + 2] + tolerance || p.y < bounds[o + 1] - tolerance || p.y > bounds[o + 3] + tolerance) continue;
      const anchor = anchorMatching(entity, p);
      if (anchor !== null) found[k] = { id: entity.id, anchor };
    }
    if (found.every((f) => f !== null)) break;
  }
  return found;
}
