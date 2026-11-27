// グリップ(図形を選んだときに出る、つかむ点)の位置と、グリップを動かしたあとの図形の形(Phase 18)。
// 画面にもファイル形式にも依存しない純粋な処理。図形は書き換えず、新しい図形を返す。
//
// 図形ごとのグリップ(index は、図形の中での番号):
//  - LINE: 0 始点・1 終点・2 中点(線ごと動かす)
//  - 折れ線: 0..n-1 各頂点・n.. 各線分の中点(その線分の両端を一緒に動かす。閉じた折れ線は、閉じる線分も)
//  - CIRCLE: 0 中心(動かす)・1〜4 右・上・左・下(半径を変える)
//  - ARC: 0 中心(動かす)・1 始点・2 終点・3 中間点(いずれも、残る2点を通る円弧に直す)
//  - ELLIPSE: 0 中心(動かす)・1 長軸の端(長軸の向きと長さ。短軸との比は保つ)・2 短軸の端(短軸の長さ)
//  - TEXT・POINT: 0 位置(動かす)
//  - DIMENSION: 直線の寸法(水平・垂直・平行)は、測る点(p1・p2)と寸法線の位置。半径・直径・角度は、寸法線の位置だけ
//    (測る点は、円や角の意味が変わるので、動かさない。STRETCH と同じ規則)
//  - SPLINE: グリップなし(点列に近似した形なので、制御点ではない)
import type { Affine2D, CadEntity, Point2D } from "../../types/cad";
import { arcSweep, arcThroughThreePoints, isUsableRadius, normalizeAngle } from "../geometry/construct";
import { dimensionDefiningPoints, layoutDimension } from "../dimension/dimensionGeometry";
import { transformEntityGeometry, translationMatrix } from "../geometry/transform";

export type GripKind = "end" | "vertex" | "mid" | "center" | "quadrant" | "move" | "axis" | "dimension";

export type Grip = {
  /** 図形の中での番号(上の一覧) */
  index: number;
  kind: GripKind;
  point: Point2D;
};

/** グリップを出す図形の上限(これを超える選択では、グリップを出さない) */
export const MAX_GRIP_ENTITIES = 100;
/** 画面に出すグリップの合計の上限(巨大な折れ線などで、描画と当たり判定が重くならないように) */
export const MAX_GRIPS = 2_000;

const isFinitePoint = (p: Point2D): boolean => Number.isFinite(p.x) && Number.isFinite(p.y);

function polylineSegmentCount(vertexCount: number, closed: boolean): number {
  if (vertexCount < 2) return 0;
  return closed ? vertexCount : vertexCount - 1;
}

/** 図形のグリップの数(位置は計算しない。上限の判断に使う) */
export function gripCountOf(entity: CadEntity): number {
  switch (entity.type) {
    case "LINE":
      return 3;
    case "LWPOLYLINE":
    case "POLYLINE":
      return entity.vertices.length + polylineSegmentCount(entity.vertices.length, entity.closed);
    case "CIRCLE":
      return 5;
    case "ARC":
      return 4;
    case "ELLIPSE":
      return 3;
    case "TEXT":
    case "POINT":
      return 1;
    case "DIMENSION":
      return gripsOf(entity).length;
    case "SPLINE":
      return 0;
  }
}

/** 円弧の、始点・中間点・終点 */
function arcPoints(entity: Extract<CadEntity, { type: "ARC" }>): { start: Point2D; mid: Point2D; end: Point2D } {
  const at = (angle: number): Point2D => ({ x: entity.center.x + entity.radius * Math.cos(angle), y: entity.center.y + entity.radius * Math.sin(angle) });
  return { start: at(entity.startAngle), mid: at(entity.startAngle + arcSweep(entity) / 2), end: at(entity.endAngle) };
}

function midOf(a: Point2D, b: Point2D): Point2D {
  return { x: a.x / 2 + b.x / 2, y: a.y / 2 + b.y / 2 };
}

