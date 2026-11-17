// TRIM・EXTEND の幾何(Phase 11)
import { describe, expect, it } from "vitest";
import type { CadEntity, Point2D } from "../../types/cad";
import { intersectSegments } from "./geometry";
import {
  circleIntersectionAngles,
  edgePrimitivesOf,
  extendEntity,
  lineIntersectionParams,
  NO_INTERSECTION_REASON,
  trimEntity,
  trimKeepIntervals,
} from "./trim";
import type { EdgePrimitive } from "./trim";

const base = { layer: "0", color: "#ffffff" };
const line = (x0: number, y0: number, x1: number, y1: number): CadEntity => ({ ...base, id: "t", type: "LINE", start: { x: x0, y: y0 }, end: { x: x1, y: y1 } });
const seg = (x0: number, y0: number, x1: number, y1: number): EdgePrimitive => ({ kind: "segment", a: { x: x0, y: y0 }, b: { x: x1, y: y1 } });
const circleEdge = (cx: number, cy: number, r: number): EdgePrimitive => ({ kind: "circle", center: { x: cx, y: cy }, radius: r });
const arcEdge = (cx: number, cy: number, r: number, s: number, e: number): EdgePrimitive => ({ kind: "circle", center: { x: cx, y: cy }, radius: r, sweep: { startAngle: s, endAngle: e } });
const poly = (vertices: Point2D[], closed = false): CadEntity => ({ ...base, id: "p", type: "LWPOLYLINE", vertices, closed }) as unknown as CadEntity;
const pt = (x: number, y: number): Point2D => ({ x, y });

function pieces(result: ReturnType<typeof trimEntity>): CadEntity[] {
  if (!result.ok) throw new Error(result.reason);
  return result.pieces;
}
const lineEnds = (entity: CadEntity) => {
  const l = entity as unknown as { start: Point2D; end: Point2D };
  return [l.start.x, l.start.y, l.end.x, l.end.y].map((v) => Math.round(v * 1e9) / 1e9);
};

describe("lineIntersectionParams (infinite line vs an edge)", () => {
  it("segment: the position t on the line, only when the edge segment is really crossed", () => {
    // 線 (0,0)→(10,0)、境界 x=4 の縦の線分(y -1〜1)
    expect(lineIntersectionParams(pt(0, 0), pt(10, 0), seg(4, -1, 4, 1))).toEqual([0.4]);
    // 線の延長の上(t > 1)でも、返す
    expect(lineIntersectionParams(pt(0, 0), pt(10, 0), seg(25, -1, 25, 1))).toEqual([2.5]);
    // 境界の線分に届かない
    expect(lineIntersectionParams(pt(0, 0), pt(10, 0), seg(4, 1, 4, 5))).toEqual([]);
    // 平行・重なり
    expect(lineIntersectionParams(pt(0, 0), pt(10, 0), seg(0, 1, 10, 1))).toEqual([]);
    expect(lineIntersectionParams(pt(0, 0), pt(10, 0), seg(2, 0, 8, 0))).toEqual([]);
    // 境界の線分の端の上は、交点
    expect(lineIntersectionParams(pt(0, 0), pt(10, 0), seg(4, 0, 4, 5))).toEqual([0.4]);
    expect(lineIntersectionParams(pt(0, 0), pt(0, 0), seg(4, 0, 4, 5))).toEqual([]); // 長さ0の線
  });

  it("circle: two, one (tangent) and no intersections", () => {
    const two = lineIntersectionParams(pt(-10, 0), pt(10, 0), circleEdge(0, 0, 5)).sort((a, b) => a - b);
    expect(two[0]).toBeCloseTo(0.25, 12);
    expect(two[1]).toBeCloseTo(0.75, 12);
    expect(lineIntersectionParams(pt(-10, 5), pt(10, 5), circleEdge(0, 0, 5))).toHaveLength(1);
    expect(lineIntersectionParams(pt(-10, 6), pt(10, 6), circleEdge(0, 0, 5))).toEqual([]);
  });

  it("arc edge: only the intersections inside the sweep", () => {
    // 上半分の円弧 (0〜π): 横の線 y=0 との交点は (±5,0) = 角度 0 と π(端)。y=3 では、上の交点だけ
    const upper = arcEdge(0, 0, 5, 0, Math.PI);
    expect(lineIntersectionParams(pt(-10, 3), pt(10, 3), upper)).toHaveLength(2);
    expect(lineIntersectionParams(pt(-10, -3), pt(10, -3), upper)).toHaveLength(0);
    expect(lineIntersectionParams(pt(-10, 0), pt(10, 0), upper)).toHaveLength(2); // 端の上
  });
});

