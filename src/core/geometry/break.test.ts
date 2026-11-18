// BREAK の幾何(Phase 12)
import { describe, expect, it } from "vitest";
import type { CadArc, CadEntity, CadPolyline, Point2D } from "../../types/cad";
import { breakEntity, BREAK_AT_CENTER_REASON, BREAK_NOTHING_REASON, BREAK_SAME_POINT_ON_CIRCLE_REASON, BREAK_UNCOMPUTABLE_REASON } from "./break";

const base = { layer: "L1", color: "#ff0000" };
const pt = (x: number, y: number): Point2D => ({ x, y });
const line = (x0: number, y0: number, x1: number, y1: number): CadEntity => ({ ...base, id: "t", type: "LINE", start: pt(x0, y0), end: pt(x1, y1) });
const poly = (vertices: Point2D[], closed = false): CadEntity => ({ ...base, id: "p", type: "LWPOLYLINE", vertices, closed }) as CadEntity;
const circle = (cx: number, cy: number, r: number): CadEntity => ({ ...base, id: "c", type: "CIRCLE", center: pt(cx, cy), radius: r });
const arc = (cx: number, cy: number, r: number, s: number, e: number): CadEntity => ({ ...base, id: "a", type: "ARC", center: pt(cx, cy), radius: r, startAngle: s, endAngle: e });

function pieces(result: ReturnType<typeof breakEntity>): CadEntity[] {
  if (!result.ok) throw new Error(result.reason);
  return result.pieces;
}
const ends = (entity: CadEntity): number[] => {
  const l = entity as unknown as { start: Point2D; end: Point2D };
  return [l.start.x, l.start.y, l.end.x, l.end.y];
};
const vertices = (entity: CadEntity): Array<[number, number]> => (entity as CadPolyline).vertices.map((v) => [v.x, v.y]);
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

describe("breakEntity: line", () => {
  it("removes the part between two points, keeping the two ends; axis-aligned coordinates are exact", () => {
    const result = pieces(breakEntity(line(0, 0, 100, 0), pt(30, 0), pt(60, 0)));
    expect(result).toHaveLength(2);
    expect(ends(result[0])).toEqual([0, 0, 30, 0]);
    expect(ends(result[1])).toEqual([60, 0, 100, 0]);
    // 属性は引き継ぐ
    expect(result[0]).toMatchObject({ type: "LINE", layer: "L1", color: "#ff0000" });
  });

  it("the order of the two points does not matter for an open line", () => {
    const a = pieces(breakEntity(line(0, 0, 100, 0), pt(60, 0), pt(30, 0)));
    expect(ends(a[0])).toEqual([0, 0, 30, 0]);
    expect(ends(a[1])).toEqual([60, 0, 100, 0]);
  });

  it("points off the line are projected onto it", () => {
    const result = pieces(breakEntity(line(0, 0, 100, 0), pt(30, 7), pt(60, -9)));
    expect(ends(result[0])).toEqual([0, 0, 30, 0]);
    expect(ends(result[1])).toEqual([60, 0, 100, 0]);
    const vertical = pieces(breakEntity(line(5, 0, 5, 100), pt(0, 20), pt(9, 70)));
    expect(ends(vertical[0])).toEqual([5, 0, 5, 20]);
    expect(ends(vertical[1])).toEqual([5, 70, 5, 100]);
  });

  it("a diagonal line", () => {
    const result = pieces(breakEntity(line(0, 0, 100, 100), pt(25, 25), pt(75, 75)));
    expect(ends(result[0]).every((v, i) => near(v, [0, 0, 25, 25][i]))).toBe(true);
    expect(ends(result[1]).every((v, i) => near(v, [75, 75, 100, 100][i]))).toBe(true);
  });

  it("a point beyond an end counts as that end: only one piece is left", () => {
    const result = pieces(breakEntity(line(0, 0, 100, 0), pt(-10, 0), pt(40, 0)));
    expect(result).toHaveLength(1);
    expect(ends(result[0])).toEqual([40, 0, 100, 0]);
    const other = pieces(breakEntity(line(0, 0, 100, 0), pt(70, 0), pt(500, 0)));
    expect(other).toHaveLength(1);
    expect(ends(other[0])).toEqual([0, 0, 70, 0]);
  });

  it("both points on the same end, or on the end itself: nothing changes (refused)", () => {
    expect(breakEntity(line(0, 0, 100, 0), pt(-30, 0), pt(-10, 0))).toEqual({ ok: false, reason: BREAK_NOTHING_REASON });
    expect(breakEntity(line(0, 0, 100, 0), pt(120, 0), pt(150, 0))).toEqual({ ok: false, reason: BREAK_NOTHING_REASON });
    expect(breakEntity(line(0, 0, 100, 0), pt(0, 0), pt(0, 0))).toEqual({ ok: false, reason: BREAK_NOTHING_REASON });
    expect(breakEntity(line(0, 0, 100, 0), pt(100, 0), pt(100, 0))).toEqual({ ok: false, reason: BREAK_NOTHING_REASON });
  });

  it("from one end to the other removes the whole line (no piece)", () => {
    expect(pieces(breakEntity(line(0, 0, 100, 0), pt(-5, 0), pt(105, 0)))).toEqual([]);
  });

  it("the same point inside splits the line in two, with no gap", () => {
    const result = pieces(breakEntity(line(0, 0, 100, 0), pt(40, 0), pt(40, 0)));
    expect(result).toHaveLength(2);
    expect(ends(result[0])).toEqual([0, 0, 40, 0]);
    expect(ends(result[1])).toEqual([40, 0, 100, 0]);
  });

  it("refuses points that are not finite", () => {
    expect(breakEntity(line(0, 0, 100, 0), pt(NaN, 0), pt(1, 0)).ok).toBe(false);
  });
});

