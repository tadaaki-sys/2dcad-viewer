// 連動寸法の追従の規則(Phase 16): 図形が変わる・削除される・寸法だけが動く、のそれぞれで、寸法をどう直すか
import { describe, expect, it } from "vitest";
import type { CadDimension, CadDimensionValues, CadEntity, DimensionRef, Point2D } from "../../types/cad";
import { followDimension } from "./dimensionFollow";
import type { ChangedFigure, FollowContext } from "./dimensionFollow";

const pt = (x: number, y: number): Point2D => ({ x, y });
const base = { layer: "0", color: "#fff" };
const VALUES: CadDimensionValues = { textHeight: 100, arrowSize: 100, decimals: 0, angleDecimals: 1, unit: "mm", showUnit: false, extensionOffset: 50 };
const line = (id: string, a: Point2D, b: Point2D): CadEntity => ({ ...base, id, type: "LINE", start: a, end: b });
const circle = (id: string, c: Point2D, r: number): CadEntity => ({ ...base, id, type: "CIRCLE", center: c, radius: r });
const poly = (id: string, vertices: Point2D[]): CadEntity => ({ ...base, id, type: "LWPOLYLINE", vertices, closed: false });

const dimension = (patch: Partial<CadDimension> & Pick<CadDimension, "kind" | "p1" | "p2" | "position">): CadDimension => ({ ...base, id: "d", type: "DIMENSION", values: VALUES, ...patch });

/** 変更の後の図面(entities)と、この変更で変わった図形(changed: id → before・after)から、追従の文脈を作る */
function context(entities: readonly CadEntity[], changed: Record<string, ChangedFigure> = {}): FollowContext {
  return { lookup: (id) => entities.find((e) => e.id === id), changed: (id) => changed[id] };
}
/** 図形 before を after に変えた、という変更 */
const edited = (before: CadEntity, after: CadEntity): Record<string, ChangedFigure> => ({ [before.id]: { before, after } });
const deleted = (before: CadEntity): Record<string, ChangedFigure> => ({ [before.id]: { before, after: null } });

const REFS_LINEAR: DimensionRef[] = [
  { slot: "p1", id: "a", anchor: { kind: "start" } },
  { slot: "p2", id: "b", anchor: { kind: "end" } },
];
const A = line("a", pt(0, 0), pt(0, 100));
const B = line("b", pt(0, 0), pt(1000, 0));
const linear = (): CadDimension => dimension({ kind: "linear", rotation: 0, p1: pt(0, 0), p2: pt(1000, 0), position: pt(500, 300), refs: REFS_LINEAR });

describe("a referenced figure is edited: the measuring point follows", () => {
  it("moves only the measured point; the dimension line position and the style stay", () => {
    const d = linear();
    const movedB = line("b", pt(0, 0), pt(1500, 0));
    const result = followDimension(d, context([A, movedB], edited(B, movedB)));
    expect(result).not.toBeNull();
    expect(result!.dimension.p1).toEqual(pt(0, 0));
    expect(result!.dimension.p2).toEqual(pt(1500, 0));
    expect(result!.dimension.position).toBe(d.position);
    expect(result!.dimension.values).toBe(d.values);
    expect(result!.dimension.refs).toEqual(REFS_LINEAR);
    expect(result).toMatchObject({ followed: 1, broken: 0, released: 0 });
    // 元の寸法は変わらない
    expect(d.p2).toEqual(pt(1000, 0));
  });

  it("both ends follow when both figures change; a mid anchor follows the middle", () => {
    const d = dimension({ kind: "aligned", p1: pt(0, 50), p2: pt(10, 50), position: pt(5, 99), refs: [{ slot: "p1", id: "m", anchor: { kind: "mid" } }, { slot: "p2", id: "n", anchor: { kind: "end" } }] });
    const m = line("m", pt(0, 0), pt(0, 100));
    const m2 = line("m", pt(0, 0), pt(0, 200));
    const n = line("n", pt(10, 0), pt(10, 50));
    const n2 = line("n", pt(10, 0), pt(10, 80));
    const result = followDimension(d, context([m2, n2], { ...edited(m, m2), ...edited(n, n2) }));
    expect(result!.dimension.p1).toEqual(pt(0, 100));
    expect(result!.dimension.p2).toEqual(pt(10, 80));
    expect(result!.followed).toBe(2);
  });

  it("nothing to do (null) when the edited figure keeps the anchor where it was, when there are no refs, and when the dimension is consistent", () => {
    const d = linear();
    const rotatedAround = line("b", pt(0, 0), pt(1000, 0));
    expect(followDimension(d, context([A, rotatedAround], edited(B, line("b", pt(-5, 3), pt(1000, 0)))))).toBeNull();
    expect(followDimension(dimension({ kind: "linear", rotation: 0, p1: pt(0, 0), p2: pt(5, 0), position: pt(1, 1) }), context([]))).toBeNull();
    expect(followDimension(dimension({ kind: "linear", rotation: 0, p1: pt(0, 0), p2: pt(5, 0), position: pt(1, 1), refs: [] }), context([]))).toBeNull();
    expect(followDimension(d, context([A, B]))).toBeNull();
  });
});

