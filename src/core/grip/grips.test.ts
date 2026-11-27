// グリップの位置と、グリップを動かしたあとの形(Phase 18)
import { describe, expect, it } from "vitest";
import type { CadDimension, CadEntity, Point2D } from "../../types/cad";
import { arcSweep } from "../geometry/construct";
import { applyGrip, gripCountOf, gripsOf, MAX_GRIPS } from "./grips";

const pt = (x: number, y: number): Point2D => ({ x, y });
const base = { layer: "0", color: "#ffffff" };
const line = (): CadEntity => ({ ...base, id: "l", type: "LINE", start: pt(0, 0), end: pt(100, 0) });
const poly = (closed = false): CadEntity => ({ ...base, id: "p", type: "LWPOLYLINE", vertices: [pt(0, 0), pt(100, 0), pt(100, 50), pt(0, 50)], closed });
const circle = (): CadEntity => ({ ...base, id: "c", type: "CIRCLE", center: pt(10, 20), radius: 5 });
const arc = (): CadEntity => ({ ...base, id: "a", type: "ARC", center: pt(0, 0), radius: 10, startAngle: 0, endAngle: Math.PI });
const ellipse = (): CadEntity => ({ ...base, id: "e", type: "ELLIPSE", center: pt(0, 0), majorRadius: 20, minorRadius: 10, rotation: 0, startParam: 0, endParam: Math.PI * 2 });
const text = (): CadEntity => ({ ...base, id: "t", type: "TEXT", position: pt(5, 6), text: "x", height: 3, rotation: 0, horizontalAlign: "left", verticalAlign: "baseline" });
const point = (): CadEntity => ({ ...base, id: "pt", type: "POINT", position: pt(1, 2) });
const VALUES = { textHeight: 10, arrowSize: 10, decimals: 0, angleDecimals: 1, unit: "mm", showUnit: false, extensionOffset: 5 } as const;
const dimension = (kind: CadDimension["kind"] = "linear"): CadEntity => ({
  ...base,
  id: "d",
  type: "DIMENSION",
  kind,
  p1: pt(0, 0),
  p2: kind === "linear" ? pt(100, 0) : pt(0, 50),
  position: pt(50, 40),
  values: VALUES,
  ...(kind === "linear" ? { rotation: 0 } : {}),
});
const spline = (): CadEntity => ({ ...base, id: "s", type: "SPLINE", points: [pt(0, 0), pt(1, 1), pt(2, 0)], closed: false });

const ok = (entity: CadEntity, index: number, target: Point2D) => {
  const edit = applyGrip(entity, index, target);
  if (!edit.ok) throw new Error(edit.error);
  return edit;
};
const pointsOf = (entity: CadEntity) => gripsOf(entity).map((g) => [g.index, g.point.x, g.point.y]);

describe("gripsOf", () => {
  it("a line: both ends and the middle", () => {
    expect(pointsOf(line())).toEqual([[0, 0, 0], [1, 100, 0], [2, 50, 0]]);
  });

  it("a polyline: every vertex, then the middle of every segment (the closing segment too when closed)", () => {
    expect(gripsOf(poly(false))).toHaveLength(4 + 3);
    expect(gripsOf(poly(true))).toHaveLength(4 + 4);
    expect(pointsOf(poly(true)).slice(4)).toEqual([[4, 50, 0], [5, 100, 25], [6, 50, 50], [7, 0, 25]]);
  });

  it("a circle: the center and the four quadrant points; an arc: center, start, end, middle", () => {
    expect(pointsOf(circle())).toEqual([[0, 10, 20], [1, 15, 20], [2, 10, 25], [3, 5, 20], [4, 10, 15]]);
    const a = gripsOf(arc());
    expect(a.map((g) => g.index)).toEqual([0, 1, 2, 3]);
    expect(a[1].point.x).toBeCloseTo(10);
    expect(a[2].point.x).toBeCloseTo(-10);
    expect(a[3].point.y).toBeCloseTo(10);
  });

  it("an ellipse: center and the ends of the major and minor axes; text and point: one grip", () => {
    expect(pointsOf(ellipse())).toEqual([[0, 0, 0], [1, 20, 0], [2, 0, 10]]);
    expect(pointsOf(text())).toEqual([[0, 5, 6]]);
    expect(pointsOf(point())).toEqual([[0, 1, 2]]);
  });

  it("a linear dimension: its two measured points and the dimension line; the others: only the dimension line position", () => {
    expect(pointsOf(dimension("linear"))).toEqual([[0, 0, 0], [1, 100, 0], [2, 50, 40]]);
    for (const kind of ["radius", "diameter", "angular"] as const) expect(pointsOf(dimension(kind))).toEqual([[0, 50, 40]]);
  });

  it("a spline has no grips; a non-finite position is left out (the others keep their numbers)", () => {
    expect(gripsOf(spline())).toEqual([]);
    const bad: CadEntity = { ...base, id: "l", type: "LINE", start: pt(Number.NaN, 0), end: pt(100, 0) };
    expect(gripsOf(bad).map((g) => g.index)).toEqual([1]);
  });

  it("gripCountOf agrees with the number of grips, and the limits are sane", () => {
    for (const e of [line(), poly(false), poly(true), circle(), arc(), ellipse(), text(), point(), dimension("linear"), dimension("radius"), spline()]) expect(gripCountOf(e), e.type).toBe(gripsOf(e).length);
    expect(MAX_GRIPS).toBeGreaterThan(100);
  });
});