describe("circleIntersectionAngles", () => {
  it("segment, circle and arc edges", () => {
    // 円 (0,0) r5 と、縦の線分 x=3(y -10〜10): 交点 (3,±4)
    const angles = circleIntersectionAngles(pt(0, 0), 5, seg(3, -10, 3, 10)).sort((a, b) => a - b);
    expect(angles[0]).toBeCloseTo(-Math.atan2(4, 3), 12);
    expect(angles[1]).toBeCloseTo(Math.atan2(4, 3), 12);
    // 線分が短くて、片方の交点にしか届かない
    expect(circleIntersectionAngles(pt(0, 0), 5, seg(3, 0, 3, 10))).toHaveLength(1);
    // 円どうし
    expect(circleIntersectionAngles(pt(0, 0), 5, circleEdge(6, 0, 5))).toHaveLength(2);
    expect(circleIntersectionAngles(pt(0, 0), 5, circleEdge(20, 0, 5))).toEqual([]);
    // 円弧の境界: 範囲の外の交点は、除く(円 (6,0) r5 の下半分だけ)
    expect(circleIntersectionAngles(pt(0, 0), 5, arcEdge(6, 0, 5, Math.PI, 2 * Math.PI))).toHaveLength(1);
  });
});

describe("trimKeepIntervals", () => {
  it("open path: the part between the intersections around the click is removed", () => {
    expect(trimKeepIntervals([2, 6], 10, false, 4)).toEqual([[0, 2], [6, 10]]);
    expect(trimKeepIntervals([2, 6], 10, false, 1)).toEqual([[2, 10]]); // 手前に交点が無い: 始点から最初の交点 2 まで切り取る
    expect(trimKeepIntervals([2, 6], 10, false, 8)).toEqual([[0, 6]]);
    expect(trimKeepIntervals([5], 10, false, 3)).toEqual([[5, 10]]);
    expect(trimKeepIntervals([5], 10, false, 7)).toEqual([[0, 5]]);
  });

  it("open path: nothing to cut without intersections; an intersection on an end leaves no empty piece", () => {
    expect(trimKeepIntervals([], 10, false, 4)).toBeNull();
    expect(trimKeepIntervals([0, 6], 10, false, 3)).toEqual([[6, 10]]); // 始点の交点: 長さ0の区間は残さない
    expect(trimKeepIntervals([4, 10], 10, false, 7)).toEqual([[0, 4]]);
    expect(trimKeepIntervals([0], 10, false, 3)).toEqual([]); // 全部が切り取られる(図形ごと無くなる)
  });

  it("open path: an intersection exactly at the click belongs to the lower side; duplicates are merged", () => {
    expect(trimKeepIntervals([4, 4, 4 + 1e-12, 8], 10, false, 4)).toEqual([[0, 4], [8, 10]]);
  });

  it("closed path: needs two intersections; one remaining piece, wrapped around", () => {
    const L = 2 * Math.PI;
    expect(trimKeepIntervals([1], L, true, 2)).toBeNull();
    expect(trimKeepIntervals([], L, true, 2)).toBeNull();
    expect(trimKeepIntervals([1, 2], L, true, 1.5)).toEqual([[2, 1 + L]]);
    expect(trimKeepIntervals([1, 2], L, true, 0.5)).toEqual([[1, 2]]);
    expect(trimKeepIntervals([1, 2], L, true, 3)).toEqual([[1 + L, 2 + L]]);
    // length の位置は 0 と同じ点(重なる2つの交点は、1つ): 交点は 0 と 2 の2つ
    expect(trimKeepIntervals([0, L, 2], L, true, 1)).toEqual([[2, L]]);
    // 0 と L だけ(同じ点)では、交点は1つ: 切り取れない
    expect(trimKeepIntervals([0, L], L, true, 1)).toBeNull();
  });
});