describe("a referenced figure is deleted or loses the position: the reference is broken", () => {
  it("a deleted figure breaks the reference; the measuring point stays; the other reference keeps working", () => {
    const d = linear();
    const result = followDimension(d, context([A], deleted(B)));
    expect(result!.dimension.p2).toEqual(pt(1000, 0));
    expect(result!.dimension.refs).toEqual([REFS_LINEAR[0], { ...REFS_LINEAR[1], broken: true }]);
    expect(result).toMatchObject({ broken: 1, followed: 0 });
  });

  it("a broken reference stays broken and is not counted again (it is repaired only by DIMREASSOC)", () => {
    const d = { ...linear(), refs: [REFS_LINEAR[0], { ...REFS_LINEAR[1], broken: true as const }] };
    // 切れている参照の図形が、また現れても、自動では直さない
    expect(followDimension(d, context([A, line("b", pt(0, 0), pt(7, 7))], edited(B, line("b", pt(0, 0), pt(7, 7)))))).toBeNull();
    expect(followDimension(d, context([], deleted(A)))!.dimension.refs).toEqual([{ ...REFS_LINEAR[0], broken: true }, { ...REFS_LINEAR[1], broken: true }]);
  });

  it("a polyline vertex follows when the vertex count is kept, and breaks when the count changes (the number would point at another vertex)", () => {
    const p = poly("p", [pt(0, 0), pt(100, 0), pt(100, 50)]);
    const d = dimension({ kind: "linear", rotation: 0, p1: pt(0, 0), p2: pt(100, 50), position: pt(50, 99), refs: [{ slot: "p1", id: "p", anchor: { kind: "vertex", index: 0 } }, { slot: "p2", id: "p", anchor: { kind: "vertex", index: 2 } }] });
    const stretched = poly("p", [pt(0, 0), pt(100, 0), pt(100, 80)]);
    const kept = followDimension(d, context([stretched], edited(p, stretched)));
    expect(kept!.dimension.p2).toEqual(pt(100, 80));
    expect(kept!.dimension.refs).toEqual(d.refs);
    const rounded = poly("p", [pt(0, 0), pt(90, 0), pt(98, 2), pt(100, 10), pt(100, 50)]);
    const broken = followDimension(d, context([rounded], edited(p, rounded)));
    expect(broken!.dimension.refs).toEqual([{ ...d.refs![0], broken: true }, { ...d.refs![1], broken: true }]);
    expect(broken!.dimension.p1).toEqual(pt(0, 0));
    expect(broken!.dimension.p2).toEqual(pt(100, 50));
    expect(broken!.broken).toBe(2);
  });

  it("a vertex index out of range, and a figure whose kind lost the position (circle → no start), break the reference", () => {
    const short = poly("p", [pt(0, 0), pt(100, 0)]);
    const d = dimension({ kind: "linear", rotation: 0, p1: pt(0, 0), p2: pt(100, 50), position: pt(50, 99), refs: [{ slot: "p2", id: "p", anchor: { kind: "vertex", index: 5 } }] });
    expect(followDimension(d, context([short], edited(short, short)))!.dimension.refs).toEqual([{ ...d.refs![0], broken: true }]);
    const c = circle("c", pt(0, 0), 5);
    const d2 = dimension({ kind: "aligned", p1: pt(0, 0), p2: pt(9, 9), position: pt(1, 1), refs: [{ slot: "p1", id: "c", anchor: { kind: "start" } }] });
    expect(followDimension(d2, context([c], edited(c, c)))!.dimension.refs![0].broken).toBe(true);
  });

  it("a reference to a figure that was replaced by a figure of another kind that still has the anchor keeps following (arc → center)", () => {
    const c = circle("c", pt(10, 10), 5);
    const arc: CadEntity = { ...base, id: "c", type: "ARC", center: pt(10, 10), radius: 5, startAngle: 0, endAngle: 1 };
    const d = dimension({ kind: "aligned", p1: pt(10, 10), p2: pt(50, 10), position: pt(30, 40), refs: [{ slot: "p1", id: "c", anchor: { kind: "center" } }] });
    expect(followDimension(d, context([arc], edited(c, arc)))).toBeNull();
    const moved: CadEntity = { ...arc, center: pt(20, 20) };
    expect(followDimension(d, context([moved], edited(c, moved)))!.dimension.p1).toEqual(pt(20, 20));
  });
});