describe("applyGrip: lines and polylines", () => {
  it("moves one end; the middle moves the whole line (and says so with a matrix)", () => {
    const end = ok(line(), 1, pt(100, 30)).entity as Extract<CadEntity, { type: "LINE" }>;
    expect([end.start, end.end]).toEqual([pt(0, 0), pt(100, 30)]);
    const mid = ok(line(), 2, pt(60, 10));
    expect(mid.matrix).toEqual([1, 0, 0, 1, 10, 10]);
    const moved = mid.entity as Extract<CadEntity, { type: "LINE" }>;
    expect([moved.start, moved.end]).toEqual([pt(10, 10), pt(110, 10)]);
  });

  it("refuses a zero-length line, the same position, a non-finite target, an unknown grip", () => {
    expect(applyGrip(line(), 0, pt(100, 0)).ok).toBe(false);
    expect(applyGrip(line(), 0, pt(0, 0)).ok).toBe(false);
    expect(applyGrip(line(), 0, pt(Number.NaN, 0)).ok).toBe(false);
    expect(applyGrip(line(), 0, pt(Infinity, 0)).ok).toBe(false);
    expect(applyGrip(line(), 9, pt(1, 1)).ok).toBe(false);
  });

  it("a polyline vertex moves alone (other values on the vertex stay); a segment middle moves both its vertices", () => {
    const withBulge: CadEntity = { ...base, id: "p", type: "LWPOLYLINE", vertices: [{ x: 0, y: 0, bulge: 0.5 } as Point2D, pt(10, 0), pt(10, 10)], closed: false };
    const v = ok(withBulge, 0, pt(-5, -5)).entity as Extract<CadEntity, { type: "LWPOLYLINE" | "POLYLINE" }>;
    expect(v.vertices[0]).toEqual({ x: -5, y: -5, bulge: 0.5 });
    expect(v.vertices.slice(1)).toEqual([pt(10, 0), pt(10, 10)]);
    const m = ok(poly(true), 7, pt(10, 25)).entity as Extract<CadEntity, { type: "LWPOLYLINE" | "POLYLINE" }>; // 閉じる線分(頂点3と0)の中点を右へ 10
    expect(m.vertices).toEqual([pt(10, 0), pt(100, 0), pt(100, 50), pt(10, 50)]);
  });

  it("does not change the original entity", () => {
    const original = line();
    const copy = JSON.stringify(original);
    ok(original, 0, pt(1, 1));
    expect(JSON.stringify(original)).toBe(copy);
  });
});

