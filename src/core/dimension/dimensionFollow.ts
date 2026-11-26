// 連動寸法(Phase 16)の追従の計算: 参照している図形が変わったとき、寸法の測る点を、どう直すか。
// 画面にもファイル形式にも依存しない純粋な処理(図面は書き換えず、新しい寸法を返す)。
//
// 規則(1つの変更の後の状態で、寸法ごと・参照ごとに決める):
//  - 参照した図形が、この変更で置き換えられた → 測る点を、新しい図形の位置に直す(追従)。
//    ただし、この変更で、寸法自身が、その測る点を動かしていて、新しい図形の位置と食い違うときは、
//    寸法の編集を残して、その点の参照を解除する(図形と寸法を、別々の量で動かしたとき。引き戻さない)。
//  - 参照した図形が、この変更で削除された・その位置が無くなった(種類が合わない・頂点の番号が範囲外・
//    頂点の数や閉じ方が変わった折れ線・2本の線が平行になった)→ 参照を「切れた」(broken)にする。測る点は、最後の位置のまま。
//  - 参照した図形が、この変更で変わっていないのに、寸法の測る点が、その図形の位置から外れた
//    (寸法だけを動かした・ストレッチした)→ その点の参照を解除する(図形の見た目は、動かしたとおり)。
//  - すでに切れている参照は、そのまま(自動では直さない。付け直しは DIMREASSOC)。
// 寸法線の位置(position)は、追従では動かさない。
import type { CadDimension, CadEntity, DimensionRef, Point2D } from "../../types/cad";
import { angularFromLines } from "./dimensionConstruct";
import { anchorToleranceAt, isSameAnchorPoint, resolveAnchor } from "./dimensionRefs";

export type ChangedFigure = {
  before: CadEntity | null;
  after: CadEntity | null;
  /** 折れ線の、頂点の数・閉じ方が、この変更の途中のどこかで変わった(頂点の番号が、元の頂点と対応しない) */
  restructured?: boolean;
};

export type FollowContext = {
  /** 変更の後の図面にある図形(削除された図形は undefined) */
  lookup: (id: string) => CadEntity | undefined;
  /** この変更で、置き換えられた(before と after)・削除された(after が null)図形。変わっていなければ undefined */
  changed: (id: string) => ChangedFigure | undefined;
};

export type FollowResult = {
  dimension: CadDimension;
  /** 追従した参照の数 */
  followed: number;
  /** 切れた参照の数(この変更で、新しく切れたもの) */
  broken: number;
  /** 解除した参照の数(寸法だけが動いたため) */
  released: number;
};

type Slot = "p1" | "p2" | "p3";
type Points = Partial<Record<Slot, Point2D>>;

const SLOTS: readonly Slot[] = ["p1", "p2", "p3"];
const samePoint = (a: Point2D | undefined, b: Point2D | undefined): boolean => a === b || (a !== undefined && b !== undefined && a.x === b.x && a.y === b.y);

/** 点の参照(p1・p2・p3)を、点に直す。折れ線は、頂点の数・閉じ方が変わっていたら、頂点の番号がずれるので、直さない(切れた扱い) */
function resolvePointRef(ref: DimensionRef, entity: CadEntity, changed: ChangedFigure | undefined): Point2D | null {
  if (ref.anchor.kind === "vertex" && changed !== undefined) {
    if (changed.restructured === true) return null;
    const before = changed.before;
    if (before !== null && (before.type === "LWPOLYLINE" || before.type === "POLYLINE") && (entity.type === "LWPOLYLINE" || entity.type === "POLYLINE")) {
      if (before.vertices.length !== entity.vertices.length || before.closed !== entity.closed) return null;
    }
  }
  return resolveAnchor(entity, ref.anchor);
}