describe("trimEntity: LINE", () => {
  const edges = [seg(3, -5, 3, 5), seg(7, -5, 7, 5)];

  it("between two boundaries: two pieces, the clicked part is gone", () => {
    const result = pieces(trimEntity(line(0, 0, 10, 0), pt(5, 0), edges));
    expect(result.map(lineEnds)).toEqual([[0, 0, 3, 0], [7, 0, 10, 0]]);
  });

  it("outside the boundaries: the end part is removed", () => {
    // 始点側の外(x=1)をクリック: 始点から最初の境界(x=3)までが消えて、3 から先が残る
    expect(pieces(trimEntity(line(0, 0, 10, 0), pt(1, 0), edges)).map(lineEnds)).toEqual([[3, 0, 10, 0]]);
    expect(pieces(trimEntity(line(0, 0, 10, 0), pt(9, 0), edges)).map(lineEnds)).toEqual([[0, 0, 7, 0]]);
  });

  it("one boundary: the clicked side goes", () => {
    expect(pieces(trimEntity(line(0, 0, 10, 0), pt(8, 0), [seg(5, -1, 5, 1)])).map(lineEnds)).toEqual([[0, 0, 5, 0]]);
    expect(pieces(trimEntity(line(0, 0, 10, 0), pt(2, 0), [seg(5, -1, 5, 1)])).map(lineEnds)).toEqual([[5, 0, 10, 0]]);
  });

  it("no crossing boundary: refused with the reason; a boundary that does not reach the line does not count", () => {
    const none = trimEntity(line(0, 0, 10, 0), pt(5, 0), [seg(5, 1, 5, 9)]);
    expect(none).toEqual({ ok: false, reason: NO_INTERSECTION_REASON });
    expect(trimEntity(line(0, 0, 10, 0), pt(5, 0), [])).toEqual({ ok: false, reason: NO_INTERSECTION_REASON });
  });

  it("the id, layer and style are kept on the pieces; a boundary through an end leaves no zero-length piece", () => {
    const styled = { ...line(0, 0, 10, 0), lineWeight: 50 } as CadEntity;
    const result = pieces(trimEntity(styled, pt(5, 0), [seg(5, -1, 5, 1)]));
    expect(result[0]).toMatchObject({ id: "t", layer: "0", color: "#ffffff", lineWeight: 50 });
    const atEnd = pieces(trimEntity(line(0, 0, 10, 0), pt(5, 0), [seg(0, -1, 0, 1), seg(10, -1, 10, 1)]));
    expect(atEnd).toEqual([]); // 両端が境界の上で、クリックは間: 全部が切り取られる
  });

  it("a circle boundary and a slanted line", () => {
    const result = pieces(trimEntity(line(-10, 0, 10, 0), pt(0, 0), [circleEdge(0, 0, 5)]));
    expect(result.map(lineEnds)).toEqual([[-10, 0, -5, 0], [5, 0, 10, 0]]);
    const slanted = pieces(trimEntity(line(0, 0, 10, 10), pt(8, 8), [seg(5, 0, 5, 10)]));
    expect(slanted.map(lineEnds)).toEqual([[0, 0, 5, 5]]);
  });
});