/** 図形のグリップ(位置は図面上の座標)。位置が有限でないものは含めない(index は、欠けても、変わらない) */
export function gripsOf(entity: CadEntity): Grip[] {
  const grips: Grip[] = [];
  const add = (index: number, kind: GripKind, point: Point2D): void => {
    if (isFinitePoint(point)) grips.push({ index, kind, point });
  };
  switch (entity.type) {
    case "LINE":
      add(0, "end", entity.start);
      add(1, "end", entity.end);
      add(2, "mid", midOf(entity.start, entity.end));
      break;
    case "LWPOLYLINE":
    case "POLYLINE": {
      const n = entity.vertices.length;
      entity.vertices.forEach((vertex, i) => add(i, "vertex", vertex));
      const segments = polylineSegmentCount(n, entity.closed);
      for (let k = 0; k < segments; k++) add(n + k, "mid", midOf(entity.vertices[k], entity.vertices[(k + 1) % n]));
      break;
    }
    case "CIRCLE": {
      const { center, radius } = entity;
      add(0, "center", center);
      add(1, "quadrant", { x: center.x + radius, y: center.y });
      add(2, "quadrant", { x: center.x, y: center.y + radius });
      add(3, "quadrant", { x: center.x - radius, y: center.y });
      add(4, "quadrant", { x: center.x, y: center.y - radius });
      break;
    }
    case "ARC": {
      const { start, mid, end } = arcPoints(entity);
      add(0, "center", entity.center);
      add(1, "end", start);
      add(2, "end", end);
      add(3, "mid", mid);
      break;
    }
    case "ELLIPSE": {
      const cos = Math.cos(entity.rotation);
      const sin = Math.sin(entity.rotation);
      add(0, "center", entity.center);
      add(1, "axis", { x: entity.center.x + entity.majorRadius * cos, y: entity.center.y + entity.majorRadius * sin });
      add(2, "axis", { x: entity.center.x - entity.minorRadius * sin, y: entity.center.y + entity.minorRadius * cos });
      break;
    }
    case "TEXT":
    case "POINT":
      add(0, "move", entity.position);
      break;
    case "DIMENSION": {
      const points = dimensionDefiningPoints(entity);
      if (entity.kind === "linear" || entity.kind === "aligned") {
        // 定義点: p1・p2・(p3)・position。直線の寸法は p3 を持たない
        add(0, "dimension", entity.p1);
        add(1, "dimension", entity.p2);
        add(2, "dimension", entity.position);
      } else {
        add(0, "dimension", points[points.length - 1]);
      }
      break;
    }
    case "SPLINE":
      break;
  }
  return grips;
}

/** グリップを動かした結果。matrix があれば、図形ごとの平行移動(取り込んだ図形の元データとの対応は、行列の合成でよい) */
export type GripEdit = { ok: true; entity: CadEntity; matrix?: Affine2D } | { ok: false; error: string };

const fail = (error: string): GripEdit => ({ ok: false, error });

