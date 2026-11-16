// STRETCH の、図形ごとの計算(Phase 10)
import { describe, expect, it } from "vitest";
import type { CadEntity, Point2D } from "../../types/cad";
import { boundsTouchWindow, pointInWindow, stretchEntityGeometry, windowCorners, windowFromCorners } from "./stretch";
import type { StretchWindow } from "./stretch";

const base = { layer: "0", color: "#ffffff" };
// 窓: x 0〜100, y 0〜100
const WINDOW: StretchWindow = windowFromCorners({ x: 100, y: 100 }, { x: 0, y: 0 });

const line = (start: Point2D, end: Point2D): CadEntity => ({ ...base, id: "l", type: "LINE", start, end });

describe("the window", () => {
  it("is built from any two opposite corners, and the border counts as inside", () => {
    expect(windowFromCorners({ x: 5, y: 9 }, { x: -3, y: 20 })).toEqual({ min: { x: -3, y: 9 }, max: { x: 5, y: 20 } });
    expect(pointInWindow({ x: 0, y: 0 }, WINDOW)).toBe(true);
    expect(pointInWindow({ x: 100, y: 50 }, WINDOW)).toBe(true);
    expect(pointInWindow({ x: 100.0001, y: 50 }, WINDOW)).toBe(false);
    expect(pointInWindow({ x: Number.NaN, y: 50 }, WINDOW)).toBe(false);
    expect(windowCorners(WINDOW)).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]);
  });

  it("bounds touching the window (edges count) are candidates; far ones are not", () => {
    const bounds = Float64Array.from([100, 100, 120, 120, 101, 0, 130, 50]);
    expect(boundsTouchWindow(bounds, 0, WINDOW)).toBe(true); // 角が触れる
    expect(boundsTouchWindow(bounds, 4, WINDOW)).toBe(false);
  });
});

describe("LINE", () => {
  it("one end inside: only that end moves (reshaped); the other end stays", () => {
    const result = stretchEntityGeometry(line({ x: 50, y: 50 }, { x: 300, y: 50 }), WINDOW, 10, -5);
    expect(result.kind).toBe("reshaped");
    if (result.kind === "reshaped") expect(result.entity).toMatchObject({ start: { x: 60, y: 45 }, end: { x: 300, y: 50 } });
  });

  it("both ends inside: the whole line moves (moved, with a translation matrix)", () => {
    const result = stretchEntityGeometry(line({ x: 10, y: 10 }, { x: 90, y: 90 }), WINDOW, 7, 8);
    expect(result.kind).toBe("moved");
    if (result.kind === "moved") {
      expect(result.entity).toMatchObject({ start: { x: 17, y: 18 }, end: { x: 97, y: 98 } });
      expect(result.matrix).toEqual([1, 0, 0, 1, 7, 8]);
    }
  });

  it("no end inside (even when the line crosses the window): unchanged", () => {
    expect(stretchEntityGeometry(line({ x: -50, y: 50 }, { x: 150, y: 50 }), WINDOW, 10, 10)).toEqual({ kind: "unchanged" });
  });

  it("an end exactly on the border moves", () => {
    const result = stretchEntityGeometry(line({ x: 100, y: 100 }, { x: 200, y: 200 }), WINDOW, 1, 1);
    expect(result.kind).toBe("reshaped");
  });
});

describe("polyline and spline", () => {
  const poly = (vertices: Array<Point2D & { bulge?: number }>, closed = false) => ({ ...base, id: "p", type: "LWPOLYLINE", vertices, closed }) as unknown as CadEntity;

  it("only the vertices inside move; the extra values of a vertex (bulge) stay", () => {
    const result = stretchEntityGeometry(poly([{ x: 10, y: 10, bulge: 0.4 }, { x: 50, y: 50 }, { x: 500, y: 500, bulge: -0.2 }, { x: 600, y: 10 }]), WINDOW, 5, 0);
    expect(result.kind).toBe("reshaped");
    if (result.kind === "reshaped") {
      const vertices = (result.entity as unknown as { vertices: Array<Point2D & { bulge?: number }> }).vertices;
      expect(vertices).toEqual([{ x: 15, y: 10, bulge: 0.4 }, { x: 55, y: 50 }, { x: 500, y: 500, bulge: -0.2 }, { x: 600, y: 10 }]);
    }
  });

  it("all vertices inside: moved as a whole; none inside: unchanged", () => {
    expect(stretchEntityGeometry(poly([{ x: 1, y: 1 }, { x: 99, y: 99 }]), WINDOW, 3, 3).kind).toBe("moved");
    expect(stretchEntityGeometry(poly([{ x: -1, y: 1 }, { x: 199, y: 99 }]), WINDOW, 3, 3).kind).toBe("unchanged");
  });

  it("a closed polyline works the same way (the first and last vertices are both checked)", () => {
    const result = stretchEntityGeometry(poly([{ x: 10, y: 10 }, { x: 300, y: 10 }, { x: 300, y: 300 }], true), WINDOW, 0, 40);
    expect(result.kind).toBe("reshaped");
    if (result.kind === "reshaped") expect((result.entity as unknown as { vertices: Point2D[] }).vertices[0]).toEqual({ x: 10, y: 50 });
  });

  it("a spline moves the points inside", () => {
    const spline: CadEntity = { ...base, id: "s", type: "SPLINE", points: [{ x: 10, y: 10 }, { x: 400, y: 10 }], closed: false };
    const result = stretchEntityGeometry(spline, WINDOW, 1, 2);
    expect(result.kind).toBe("reshaped");
    if (result.kind === "reshaped") expect((result.entity as unknown as { points: Point2D[] }).points).toEqual([{ x: 11, y: 12 }, { x: 400, y: 10 }]);
  });
});

