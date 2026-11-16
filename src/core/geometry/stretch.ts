// STRETCH(ストレッチ)の、図形ごとの計算。交差窓の中にある頂点・端点だけを動かして、図形の形を変える。
// 画面にも図面データの保存にも依存しない純粋な処理。
//
// 図形ごとの扱い:
//   LINE          端点が窓の中にあれば、その端点だけ動く(両方なら、線ごと移動)
//   折れ線・スプライン  窓の中にある頂点だけ動く(全部なら、図形ごと移動)
//   円・点・文字    中心(挿入点)が窓の中にあれば、図形ごと移動
//   円弧・楕円     全体が窓の中にあるときだけ、図形ごと移動。一部だけ窓に入っているものは、対象外(partial-skipped)
// 窓の辺の上にある点は、中にあるものとして扱う(境界を含む)。
import type { Affine2D, CadEntity, Point2D } from "../../types/cad";
import { computeAllEntityBounds } from "../spatial/entityBounds";
import { transformEntityGeometry, translationMatrix } from "./transform";

/** 交差窓(辺が座標軸に平行な長方形)。min ≦ max */
export type StretchWindow = { min: Point2D; max: Point2D };

/** 対角の2点から、窓を作る */
export function windowFromCorners(a: Point2D, b: Point2D): StretchWindow {
  return { min: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) }, max: { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) } };
}

/** 点が、窓の中(辺の上を含む)にあるか */
export function pointInWindow(point: Point2D, window: StretchWindow): boolean {
  return point.x >= window.min.x && point.x <= window.max.x && point.y >= window.min.y && point.y <= window.max.y;
}

/** 図形の範囲([minX, minY, maxX, maxY])が、窓と重なるか(辺が触れるだけも含む) */
export function boundsTouchWindow(bounds: ArrayLike<number>, offset: number, window: StretchWindow): boolean {
  return bounds[offset] <= window.max.x && bounds[offset + 2] >= window.min.x && bounds[offset + 1] <= window.max.y && bounds[offset + 3] >= window.min.y;
}

/** 窓の4隅(左下から反時計回り) */
export function windowCorners(window: StretchWindow): Point2D[] {
  return [
    { x: window.min.x, y: window.min.y },
    { x: window.max.x, y: window.min.y },
    { x: window.max.x, y: window.max.y },
    { x: window.min.x, y: window.max.y },
  ];
}

export type StretchOutcome =
  /** 窓の中に、動かすものが無い */
  | { kind: "unchanged" }
  /** 図形ごと動いた(平行移動と同じ。元データとの対応は、行列の合成でよい) */
  | { kind: "moved"; entity: CadEntity; matrix: Affine2D }
  /** 一部の頂点だけが動いて、形が変わった */
  | { kind: "reshaped"; entity: CadEntity }
  /** 円弧・楕円が、一部だけ窓に入っている(動かせないので、対象外) */
  | { kind: "partial-skipped" };

/**
 * 図形を、窓と移動量(dx, dy)で、ストレッチする。有限な座標が、移動で有限でなくなる(桁あふれ)ときは、例外。
 * 元の図形は変えない。
 */
export function stretchEntityGeometry(entity: CadEntity, window: StretchWindow, dx: number, dy: number): StretchOutcome {
  const shift = (p: Point2D): Point2D => {
    const moved = { x: p.x + dx, y: p.y + dy };
    if (Number.isFinite(p.x) && Number.isFinite(p.y) && !(Number.isFinite(moved.x) && Number.isFinite(moved.y))) {
      throw new Error("変換後の座標が大きすぎて、扱えません");
    }
    return moved;
  };
  const wholly = (): StretchOutcome => {
    const matrix = translationMatrix(dx, dy);
    return { kind: "moved", entity: transformEntityGeometry(entity, matrix), matrix };
  };

  switch (entity.type) {
    case "LINE": {
      const startIn = pointInWindow(entity.start, window);
      const endIn = pointInWindow(entity.end, window);
      if (startIn && endIn) return wholly();
      if (!startIn && !endIn) return { kind: "unchanged" };
      return { kind: "reshaped", entity: { ...entity, start: startIn ? shift(entity.start) : entity.start, end: endIn ? shift(entity.end) : entity.end } };
    }
    case "LWPOLYLINE":
    case "POLYLINE": {
      const inside = entity.vertices.map((vertex) => pointInWindow(vertex, window));
      const count = inside.filter(Boolean).length;
      if (count === 0) return { kind: "unchanged" };
      if (count === inside.length) return wholly();
      // 頂点が持つほかの値(bulge など)は、そのまま残す
      return { kind: "reshaped", entity: { ...entity, vertices: entity.vertices.map((vertex, i) => (inside[i] ? { ...vertex, ...shift(vertex) } : vertex)) } };
    }
    case "SPLINE": {
      const inside = entity.points.map((point) => pointInWindow(point, window));
      const count = inside.filter(Boolean).length;
      if (count === 0) return { kind: "unchanged" };
      if (count === inside.length) return wholly();
      return { kind: "reshaped", entity: { ...entity, points: entity.points.map((point, i) => (inside[i] ? shift(point) : point)) } };
    }
    case "CIRCLE":
      return pointInWindow(entity.center, window) ? wholly() : { kind: "unchanged" };
    case "POINT":
      return pointInWindow(entity.position, window) ? wholly() : { kind: "unchanged" };
    case "TEXT":
      return pointInWindow(entity.position, window) ? wholly() : { kind: "unchanged" };
    case "ARC":
    case "ELLIPSE": {
      const bounds = computeAllEntityBounds([entity]);
      if (!boundsTouchWindow(bounds, 0, window)) return { kind: "unchanged" };
      const inside = bounds[0] >= window.min.x && bounds[2] <= window.max.x && bounds[1] >= window.min.y && bounds[3] <= window.max.y;
      return inside ? wholly() : { kind: "partial-skipped" };
    }
  }
}