describe("the dimension itself is edited while the figures stay: the points that moved are released", () => {
  it("moved alone: both references are released and the points stay where they were moved", () => {
    const moved = { ...linear(), p1: pt(0, 40), p2: pt(1000, 40), position: pt(500, 340) };
    const result = followDimension(moved, context([A, B]));
    expect(result!.dimension.p1).toEqual(pt(0, 40));
    expect(result!.dimension.refs).toBeUndefined();
    expect("refs" in result!.dimension).toBe(false);
    expect(result).toMatchObject({ released: 2, followed: 0, broken: 0 });
  });

  it("stretched at one end: only that reference is released", () => {
    const stretched = { ...linear(), p2: pt(1200, 0) };
    const result = followDimension(stretched, context([A, B]));
    expect(result!.dimension.refs).toEqual([REFS_LINEAR[0]]);
    expect(result!.released).toBe(1);
  });

  it("only the dimension line position moved: nothing is released (the measuring points did not move)", () => {
    expect(followDimension({ ...linear(), position: pt(500, 900) }, context([A, B]))).toBeNull();
  });

  it("the dimension and its figures move together: the points follow the figures (same result), refs kept", () => {
    const aMoved = line("a", pt(10, 10), pt(10, 110));
    const bMoved = line("b", pt(10, 10), pt(1010, 10));
    const together = { ...linear(), p1: pt(10, 10), p2: pt(1010, 10), position: pt(510, 310) };
    const result = followDimension(together, context([aMoved, bMoved], { ...edited(A, aMoved), ...edited(B, bMoved) }));
    // 寸法の点は、すでに図形の位置に一致している(動かした分だけ)。追従しても、同じ位置
    expect(result === null || (result.dimension.p1.x === 10 && result.dimension.p2.x === 1010 && result.dimension.refs !== undefined)).toBe(true);
  });
});