describe("breakEntity: open polyline", () => {
  const l = poly([pt(0, 0), pt(100, 0), pt(100, 100)]);

  it("a gap across a vertex: both pieces keep the vertices that are outside the gap", () => {
    const result = pieces(breakEntity(l, pt(50, 0), pt(100, 50)));
    expect(result).toHaveLength(2);
    expect(vertices(result[0])).toEqual([[0, 0], [50, 0]]);
    expect(vertices(result[1])).toEqual([[100, 50], [100, 100]]);
    expect((result[0] as CadPolyline).closed).toBe(false);
  });

  it("a gap inside one segment keeps the other vertices of both pieces", () => {
    const result = pieces(breakEntity(l, pt(60, 0), pt(80, 0)));
    expect(vertices(result[0])).toEqual([[0, 0], [60, 0]]);
    expect(vertices(result[1])).toEqual([[80, 0], [100, 0], [100, 100]]);
  });

  it("a gap that reaches an end leaves one piece", () => {
    const result = pieces(breakEntity(l, pt(100, 40), pt(100, 300)));
    expect(result).toHaveLength(1);
    expect(vertices(result[0])).toEqual([[0, 0], [100, 0], [100, 40]]);
  });

  it("the same point splits the polyline in two at that point", () => {
    const result = pieces(breakEntity(l, pt(100, 0), pt(100, 0)));
    expect(result).toHaveLength(2);
    expect(vertices(result[0])).toEqual([[0, 0], [100, 0]]);
    expect(vertices(result[1])).toEqual([[100, 0], [100, 100]]);
  });

  it("keeps the original vertex objects (no copies by coordinates)", () => {
    const original = l as CadPolyline;
    const result = pieces(breakEntity(l, pt(60, 0), pt(100, 50)));
    expect((result[0] as CadPolyline).vertices[0]).toBe(original.vertices[0]);
  });
});

describe("breakEntity: closed polyline", () => {
  const square = poly([pt(0, 0), pt(100, 0), pt(100, 100), pt(0, 100)], true);

  it("removes from the first point to the second point, in vertex order, and leaves one open polyline", () => {
    const result = pieces(breakEntity(square, pt(50, 0), pt(100, 50)));
    expect(result).toHaveLength(1);
    expect((result[0] as CadPolyline).closed).toBe(false);
    expect(vertices(result[0])).toEqual([[100, 50], [100, 100], [0, 100], [0, 0], [50, 0]]);
  });

  it("swapping the points removes the other side", () => {
    const result = pieces(breakEntity(square, pt(100, 50), pt(50, 0)));
    expect(vertices(result[0])).toEqual([[50, 0], [100, 0], [100, 50]]);
    expect((result[0] as CadPolyline).closed).toBe(false);
  });

  it("the same point opens the closed polyline at that point", () => {
    const result = pieces(breakEntity(square, pt(50, 0), pt(50, 0)));
    expect(result).toHaveLength(1);
    expect(vertices(result[0])).toEqual([[50, 0], [100, 0], [100, 100], [0, 100], [0, 0], [50, 0]]);
    expect((result[0] as CadPolyline).closed).toBe(false);
  });

  it("a point exactly on a vertex, and the wrap past the last vertex", () => {
    // 第1点 = 最後の辺の上、第2点 = 最初の辺の上(頂点 (0,0) をまたいで取り除く)
    const result = pieces(breakEntity(square, pt(0, 50), pt(50, 0)));
    expect(vertices(result[0])).toEqual([[50, 0], [100, 0], [100, 100], [0, 100], [0, 50]]);
  });
});