/** 半径・直径の参照(円・円弧): 中心と、円周上の点(いまの向きのまま、新しい半径へ)。円・円弧でない・半径が正しくないときは null */
function resolveFigureRef(entity: CadEntity, current: CadDimension): Points | null {
  if ((entity.type !== "CIRCLE" && entity.type !== "ARC") || !(entity.radius > 0) || !Number.isFinite(entity.radius)) return null;
  const center = entity.center;
  if (!Number.isFinite(center.x) || !Number.isFinite(center.y)) return null;
  const dx = current.p2.x - current.p1.x;
  const dy = current.p2.y - current.p1.y;
  const length = Math.hypot(dx, dy);
  const ux = length > 0 && Number.isFinite(length) ? dx / length : 1;
  const uy = length > 0 && Number.isFinite(length) ? dy / length : 0;
  const p2 = { x: center.x + ux * entity.radius, y: center.y + uy * entity.radius };
  return Number.isFinite(p2.x) && Number.isFinite(p2.y) ? { p1: { x: center.x, y: center.y }, p2 } : null;
}

/** 測る点が、参照の位置と一致しているか(寸法だけが動いていないか)。非有限の値は、一致としない */
function matchesPoints(current: CadDimension, resolved: Points, scale = 0): boolean {
  for (const slot of SLOTS) {
    const want = resolved[slot];
    if (want === undefined) continue;
    const have = current[slot];
    if (have === undefined) return false;
    if (scale > 0) {
      // 「超えたら不一致」ではなく、「収まったら一致」で書く(NaN は、どの比較も偽なので、一致にならない)
      if (!(Math.hypot(have.x - want.x, have.y - want.y) <= anchorToleranceAt(want) + 1e-9 * scale)) return false;
    } else if (!isSameAnchorPoint(have, want)) return false;
  }
  return true;
}

/**
 * 寸法を、変更の後の状態に合わせて直す。直すものが無ければ null(同じ寸法のまま)。
 * 参照が無い寸法は、null。
 */