function translated(entity: CadEntity, from: Point2D, to: Point2D): GripEdit {
  const matrix = translationMatrix(to.x - from.x, to.y - from.y);
  if (!matrix.every(Number.isFinite)) return fail("動かす量が大きすぎて、扱えません");
  try {
    return { ok: true, entity: transformEntityGeometry(entity, matrix), matrix };
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

/**
 * グリップ(index)を target へ動かした、新しい図形。動かせない(位置が正しくない・形が作れない)ときは、理由を返す。
 * 元の図形は変えない。
 */
export function applyGrip(entity: CadEntity, index: number, target: Point2D): GripEdit {
  if (!isFinitePoint(target)) return fail("位置が正しくありません");
  const grip = gripsOf(entity).find((g) => g.index === index);
  if (grip === undefined) return fail("そのグリップは、この図形にありません");
  if (grip.point.x === target.x && grip.point.y === target.y) return fail("位置が変わりません");

  switch (entity.type) {
    case "LINE": {
      if (index === 2) return translated(entity, grip.point, target);
      const next = index === 0 ? { ...entity, start: { ...target } } : { ...entity, end: { ...target } };
      if (next.start.x === next.end.x && next.start.y === next.end.y) return fail("始点と終点が同じ位置になります");
      return { ok: true, entity: next };
    }
    case "LWPOLYLINE":
    case "POLYLINE": {
      const n = entity.vertices.length;
      if (index < n) {
        // 頂点が持つほかの値(bulge など)は、そのまま残す
        return { ok: true, entity: { ...entity, vertices: entity.vertices.map((vertex, i) => (i === index ? { ...vertex, x: target.x, y: target.y } : vertex)) } };
      }
      const k = index - n;
      const a = k;
      const b = (k + 1) % n;
      const dx = target.x - grip.point.x;
      const dy = target.y - grip.point.y;
      const vertices = entity.vertices.map((vertex, i) => (i === a || i === b ? { ...vertex, x: vertex.x + dx, y: vertex.y + dy } : vertex));
      if (!vertices.every((v) => Number.isFinite(v.x) && Number.isFinite(v.y))) return fail("動かす量が大きすぎて、扱えません");
      return { ok: true, entity: { ...entity, vertices } };
    }
    case "CIRCLE": {
      if (index === 0) return translated(entity, grip.point, target);
      const radius = Math.hypot(target.x - entity.center.x, target.y - entity.center.y);
      if (!isUsableRadius(radius)) return fail("半径が小さすぎる、または大きすぎます");
      return { ok: true, entity: { ...entity, radius } };
    }
    case "ARC": {
      if (index === 0) return translated(entity, grip.point, target);
      const { start, mid, end } = arcPoints(entity);
      const shape = index === 1 ? arcThroughThreePoints(target, mid, end) : index === 2 ? arcThroughThreePoints(start, mid, target) : arcThroughThreePoints(start, target, end);
      if (shape === null) return fail("その位置では、3点を通る円弧が作れません(一直線上・同じ点・半径が不適)");
      return { ok: true, entity: { ...entity, center: shape.center, radius: shape.radius, startAngle: shape.startAngle, endAngle: shape.endAngle } };
    }
    case "ELLIPSE": {
      if (index === 0) return translated(entity, grip.point, target);
      const vx = target.x - entity.center.x;
      const vy = target.y - entity.center.y;
      if (index === 1) {
        const major = Math.hypot(vx, vy);
        if (!isUsableRadius(major)) return fail("長軸の長さが小さすぎる、または大きすぎます");
        const minor = (entity.minorRadius * major) / entity.majorRadius;
        if (!isUsableRadius(minor)) return fail("短軸の長さが小さすぎる、または大きすぎます");
        return { ok: true, entity: { ...entity, majorRadius: major, minorRadius: minor, rotation: normalizeAngle(Math.atan2(vy, vx)) } };
      }
      // 短軸の向きの成分だけを使う(長軸の向きは変えない)
      const minor = Math.abs(-vx * Math.sin(entity.rotation) + vy * Math.cos(entity.rotation));
      if (!isUsableRadius(minor)) return fail("短軸の長さが小さすぎる、または大きすぎます");
      if (minor > entity.majorRadius) return fail("短軸が、長軸より長くなります");
      return { ok: true, entity: { ...entity, minorRadius: minor } };
    }
    case "TEXT":
    case "POINT":
      return translated(entity, grip.point, target);
    case "DIMENSION": {
      const linear = entity.kind === "linear" || entity.kind === "aligned";
      const next = !linear || index === 2 ? { ...entity, position: { ...target } } : index === 0 ? { ...entity, p1: { ...target } } : { ...entity, p2: { ...target } };
      if (layoutDimension(next) === null) return fail("その位置では、寸法の形を計算できません");
      return { ok: true, entity: next };
    }
    case "SPLINE":
      return fail("スプラインには、グリップがありません");
  }
}