describe("breakEntity: circle and arc", () => {
  it("a circle: removes counterclockwise from the first point to the second point, leaving an arc", () => {
    const result = pieces(breakEntity(circle(0, 0, 10), pt(10, 0), pt(0, 10)));
    expect(result).toHaveLength(1);
    const piece = result[0] as CadArc;
    expect(piece.type).toBe("ARC");
    expect(piece.center).toEqual(pt(0, 0));
    expect(piece.radius).toBe(10);
    expect(piece.startAngle).toBeCloseTo(Math.PI / 2, 12);
    expect(piece.endAngle).toBeCloseTo(0, 12);
    expect(piece).toMatchObject({ layer: "L1", color: "#ff0000" });
  });

  it("swapping the points leaves the other arc", () => {
    const piece = pieces(breakEntity(circle(0, 0, 10), pt(0, 10), pt(10, 0)))[0] as CadArc;
    expect(piece.startAngle).toBeCloseTo(0, 12);
    expect(piece.endAngle).toBeCloseTo(Math.PI / 2, 12);
  });

  it("a circle needs two different points", () => {
    expect(breakEntity(circle(0, 0, 10), pt(10, 0), pt(20, 0))).toEqual({ ok: false, reason: BREAK_SAME_POINT_ON_CIRCLE_REASON });
  });

  it("an arc: removes the part between the two points, in the order along the arc", () => {
    const result = pieces(breakEntity(arc(0, 0, 10, 0, Math.PI), pt(10 * Math.cos(Math.PI * 0.75), 10 * Math.sin(Math.PI * 0.75)), pt(10 * Math.cos(Math.PI / 4), 10 * Math.sin(Math.PI / 4))));
    expect(result).toHaveLength(2);
    expect((result[0] as CadArc).startAngle).toBe(0);
    expect((result[0] as CadArc).endAngle).toBeCloseTo(Math.PI / 4, 12);
    expect((result[1] as CadArc).startAngle).toBeCloseTo((Math.PI * 3) / 4, 12);
    expect((result[1] as CadArc).endAngle).toBe(Math.PI);
  });

  it("an arc that crosses 0 degrees", () => {
    const start = (350 * Math.PI) / 180;
    const end = (30 * Math.PI) / 180;
    const at = (deg: number) => pt(10 * Math.cos((deg * Math.PI) / 180), 10 * Math.sin((deg * Math.PI) / 180));
    const result = pieces(breakEntity(arc(0, 0, 10, start, end), at(355), at(10)));
    expect(result).toHaveLength(2);
    expect((result[0] as CadArc).endAngle).toBeCloseTo((355 * Math.PI) / 180, 12);
    expect((result[1] as CadArc).startAngle).toBeCloseTo((10 * Math.PI) / 180, 12);
  });

  it("an arc: points off the arc's range count as the nearer end; a gap at an end leaves one piece", () => {
    const at = (deg: number) => pt(10 * Math.cos((deg * Math.PI) / 180), 10 * Math.sin((deg * Math.PI) / 180));
    const result = pieces(breakEntity(arc(0, 0, 10, 0, Math.PI), at(-30), at(60)));
    expect(result).toHaveLength(1);
    expect((result[0] as CadArc).startAngle).toBeCloseTo(Math.PI / 3, 12);
    expect((result[0] as CadArc).endAngle).toBe(Math.PI);
    expect(breakEntity(arc(0, 0, 10, 0, Math.PI), at(-30), at(-10))).toEqual({ ok: false, reason: BREAK_NOTHING_REASON });
  });

  it("an arc: the same point splits it into two arcs", () => {
    const result = pieces(breakEntity(arc(0, 0, 10, 0, Math.PI), pt(0, 10), pt(0, 10)));
    expect(result).toHaveLength(2);
    expect((result[0] as CadArc).endAngle).toBeCloseTo(Math.PI / 2, 12);
    expect((result[1] as CadArc).startAngle).toBeCloseTo(Math.PI / 2, 12);
  });
});

describe("breakEntity: Codex review fixes (Phase 12)", () => {
  it("a very long line (the square of the length overflows) is still cut at the right place", () => {
    const result = pieces(breakEntity(line(0, 0, 1e200, 0), pt(5e199, 0), pt(5e199, 0)));
    expect(result).toHaveLength(2);
    expect(ends(result[0])).toEqual([0, 0, 5e199, 0]);
    expect(ends(result[1])).toEqual([5e199, 0, 1e200, 0]);
  });

  it("when the position cannot be computed (the length overflows), the whole operation is refused instead of cutting somewhere else", () => {
    expect(breakEntity(line(-1.7e308, 0, 1.7e308, 0), pt(0, 0), pt(10, 0))).toEqual({ ok: false, reason: BREAK_UNCOMPUTABLE_REASON });
  });

  it("the centre of a circle or an arc has no direction: refused", () => {
    expect(breakEntity(circle(0, 0, 10), pt(0, 0), pt(0, 10))).toEqual({ ok: false, reason: BREAK_AT_CENTER_REASON });
    expect(breakEntity(circle(0, 0, 10), pt(10, 0), pt(0, 0))).toEqual({ ok: false, reason: BREAK_AT_CENTER_REASON });
    expect(breakEntity(arc(5, 5, 10, 0, Math.PI), pt(5, 5), pt(5, 15))).toEqual({ ok: false, reason: BREAK_AT_CENTER_REASON });
    // 中心のすぐそば(許容より外)は、方向が決まる
    expect(breakEntity(circle(0, 0, 10), pt(0.001, 0), pt(0, 10)).ok).toBe(true);
  });
});

describe("breakEntity: other types", () => {
  it("refuses with a reason", () => {
    const text = { ...base, id: "x", type: "TEXT", position: pt(0, 0), text: "a", height: 1, rotation: 0, horizontalAlign: "left", verticalAlign: "baseline" } as CadEntity;
    const result = breakEntity(text, pt(0, 0), pt(1, 0));
    expect(result.ok).toBe(false);
  });
});