export function followDimension(dimension: CadDimension, context: FollowContext): FollowResult | null {
  const refs = dimension.refs;
  if (refs === undefined || refs.length === 0) return null;

  const points: { p1: Point2D; p2: Point2D; p3: Point2D | undefined } = { p1: dimension.p1, p2: dimension.p2, p3: dimension.p3 };
  let followed = 0;
  let broken = 0;
  let released = 0;
  let refsChanged = false;

  /** この変更で、寸法自身が、これらの測る点を動かしたか(寸法の編集があった) */
  const ownBefore = context.changed(dimension.id)?.before ?? null;
  const editedByOwn = (slots: readonly Slot[]): boolean => ownBefore !== null && ownBefore.type === "DIMENSION" && slots.some((slot) => !samePoint(ownBefore[slot], dimension[slot]));
  const keysOf = (resolved: Points): Slot[] => SLOTS.filter((slot) => resolved[slot] !== undefined);
  const assign = (resolved: Points): void => {
    for (const slot of SLOTS) {
      const next = resolved[slot];
      if (next !== undefined) points[slot] = next;
    }
  };

  // ---- 角度の2本の線: 組として、1回だけ決める(参照ごとの結果を、参照をキーにして持つ) ----
  const lineDecision = new Map<DimensionRef, DimensionRef | null>();
  const lineRefs = refs.filter((ref) => ref.slot === "line1" || ref.slot === "line2");
  const first = lineRefs.find((ref) => ref.slot === "line1");
  const second = lineRefs.find((ref) => ref.slot === "line2");
  if (first !== undefined && second !== undefined) {
    const e1 = context.lookup(first.id);
    const e2 = context.lookup(second.id);
    const line1 = e1 !== undefined && e1.type === "LINE" ? e1 : null;
    const line2 = e2 !== undefined && e2.type === "LINE" ? e2 : null;
    const brokenNow = (ref: DimensionRef): DimensionRef => {
      broken++;
      refsChanged = true;
      return { ...ref, broken: true };
    };
    if (first.broken === true || second.broken === true) {
      // 片方がすでに切れている: 点は追従しない。切れていない方が、削除された・線でなくなったときだけ、切れた扱いにする
      lineDecision.set(first, first.broken === true ? first : line1 === null ? brokenNow(first) : first);
      lineDecision.set(second, second.broken === true ? second : line2 === null ? brokenNow(second) : second);
    } else if (line1 === null || line2 === null) {
      // 削除された・線でなくなった図形の参照だけを、切れた扱いにする
      lineDecision.set(first, line1 === null ? brokenNow(first) : first);
      lineDecision.set(second, line2 === null ? brokenNow(second) : second);
    } else {
      const solved = angularFromLines({ start: line1.start, end: line1.end }, { start: line2.start, end: line2.end }, dimension.position);
      const anyChanged = context.changed(first.id) !== undefined || context.changed(second.id) !== undefined;
      if (!solved.ok) {
        // 平行になった・弧の位置が決まらない: 図形が変わったのなら、切れた(変わっていなければ、もともとの状態)
        lineDecision.set(first, anyChanged ? brokenNow(first) : first);
        lineDecision.set(second, anyChanged ? brokenNow(second) : second);
      } else {
        const resolved: Points = { p1: solved.vertex, p2: solved.arm1, p3: solved.arm2 };
        const scale = Math.hypot(solved.arm1.x - solved.vertex.x, solved.arm1.y - solved.vertex.y);
        const matches = matchesPoints(dimension, resolved, scale);
        if (anyChanged && !(editedByOwn(SLOTS) && !matches)) {
          assign(resolved);
          followed += 2;
          lineDecision.set(first, first);
          lineDecision.set(second, second);
        } else if (matches) {
          lineDecision.set(first, first);
          lineDecision.set(second, second);
        } else {
          // 寸法だけが動いた(または、寸法の編集が、図形の位置と食い違う): 2本の線の関連付けを解除する
          released += 2;
          refsChanged = true;
          lineDecision.set(first, null);
          lineDecision.set(second, null);
        }
      }
    }
  }

  const nextRefs: DimensionRef[] = [];
  for (const ref of refs) {
    if (ref.slot === "line1" || ref.slot === "line2") {
      // 組が揃っていない(片方しか無い)ときは、そのまま
      const decided = lineDecision.has(ref) ? lineDecision.get(ref) : ref;
      if (decided !== null && decided !== undefined) nextRefs.push(decided);
      continue;
    }
    if (ref.broken === true) {
      nextRefs.push(ref);
      continue;
    }

    const entity = context.lookup(ref.id);
    const changed = context.changed(ref.id);
    let resolved: Points | null = null;
    let scale = 0;
    if (entity !== undefined) {
      if (ref.slot === "figure") {
        resolved = resolveFigureRef(entity, dimension);
        if (resolved !== null && (entity.type === "CIRCLE" || entity.type === "ARC")) scale = entity.radius;
      } else {
        const at = resolvePointRef(ref, entity, changed);
        if (at !== null) resolved = { [ref.slot]: at };
      }
    }
    if (resolved === null) {
      // 図形が無い・位置が無い: 切れた(測る点は、最後の位置のまま)
      nextRefs.push({ ...ref, broken: true });
      broken++;
      refsChanged = true;
      continue;
    }
    const matches = matchesPoints(dimension, resolved, scale);
    if (changed !== undefined && !(editedByOwn(keysOf(resolved)) && !matches)) {
      // 図形が変わった: 追従する(寸法自身が、その点を、図形と食い違うように動かしたときを除く)
      assign(resolved);
      followed++;
      nextRefs.push(ref);
    } else if (matches) {
      nextRefs.push(ref);
    } else {
      // 図形は変わっていないのに、点が外れた(寸法だけを動かした)・寸法の編集が、図形の位置と食い違う: 解除
      released++;
      refsChanged = true;
    }
  }

  const pointsChanged = !samePoint(points.p1, dimension.p1) || !samePoint(points.p2, dimension.p2) || !samePoint(points.p3, dimension.p3);
  if (!pointsChanged && !refsChanged) return null;
  const { refs: _dropped, ...rest } = dimension;
  void _dropped;
  const next: CadDimension = {
    ...rest,
    p1: points.p1,
    p2: points.p2,
    ...(points.p3 === undefined ? {} : { p3: points.p3 }),
    ...(nextRefs.length > 0 ? { refs: nextRefs } : {}),
  };
  return { dimension: next, followed, broken, released };
}