describe("trimEntity: polyline", () => {
  it("open: a boundary across the middle segment; the part past it is cut off (vertices are kept in order)", () => {
    const entity = poly([pt(0, 0), pt(10, 0), pt(10, 10), pt(0, 10)]);
    // 縦の境界 x=10 の右でなく、2番目の線分 (10,0)→(10,10) を y=5 で横切る境界
    const result = pieces(trimEntity(entity, pt(5, 10), [seg(8, 5, 12, 5)]));
    const vertices = (result[0] as unknown as { vertices: Point2D[] }).vertices;
    expect(vertices).toEqual([pt(0, 0), pt(10, 0), pt(10, 5)]);
    expect(result).toHaveLength(1);
  });

  it("open: two boundaries around the click make two polylines", () => {
    const entity = poly([pt(0, 0), pt(10, 0), pt(10, 10), pt(20, 10)]);
    const result = pieces(trimEntity(entity, pt(10, 5), [seg(5, -1, 5, 1), seg(15, 9, 15, 11)]));
    expect(result).toHaveLength(2);
    expect((result[0] as unknown as { vertices: Point2D[] }).vertices).toEqual([pt(0, 0), pt(5, 0)]);
    expect((result[1] as unknown as { vertices: Point2D[] }).vertices).toEqual([pt(15, 10), pt(20, 10)]);
  });

  it("closed (a rectangle): two boundaries; the clicked part is removed and the rest is ONE open polyline through the corners", () => {
    const rect = poly([pt(0, 0), pt(10, 0), pt(10, 10), pt(0, 10)], true);
    // 縦の線 x=5 が、下の辺 (y=0) と上の辺 (y=10) を横切る。右半分(x>5)の右の辺をクリックして切り取る
    const result = pieces(trimEntity(rect, pt(10, 5), [seg(5, -1, 5, 11)]));
    expect(result).toHaveLength(1);
    const piece = result[0] as unknown as { vertices: Point2D[]; closed: boolean };
    expect(piece.closed).toBe(false);
    // 残るのは、左半分: (5,10) → (0,10) → (0,0) → (5,0)(上の交点から、左回りに、下の交点まで)
    expect(piece.vertices).toEqual([pt(5, 10), pt(0, 10), pt(0, 0), pt(5, 0)]);
  });

  it("closed with a single intersection cannot be cut", () => {
    const rect = poly([pt(0, 0), pt(10, 0), pt(10, 10), pt(0, 10)], true);
    const result = trimEntity(rect, pt(10, 5), [seg(5, -1, 5, 1)]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("2つ以上");
  });

  it("the extra values of the kept vertices (bulge) stay; new end points have only x and y", () => {
    const entity = poly([{ ...pt(0, 0), bulge: 0.3 } as Point2D, pt(10, 0), pt(20, 0)]);
    const result = pieces(trimEntity(entity, pt(15, 0), [seg(12, -1, 12, 1)]));
    const vertices = (result[0] as unknown as { vertices: Array<Point2D & { bulge?: number }> }).vertices;
    expect(vertices[0].bulge).toBe(0.3);
    expect(vertices[vertices.length - 1]).toEqual(pt(12, 0));
  });
});

describe("trimEntity: ARC and CIRCLE", () => {
  const arc: CadEntity = { ...base, id: "a", type: "ARC", center: pt(0, 0), radius: 10, startAngle: 0, endAngle: Math.PI };
  const angles = (entity: CadEntity) => [(entity as unknown as { startAngle: number }).startAngle, (entity as unknown as { endAngle: number }).endAngle];

  it("an arc cut by one boundary: the clicked side goes", () => {
    // 縦の線 x=0 が、上半分の円弧を、真ん中 (0,10) で切る(角度 π/2)
    const result = pieces(trimEntity(arc, pt(8, 6), [seg(0, 0, 0, 20)]));
    expect(result).toHaveLength(1);
    expect(angles(result[0])[0]).toBeCloseTo(Math.PI / 2, 12);
    expect(angles(result[0])[1]).toBeCloseTo(Math.PI, 12);
    expect(result[0]).toMatchObject({ type: "ARC", id: "a", radius: 10 });
  });

  it("two boundaries: two arcs, the middle is gone", () => {
    const result = pieces(trimEntity(arc, pt(0, 10), [seg(-6, 0, -6, 20), seg(6, 0, 6, 20)]));
    expect(result).toHaveLength(2);
    expect(angles(result[0])[0]).toBeCloseTo(0, 12);
    expect(angles(result[0])[1]).toBeCloseTo(Math.atan2(8, 6), 12);
    expect(angles(result[1])[0]).toBeCloseTo(Math.atan2(8, -6), 12);
    expect(angles(result[1])[1]).toBeCloseTo(Math.PI, 12);
  });

  it("a boundary that crosses only the extension of the arc (outside the sweep) does not count", () => {
    expect(trimEntity(arc, pt(0, 10), [seg(0, -20, 0, -1)])).toEqual({ ok: false, reason: NO_INTERSECTION_REASON });
  });

  it("a circle needs two intersections; the arc that remains goes round the other way from the click", () => {
    const circle: CadEntity = { ...base, id: "c", type: "CIRCLE", center: pt(0, 0), radius: 10 };
    // 縦の線 x=6 が、円を (6,±8) で切る。右側(x>6)をクリック → 右側が消えて、左の大きな円弧が残る
    const result = pieces(trimEntity(circle, pt(10, 0), [seg(6, -20, 6, 20)]));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ type: "ARC", id: "c", radius: 10 });
    const [start, end] = angles(result[0]);
    expect(start).toBeCloseTo(Math.atan2(8, 6), 12); // 上の交点から
    expect(end).toBeCloseTo(Math.atan2(-8, 6) + 2 * Math.PI, 12); // 下の交点(角度 2π − atan2(8,6))まで。0〜2π にそろえた値
    expect(trimEntity(circle, pt(10, 0), [seg(6, 0, 6, 20)])).toMatchObject({ ok: false });
  });
});