describe("radius / diameter: the reference is the circle itself", () => {
  const c = circle("c", pt(1000, 1000), 250);
  const radius = (): CadDimension => dimension({ kind: "radius", p1: pt(1000, 1000), p2: pt(1250, 1000), position: pt(1500, 1000), refs: [{ slot: "figure", id: "c", anchor: { kind: "whole" } }] });

  it("follows the center and the radius, keeping the direction of the picked point", () => {
    const bigger = circle("c", pt(1100, 900), 400);
    const result = followDimension(radius(), context([bigger], edited(c, bigger)));
    expect(result!.dimension.p1).toEqual(pt(1100, 900));
    expect(result!.dimension.p2.x).toBeCloseTo(1500, 9);
    expect(result!.dimension.p2.y).toBeCloseTo(900, 9);
    expect(result!.dimension.position).toEqual(pt(1500, 1000));
    // 向きが斜めでも、向きを保つ
    const slanted = dimension({ kind: "diameter", p1: pt(0, 0), p2: pt(30, 40), position: pt(100, 100), refs: [{ slot: "figure", id: "c", anchor: { kind: "whole" } }] });
    const small = circle("c", pt(0, 0), 10);
    const r2 = followDimension(slanted, context([small], edited(c, small)));
    expect(r2!.dimension.p2.x).toBeCloseTo(6, 9);
    expect(r2!.dimension.p2.y).toBeCloseTo(8, 9);
  });

  it("is consistent when nothing changed; a deleted circle, or a figure that is no longer a circle, breaks it; the dimension alone moved releases it", () => {
    expect(followDimension(radius(), context([c]))).toBeNull();
    expect(followDimension(radius(), context([], deleted(c)))!.dimension.refs![0].broken).toBe(true);
    const asLine = line("c", pt(0, 0), pt(1, 1));
    expect(followDimension(radius(), context([asLine], edited(c, asLine)))!.dimension.refs![0].broken).toBe(true);
    const moved = { ...radius(), p1: pt(1010, 1000), p2: pt(1260, 1000) };
    expect(followDimension(moved, context([c]))!.released).toBe(1);
    // 半径だけが違う(寸法の半径が図形と合わない)ときも、外れたとみなす
    expect(followDimension({ ...radius(), p2: pt(1300, 1000) }, context([c]))!.released).toBe(1);
  });

  it("a zero or non-finite radius cannot be followed: the reference breaks", () => {
    const zero = circle("c", pt(0, 0), 0);
    expect(followDimension(radius(), context([zero], edited(c, zero)))!.dimension.refs![0].broken).toBe(true);
  });
});

describe("angular dimension by two lines", () => {
  const l1 = line("l1", pt(0, 0), pt(1000, 0));
  const l2 = line("l2", pt(0, 0), pt(0, 1000));
  const angular = (): CadDimension =>
    dimension({
      kind: "angular",
      p1: pt(0, 0),
      p2: pt(1000, 0),
      p3: pt(0, 1000),
      position: pt(700, 700),
      refs: [{ slot: "line1", id: "l1", anchor: { kind: "whole" } }, { slot: "line2", id: "l2", anchor: { kind: "whole" } }],
    });

  it("a line moves: the vertex and the arms are found again from the lines and the arc position", () => {
    const moved = line("l2", pt(200, -300), pt(200, 1000));
    const result = followDimension(angular(), context([l1, moved], edited(l2, moved)));
    expect(result!.dimension.p1.x).toBeCloseTo(200, 9);
    expect(result!.dimension.p1.y).toBeCloseTo(0, 9);
    expect(result!.dimension.p2.x).toBeCloseTo(1000, 9);
    expect(result!.dimension.p3!.y).toBeCloseTo(1000, 9);
    expect(result!.dimension.position).toEqual(pt(700, 700));
    expect(result!.followed).toBe(2);
  });

  it("lines that become parallel break both references; the points stay", () => {
    const parallel = line("l2", pt(0, 300), pt(1000, 300));
    const result = followDimension(angular(), context([l1, parallel], edited(l2, parallel)));
    expect(result!.dimension.refs!.every((r) => r.broken === true)).toBe(true);
    expect(result!.dimension.p1).toEqual(pt(0, 0));
    expect(result!.broken).toBe(2);
  });

  it("a deleted line, or a line that is no longer a line, breaks only that reference", () => {
    const gone = followDimension(angular(), context([l1], deleted(l2)));
    expect(gone!.dimension.refs).toEqual([angular().refs![0], { ...angular().refs![1], broken: true }]);
    expect(gone!.broken).toBe(1);
    const asCircle = circle("l2", pt(0, 0), 5);
    expect(followDimension(angular(), context([l1, asCircle], edited(l2, asCircle)))!.dimension.refs![1].broken).toBe(true);
  });

  it("consistent when nothing changed; released when the dimension alone moved", () => {
    expect(followDimension(angular(), context([l1, l2]))).toBeNull();
    const moved = { ...angular(), p1: pt(5, 5), p2: pt(1005, 5), p3: pt(5, 1005) };
    const result = followDimension(moved, context([l1, l2]));
    expect(result!.dimension.refs).toBeUndefined();
    expect(result!.released).toBe(2);
  });
});