describe("circle, point, text: moved as a whole when the center (insertion point) is inside", () => {
  it("circle with its center inside moves even if it sticks out; outside center does not", () => {
    const inside: CadEntity = { ...base, id: "c", type: "CIRCLE", center: { x: 90, y: 50 }, radius: 80 };
    const outside: CadEntity = { ...base, id: "c", type: "CIRCLE", center: { x: 110, y: 50 }, radius: 80 };
    expect(stretchEntityGeometry(inside, WINDOW, 5, 0).kind).toBe("moved");
    expect(stretchEntityGeometry(outside, WINDOW, 5, 0).kind).toBe("unchanged");
  });

  it("point and text", () => {
    const pt: CadEntity = { ...base, id: "p", type: "POINT", position: { x: 20, y: 20 } };
    const tx: CadEntity = { ...base, id: "t", type: "TEXT", position: { x: 20, y: 20 }, text: "A", height: 5, rotation: 0, horizontalAlign: "left", verticalAlign: "baseline" };
    const far: CadEntity = { ...pt, position: { x: 200, y: 20 } } as CadEntity;
    expect(stretchEntityGeometry(pt, WINDOW, 1, 1).kind).toBe("moved");
    expect(stretchEntityGeometry(tx, WINDOW, 1, 1).kind).toBe("moved");
    expect(stretchEntityGeometry(far, WINDOW, 1, 1).kind).toBe("unchanged");
  });
});

describe("arc and ellipse: moved only when wholly inside; partially inside is skipped", () => {
  const arc = (cx: number): CadEntity => ({ ...base, id: "a", type: "ARC", center: { x: cx, y: 50 }, radius: 20, startAngle: 0, endAngle: Math.PI });
  const ellipse = (cx: number): CadEntity => ({ ...base, id: "e", type: "ELLIPSE", center: { x: cx, y: 50 }, majorRadius: 20, minorRadius: 10, rotation: 0, startParam: 0, endParam: Math.PI * 2 });

  it("wholly inside: moved", () => {
    expect(stretchEntityGeometry(arc(50), WINDOW, 3, 0).kind).toBe("moved");
    expect(stretchEntityGeometry(ellipse(50), WINDOW, 3, 0).kind).toBe("moved");
  });

  it("sticking out of the window: partial-skipped (nothing is changed); far away: unchanged", () => {
    expect(stretchEntityGeometry(arc(95), WINDOW, 3, 0)).toEqual({ kind: "partial-skipped" });
    expect(stretchEntityGeometry(ellipse(95), WINDOW, 3, 0)).toEqual({ kind: "partial-skipped" });
    expect(stretchEntityGeometry(arc(500), WINDOW, 3, 0)).toEqual({ kind: "unchanged" });
  });
});

describe("overflow and broken data", () => {
  it("a finite point that would overflow throws (nothing is returned half-done)", () => {
    // 窓を広げて、桁あふれする端点(1.7e308)を窓の中に入れる
    const wide = windowFromCorners({ x: 0, y: 0 }, { x: 1.7e308, y: 100 });
    const edge = line({ x: 50, y: 50 }, { x: 1.7e308, y: 50 });
    expect(() => stretchEntityGeometry(edge, wide, 1.7e308, 0)).toThrow(/大きすぎ/);
  });

  it("a coordinate that is not finite is never inside, so a broken entity is left alone", () => {
    expect(stretchEntityGeometry(line({ x: Number.NaN, y: 1 }, { x: 500, y: 1 }), WINDOW, 1, 1)).toEqual({ kind: "unchanged" });
  });

  it("the original entity is never changed", () => {
    const original = line({ x: 50, y: 50 }, { x: 300, y: 50 });
    stretchEntityGeometry(original, WINDOW, 10, 10);
    expect(original).toEqual(line({ x: 50, y: 50 }, { x: 300, y: 50 }));
  });
});