describe("extendEntity", () => {
  it("a line is extended along its direction to the nearest boundary, at the end nearer to the click", () => {
    const l = line(0, 0, 10, 0);
    const toEnd = extendEntity(l, pt(9, 0), [seg(15, -5, 15, 5), seg(30, -5, 30, 5)]);
    expect(toEnd.ok && toEnd.pieces.map(lineEnds)).toEqual([[0, 0, 15, 0]]);
    const toStart = extendEntity(l, pt(1, 0), [seg(-4, -5, -4, 5)]);
    expect(toStart.ok && toStart.pieces.map(lineEnds)).toEqual([[-4, 0, 10, 0]]);
  });

  it("the boundary is not extended: a segment the extension misses is not a boundary", () => {
    expect(extendEntity(line(0, 0, 10, 0), pt(9, 0), [seg(15, 1, 15, 5)])).toEqual({ ok: false, reason: "延ばした先に、境界がありません" });
  });

  it("an end already on the boundary, or a boundary behind the end, is not an extension target", () => {
    expect(extendEntity(line(0, 0, 10, 0), pt(9, 0), [seg(10, -5, 10, 5)]).ok).toBe(false);
    expect(extendEntity(line(0, 0, 10, 0), pt(9, 0), [seg(5, -5, 5, 5)]).ok).toBe(false);
  });

  it("a circle boundary", () => {
    const result = extendEntity(line(0, 0, 3, 0), pt(2, 0), [circleEdge(10, 0, 5)]);
    expect(result.ok && result.pieces.map(lineEnds)).toEqual([[0, 0, 5, 0]]);
  });

  it("an arc is extended along its circle to a boundary", () => {
    const arc: CadEntity = { ...base, id: "a", type: "ARC", center: pt(0, 0), radius: 10, startAngle: 0, endAngle: Math.PI / 2 };
    // 終点側(上)を、縦の線 x=-6 まで(角度 atan2(8,-6))
    const result = extendEntity(arc, pt(0, 10), [seg(-6, 0, -6, 20)]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.pieces[0] as unknown as { endAngle: number }).endAngle).toBeCloseTo(Math.atan2(8, -6), 12);
      expect((result.pieces[0] as unknown as { startAngle: number }).startAngle).toBe(0);
    }
    // 始点側(右)を、横の線 y=-6 まで
    const toStart = extendEntity(arc, pt(10, 0), [seg(0, -6, 20, -6)]);
    expect(toStart.ok && (toStart.pieces[0] as unknown as { startAngle: number }).startAngle).toBeCloseTo(2 * Math.PI + Math.atan2(-6, 8), 12);
  });

  it("an open polyline: only the last (or first) segment is extended", () => {
    const entity = poly([pt(0, 0), pt(10, 0), pt(10, 10)]);
    const result = extendEntity(entity, pt(10, 9), [seg(-5, 20, 20, 20)]);
    expect(result.ok && (result.pieces[0] as unknown as { vertices: Point2D[] }).vertices).toEqual([pt(0, 0), pt(10, 0), pt(10, 20)]);
    const first = extendEntity(entity, pt(1, 0), [seg(-5, -5, -5, 5)]);
    expect(first.ok && (first.pieces[0] as unknown as { vertices: Point2D[] }).vertices).toEqual([pt(-5, 0), pt(10, 0), pt(10, 10)]);
  });

  it("circles and closed shapes cannot be extended", () => {
    const circle: CadEntity = { ...base, id: "c", type: "CIRCLE", center: pt(0, 0), radius: 5 };
    expect(extendEntity(circle, pt(5, 0), [seg(9, -9, 9, 9)])).toMatchObject({ ok: false });
    expect(extendEntity(poly([pt(0, 0), pt(1, 0), pt(1, 1)], true), pt(1, 0), [seg(9, -9, 9, 9)])).toMatchObject({ ok: false });
  });
});