describe("applyGrip: circles, arcs, ellipses", () => {
  it("the center moves the circle; a quadrant grip sets the radius to the distance from the center", () => {
    expect(ok(circle(), 0, pt(0, 0)).matrix).toEqual([1, 0, 0, 1, -10, -20]);
    expect((ok(circle(), 3, pt(10 - 9, 20)).entity as Extract<CadEntity, { type: "CIRCLE" }>).radius).toBe(9);
    expect(applyGrip(circle(), 1, pt(10, 20)).ok).toBe(false); // 半径 0
    expect(applyGrip(circle(), 1, pt(10 + 2e9, 20)).ok).toBe(false); // 大きすぎる
  });

  it("an arc grip keeps the other two of its three points: start / end / middle", () => {
    const a = arc();
    const check = (index: number, target: Point2D, kept: Point2D[], endpoints: [Point2D, Point2D]) => {
      const next = ok(a, index, target).entity as Extract<CadEntity, { type: "ARC" }>;
      const on = (p: Point2D) => Math.abs(Math.hypot(p.x - next.center.x, p.y - next.center.y) - next.radius);
      // 円の上にあるだけでなく、円弧の角度の範囲の中にあること(補う側の円弧を、取り違えない)
      const inside = (p: Point2D) => {
        const from = Math.atan2(p.y - next.center.y, p.x - next.center.x) - next.startAngle;
        const offset = ((from % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        return offset <= arcSweep(next) + 1e-9;
      };
      // 円弧の両端は、決まった2点(中間点を端にしない)
      const end = (angle: number): Point2D => ({ x: next.center.x + next.radius * Math.cos(angle), y: next.center.y + next.radius * Math.sin(angle) });
      const near = (a: Point2D, b: Point2D) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-6;
      const ends = [end(next.startAngle), end(next.endAngle)];
      for (const wanted of endpoints) expect(ends.some((e) => near(e, wanted)), `(${wanted.x}, ${wanted.y}) is an end of the arc`).toBe(true);
      for (const p of [target, ...kept]) {
        expect(on(p)).toBeLessThan(1e-9);
        expect(inside(p), `(${p.x}, ${p.y}) is on the arc`).toBe(true);
      }
      return next;
    };
    check(1, pt(8, 6), [pt(0, 10), pt(-10, 0)], [pt(8, 6), pt(-10, 0)]); // 始点を動かす: 中間点・終点を通る(両端は、新しい始点と終点)
    check(2, pt(-6, 8), [pt(10, 0), pt(0, 10)], [pt(10, 0), pt(-6, 8)]); // 終点
    const mid = check(3, pt(0, 20), [pt(10, 0), pt(-10, 0)], [pt(10, 0), pt(-10, 0)]); // 中間点を上へ: 半径が大きくなる(両端は、元の始点と終点)
    expect(mid.radius).toBeGreaterThan(10);
    expect(arcSweep(mid)).toBeGreaterThan(0);
  });

  it("an arc grip refuses points that cannot make an arc (collinear)", () => {
    expect(applyGrip(arc(), 3, pt(0, 0)).ok).toBe(false); // 始点・中間点・終点が一直線
  });

  it("the minor grip of a rotated ellipse uses the component along the minor axis", () => {
    const rotated: CadEntity = { ...ellipse(), rotation: Math.PI / 2 } as CadEntity;
    // 長軸は +Y、短軸は -X の向き。短軸の端 (-10, 0) を (-6, 30) へ: 短軸の向きの成分は 6
    const next = ok(rotated, 2, pt(-6, 30)).entity as Extract<CadEntity, { type: "ELLIPSE" }>;
    expect(next.minorRadius).toBeCloseTo(6);
    expect(next.majorRadius).toBe(20);
  });

  it("an ellipse: the major grip sets direction and length and keeps the axis ratio; the minor grip sets only the minor length", () => {
    const major = ok(ellipse(), 1, pt(0, 40)).entity as Extract<CadEntity, { type: "ELLIPSE" }>;
    expect(major.majorRadius).toBeCloseTo(40);
    expect(major.minorRadius).toBeCloseTo(20);
    expect(major.rotation).toBeCloseTo(Math.PI / 2);
    const minor = ok(ellipse(), 2, pt(7, 15)).entity as Extract<CadEntity, { type: "ELLIPSE" }>;
    expect(minor.minorRadius).toBeCloseTo(15);
    expect(minor.majorRadius).toBe(20);
    expect(applyGrip(ellipse(), 2, pt(0, 30)).ok).toBe(false); // 短軸が長軸より長い
  });
});

describe("applyGrip: text, point, dimension, spline", () => {
  it("text and point move whole (with a matrix)", () => {
    expect(ok(text(), 0, pt(15, 6)).matrix).toEqual([1, 0, 0, 1, 10, 0]);
    expect((ok(point(), 0, pt(3, 4)).entity as Extract<CadEntity, { type: "POINT" }>).position).toEqual(pt(3, 4));
  });

  it("a linear dimension: p1, p2 and the line position move separately; the others only move the line position", () => {
    const p1 = ok(dimension("linear"), 0, pt(10, 0)).entity as CadDimension;
    expect([p1.p1, p1.p2, p1.position]).toEqual([pt(10, 0), pt(100, 0), pt(50, 40)]);
    const position = ok(dimension("linear"), 2, pt(50, 80)).entity as CadDimension;
    expect(position.position).toEqual(pt(50, 80));
    const radius = ok(dimension("radius"), 0, pt(60, 40)).entity as CadDimension;
    expect([radius.p1, radius.p2]).toEqual([pt(0, 0), pt(0, 50)]);
    expect(applyGrip(dimension("radius"), 1, pt(1, 1)).ok).toBe(false);
  });

  it("a dimension grip that would make its shape impossible (both measured points together) is refused", () => {
    expect(applyGrip(dimension("linear"), 0, pt(100, 0)).ok).toBe(false);
  });

  it("a spline cannot be edited by grips", () => {
    expect(applyGrip(spline(), 0, pt(1, 1)).ok).toBe(false);
  });
});

describe("a grip moved to a huge place does not produce non-finite geometry", () => {
  it("a finite move that pushes a finite coordinate past the limit is refused too", () => {
    const edge: CadEntity = { ...base, id: "c", type: "CIRCLE", center: pt(1.7e308, 0), radius: 5 };
    expect(applyGrip(edge, 0, pt(1.79e308, 0)).ok).toBe(true); // まだ収まる
    expect(applyGrip({ ...edge, center: pt(1.7e308, 1.7e308) } as CadEntity, 0, pt(-1.7e308, 1.79e308)).ok).toBe(false);
    // 中点 (1.35e308, 0) を (1.75e308, 0) へ: 終点が 1.7e308 + 0.4e308 で桁あふれする
    const line2: CadEntity = { ...base, id: "l", type: "LINE", start: pt(1.0e308, 0), end: pt(1.7e308, 0) };
    expect(applyGrip(line2, 2, pt(1.75e308, 0)).ok).toBe(false);
  });

  it("translating by a huge amount is refused", () => {
    const huge: CadEntity = { ...base, id: "c", type: "CIRCLE", center: pt(1e308, 0), radius: 5 };
    expect(applyGrip(huge, 0, pt(-1e308, 0)).ok).toBe(false);
  });
});