describe("angular dimension by three points", () => {
  it("each of the three points follows its own figure", () => {
    const v = line("v", pt(0, 0), pt(500, 500));
    const a1 = line("a1", pt(0, 0), pt(1000, 0));
    const a2 = line("a2", pt(0, 0), pt(0, 1000));
    const d = dimension({
      kind: "angular",
      p1: pt(0, 0),
      p2: pt(1000, 0),
      p3: pt(0, 1000),
      position: pt(700, 700),
      refs: [{ slot: "p1", id: "v", anchor: { kind: "start" } }, { slot: "p2", id: "a1", anchor: { kind: "end" } }, { slot: "p3", id: "a2", anchor: { kind: "end" } }],
    });
    const a2Moved = line("a2", pt(0, 0), pt(0, 2000));
    const result = followDimension(d, context([v, a1, a2Moved], edited(a2, a2Moved)));
    expect(result!.dimension.p3).toEqual(pt(0, 2000));
    expect(result!.dimension.p1).toEqual(pt(0, 0));
    expect(result!.dimension.p2).toEqual(pt(1000, 0));
  });
});

describe("Codex review fixes (Phase 16)", () => {
  it("the dimension and its figure moved by DIFFERENT amounts in one change: the dimension's own edit is kept and the moved point is released", () => {
    const d = linear();
    const movedA = line("a", pt(10, 0), pt(10, 100));
    // 寸法の p1 は、(0,0) から (20,0) へ。図形の始点は、(10,0) へ(食い違う)
    const dimensionAfter = { ...d, p1: pt(20, 0) };
    const own = { before: d, after: dimensionAfter } as ChangedFigure;
    const ctx = { lookup: (id: string) => ({ a: movedA, b: B } as Record<string, CadEntity>)[id], changed: (id: string) => ({ a: { before: A, after: movedA }, d: own } as Record<string, ChangedFigure>)[id] };
    const result = followDimension(dimensionAfter, ctx);
    expect(result!.dimension.p1).toEqual(pt(20, 0));
    expect(result!.dimension.refs).toEqual([REFS_LINEAR[1]]);
    expect(result!.released).toBe(1);
  });

  it("the dimension was edited in the same change but NOT at the measuring point (only its line position): the point still follows the figure", () => {
    const d = linear();
    const movedA = line("a", pt(10, 0), pt(10, 100));
    const dimensionAfter = { ...d, position: pt(500, 900) };
    const own = { before: d, after: dimensionAfter } as ChangedFigure;
    const ctx = { lookup: (id: string) => ({ a: movedA, b: B } as Record<string, CadEntity>)[id], changed: (id: string) => ({ a: { before: A, after: movedA }, d: own } as Record<string, ChangedFigure>)[id] };
    const result = followDimension(dimensionAfter, ctx);
    expect(result!.dimension.p1).toEqual(pt(10, 0));
    expect(result!.dimension.refs).toEqual(REFS_LINEAR);
    expect(result!.dimension.position).toEqual(pt(500, 900));
  });

  const L1 = line("l1", pt(0, 0), pt(1000, 0));
  const L2 = line("l2", pt(0, 0), pt(0, 1000));
  const refsOf = (broken1: boolean, broken2: boolean): DimensionRef[] => [
    { slot: "line1", id: "l1", anchor: { kind: "whole" }, ...(broken1 ? { broken: true as const } : {}) },
    { slot: "line2", id: "l2", anchor: { kind: "whole" }, ...(broken2 ? { broken: true as const } : {}) },
  ];
  const angularWith = (refs: DimensionRef[]): CadDimension => dimension({ kind: "angular", p1: pt(0, 0), p2: pt(1000, 0), p3: pt(0, 1000), position: pt(700, 700), refs });

  it("two-line angular dimension with ONE broken reference: no duplicated reference; the live line, if deleted, is broken too (in either order)", () => {
    const first = followDimension(angularWith(refsOf(true, false)), context([], deleted(L2)));
    expect(first!.dimension.refs).toEqual(refsOf(true, true));
    const second = followDimension(angularWith(refsOf(false, true)), context([], deleted(L1)));
    expect(second!.dimension.refs).toEqual(refsOf(true, true));
    expect(first!.broken).toBe(1);
  });

  it("two-line angular dimension with one broken reference and the live line untouched or edited: the references stay as they are (once each)", () => {
    expect(followDimension(angularWith(refsOf(true, false)), context([L1, L2]))).toBeNull();
    const moved = line("l2", pt(5, 5), pt(5, 900));
    expect(followDimension(angularWith(refsOf(true, false)), context([L1, moved], edited(L2, moved)))).toBeNull();
    expect(followDimension(angularWith(refsOf(false, true)), context([L1, L2]))).toBeNull();
  });

  it("a live line that is no longer a line breaks even when the other reference was already broken", () => {
    const asCircle = circle("l2", pt(0, 0), 5);
    const result = followDimension(angularWith(refsOf(true, false)), context([asCircle], edited(L2, asCircle)));
    expect(result!.dimension.refs).toEqual(refsOf(true, true));
  });

  it("two-line angular dimension: a line moved and the dimension's own points edited to somewhere else in the same change: the dimension's edit is kept and both references are released", () => {
    const d = angularWith(refsOf(false, false));
    const moved = line("l2", pt(200, -300), pt(200, 1000));
    const edited2 = { ...d, p1: pt(40, 40), p2: pt(1040, 40), p3: pt(40, 1040) };
    const own = { before: d, after: edited2 } as ChangedFigure;
    const ctx = { lookup: (id: string) => ({ l1: L1, l2: moved } as Record<string, CadEntity>)[id], changed: (id: string) => ({ l2: { before: L2, after: moved }, d: own } as Record<string, ChangedFigure>)[id] };
    const result = followDimension(edited2, ctx);
    expect(result!.dimension.p1).toEqual(pt(40, 40));
    expect(result!.dimension.refs).toBeUndefined();
    expect(result!.released).toBe(2);
    // 寸法の編集が、図形の動きと一致している(同じ位置)なら、追従して、参照は残る
    const aligned = followDimension(d, { lookup: ctx.lookup, changed: (id: string) => ({ l2: { before: L2, after: moved } } as Record<string, ChangedFigure>)[id] });
    expect(aligned!.dimension.refs).toEqual(refsOf(false, false));
  });

  it("a polyline whose closed flag changed (same vertex count) breaks the vertex reference even without the restructured mark", () => {
    const closed: CadEntity = { ...base, id: "p", type: "LWPOLYLINE", vertices: [pt(0, 0), pt(100, 0), pt(100, 50)], closed: true };
    const opened: CadEntity = { ...closed, closed: false } as CadEntity;
    const d = dimension({ kind: "aligned", p1: pt(100, 0), p2: pt(5, 5), position: pt(50, 99), refs: [{ slot: "p1", id: "p", anchor: { kind: "vertex", index: 1 } }] });
    expect(followDimension(d, { lookup: () => opened, changed: () => ({ before: closed, after: opened }) })!.dimension.refs![0].broken).toBe(true);
  });
  it("a non-finite measuring point is never taken as matching the circle (the reference is released, not kept)", () => {
    const c = circle("c", pt(1000, 1000), 250);
    const nan = dimension({ kind: "radius", p1: pt(Number.NaN, Number.NaN), p2: pt(1250, 1000), position: pt(1500, 1000), refs: [{ slot: "figure", id: "c", anchor: { kind: "whole" } }] });
    expect(followDimension(nan, context([c]))!.released).toBe(1);
  });

  it("a polyline marked as restructured in the change (vertex count or closed flag changed in some step) breaks vertex references even if the end state looks alike", () => {
    const p = poly("p", [pt(0, 0), pt(100, 0), pt(100, 50)]);
    const d = dimension({ kind: "aligned", p1: pt(100, 0), p2: pt(5, 5), position: pt(50, 99), refs: [{ slot: "p1", id: "p", anchor: { kind: "vertex", index: 1 } }] });
    const shifted = poly("p", [pt(-10, 0), pt(0, 0), pt(100, 0)]);
    const result = followDimension(d, { lookup: () => shifted, changed: () => ({ before: p, after: shifted, restructured: true }) });
    expect(result!.dimension.refs![0].broken).toBe(true);
    expect(result!.dimension.p1).toEqual(pt(100, 0));
    // 同じ位置のままなら、印がなければ追従する
    const plain = followDimension(d, { lookup: () => shifted, changed: () => ({ before: p, after: shifted }) });
    expect(plain!.dimension.p1).toEqual(pt(0, 0));
  });
});