describe("edgePrimitivesOf", () => {
  it("lines and polylines become segments, circles and arcs stay exact, text and points have no edges", () => {
    expect(edgePrimitivesOf(line(0, 0, 1, 1))).toEqual([seg(0, 0, 1, 1)]);
    expect(edgePrimitivesOf(poly([pt(0, 0), pt(1, 0), pt(1, 1)], true))).toHaveLength(3);
    expect(edgePrimitivesOf({ ...base, id: "c", type: "CIRCLE", center: pt(0, 0), radius: 3 })).toEqual([circleEdge(0, 0, 3)]);
    expect(edgePrimitivesOf({ ...base, id: "a", type: "ARC", center: pt(0, 0), radius: 3, startAngle: 0, endAngle: 1 })).toEqual([arcEdge(0, 0, 3, 0, 1)]);
    expect(edgePrimitivesOf({ ...base, id: "p", type: "POINT", position: pt(0, 0) })).toEqual([]);
    expect(edgePrimitivesOf({ ...base, id: "t", type: "TEXT", position: pt(0, 0), text: "A", height: 1, rotation: 0, horizontalAlign: "left", verticalAlign: "baseline" })).toEqual([]);
  });
});

describe("random lines: the result matches an independent brute-force check", () => {
  function mulberry32(seed: number): () => number {
    let a = seed;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it("trim: the kept pieces cover exactly the line outside (lower, upper), measured with intersectSegments", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const random = mulberry32(seed);
      const a = pt(random() * 100, random() * 100);
      const b = pt(random() * 100, random() * 100);
      if (Math.hypot(b.x - a.x, b.y - a.y) < 1) continue;
      const edgesList: EdgePrimitive[] = [];
      const ts: number[] = [];
      for (let k = 0; k < 1 + Math.floor(random() * 4); k++) {
        const e1 = pt(random() * 100, random() * 100);
        const e2 = pt(random() * 100, random() * 100);
        edgesList.push({ kind: "segment", a: e1, b: e2 });
        const hit = intersectSegments(a, b, e1, e2);
        if (hit !== null) ts.push(Math.hypot(hit.x - a.x, hit.y - a.y) / Math.hypot(b.x - a.x, b.y - a.y));
      }
      const clickT = random();
      const click = pt(a.x + (b.x - a.x) * clickT, a.y + (b.y - a.y) * clickT);
      const result = trimEntity({ ...base, id: "t", type: "LINE", start: a, end: b }, click, edgesList);
      if (ts.length === 0) {
        expect(result.ok, `seed ${seed}`).toBe(false);
        continue;
      }
      expect(result.ok, `seed ${seed}`).toBe(true);
      if (!result.ok) continue;
      const lower = Math.max(0, ...ts.filter((t) => t <= clickT));
      const hasLower = ts.some((t) => t <= clickT);
      const upper = Math.min(1, ...ts.filter((t) => t > clickT));
      const hasUpper = ts.some((t) => t > clickT);
      // 残る区間(長さが 1e-9 を超えるもの)
      const expected: Array<[number, number]> = [];
      if (hasLower && lower > 1e-9) expected.push([0, lower]);
      if (hasUpper && upper < 1 - 1e-9) expected.push([upper, 1]);
      const got = result.pieces.map((piece) => {
        const l = piece as unknown as { start: Point2D; end: Point2D };
        const length = Math.hypot(b.x - a.x, b.y - a.y);
        return [Math.hypot(l.start.x - a.x, l.start.y - a.y) / length, Math.hypot(l.end.x - a.x, l.end.y - a.y) / length] as [number, number];
      });
      expect(got.length, `seed ${seed}`).toBe(expected.length);
      got.forEach((interval, i) => {
        expect(interval[0], `seed ${seed}`).toBeCloseTo(expected[i][0], 6);
        expect(interval[1], `seed ${seed}`).toBeCloseTo(expected[i][1], 6);
      });
      // 切り取られた所(クリックの位置)は、どの残った図形にも入っていない
      for (const [from, to] of got) expect(clickT < from - 1e-9 || clickT > to + 1e-9, `seed ${seed}: the click is inside a kept piece`).toBe(true);
    }
  });
});

describe("exact coordinates for the ordinary (axis-aligned) cases", () => {
  it("a vertical boundary cuts a horizontal line at exactly its x; the points are not recomputed from a ratio (30 stays 30)", () => {
    const result = pieces(trimEntity(line(0, 0, 100, 0), pt(50, 0), [seg(30, -50, 30, 50), seg(70, -50, 70, 50)]));
    expect(result.map((piece) => (piece as unknown as { start: Point2D; end: Point2D }))).toEqual([
      { ...(result[0] as object), start: pt(0, 0), end: pt(30, 0) },
      { ...(result[1] as object), start: pt(70, 0), end: pt(100, 0) },
    ]);
  });

  it("a horizontal boundary and a vertical line: y is exact; an offset origin and decimals do not add rounding noise", () => {
    const result = pieces(trimEntity(line(12.3, 0.1, 12.3, 90.7), pt(12.3, 80), [seg(0, 45.9, 50, 45.9)]));
    const l = result[0] as unknown as { start: Point2D; end: Point2D };
    expect(l.start).toEqual(pt(12.3, 0.1));
    expect(l.end).toEqual(pt(12.3, 45.9));
  });

  it("the extended end lands exactly on an axis-aligned boundary", () => {
    const result = extendEntity(line(0.1, 0.3, 0.7, 0.3), pt(0.7, 0.3), [seg(1.9, -5, 1.9, 5)]);
    expect(result.ok && (result.pieces[0] as unknown as { end: Point2D }).end).toEqual(pt(1.9, 0.3));
  });

  it("the end of a polyline piece sits on the intersection point exactly", () => {
    const entity = poly([pt(0, 0), pt(10, 0), pt(10, 10)]);
    const result = pieces(trimEntity(entity, pt(10, 9), [seg(8, 3.3, 12, 3.3)]));
    const vertices = (result[0] as unknown as { vertices: Point2D[] }).vertices;
    expect(vertices[vertices.length - 1]).toEqual(pt(10, 3.3));
  });
});

describe("extending an arc: only boundaries in the extension zone count", () => {
  const arc: CadEntity = { ...base, id: "a", type: "ARC", center: pt(0, 0), radius: 10, startAngle: 0, endAngle: Math.PI / 2 };

  it("a boundary that crosses the arc itself (inside its sweep) is not an extension target", () => {
    // 中心から斜めに出る線分 (0,0)-(20,20) は、円弧を 45度 (円弧の内側) の1か所だけで切る。延ばす先(範囲の外)に、境界は無い
    const result = extendEntity(arc, pt(0, 10), [seg(0, 0, 20, 20)]);
    expect(result).toEqual({ ok: false, reason: "延ばした先に、境界がありません" });
    expect(extendEntity(arc, pt(10, 0), [seg(0, 0, 20, 20)])).toMatchObject({ ok: false });
  });

  it("with both a crossing inside the arc and a boundary beyond the end, the one beyond is used", () => {
    const result = extendEntity(arc, pt(0, 10), [seg(0, 0, 20, 20), seg(-6, 0, -6, 20)]);
    expect(result.ok && (result.pieces[0] as unknown as { endAngle: number }).endAngle).toBeCloseTo(Math.atan2(8, -6), 12);
  });
});
