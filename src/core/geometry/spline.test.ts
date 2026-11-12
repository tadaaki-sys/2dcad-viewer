import { describe, expect, it } from "vitest";
import { evaluateBSpline, tessellateSpline } from "./spline";

describe("evaluateBSpline", () => {
  it("evaluates a quadratic Bezier (clamped knots) at its midpoint", () => {
    const control = [
      { x: 0, y: 0 },
      { x: 10, y: 20 },
      { x: 20, y: 0 },
    ];
    const p = evaluateBSpline(control, [0, 0, 0, 1, 1, 1], 2, 0.5);
    // 0.25*P0 + 0.5*P1 + 0.25*P2
    expect(p.x).toBeCloseTo(10, 9);
    expect(p.y).toBeCloseTo(10, 9);
  });

  it("passes through the first and last control points for clamped knots", () => {
    const control = [
      { x: 0, y: 0 },
      { x: 5, y: 10 },
      { x: 15, y: 10 },
      { x: 20, y: 0 },
    ];
    const knots = [0, 0, 0, 0, 1, 1, 1, 1];
    const start = evaluateBSpline(control, knots, 3, 0);
    const end = evaluateBSpline(control, knots, 3, 1);
    expect(start.x).toBeCloseTo(0, 9);
    expect(start.y).toBeCloseTo(0, 9);
    expect(end.x).toBeCloseTo(20, 9);
    expect(end.y).toBeCloseTo(0, 9);
  });

  it("reduces to a straight polyline for degree 1", () => {
    const control = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];
    const p = evaluateBSpline(control, [0, 0, 1, 2, 2], 1, 1.5);
    expect(p.x).toBeCloseTo(10, 9);
    expect(p.y).toBeCloseTo(5, 9);
  });
});

describe("tessellateSpline", () => {
  const control = [
    { x: 0, y: 0 },
    { x: 10, y: 20 },
    { x: 20, y: 0 },
  ];

  it("samples a valid B-spline into many points ending exactly at the last control point", () => {
    const points = tessellateSpline({ controlPoints: control, knots: [0, 0, 0, 1, 1, 1], degree: 2 });
    expect(points).not.toBeNull();
    expect(points!.length).toBeGreaterThan(control.length);
    expect(points![0]).toEqual({ x: 0, y: 0 });
    expect(points![points!.length - 1].x).toBeCloseTo(20, 9);
    expect(points![points!.length - 1].y).toBeCloseTo(0, 9);
  });

  it("falls back to fit points when the knot vector is inconsistent", () => {
    const fit = [
      { x: 0, y: 0 },
      { x: 5, y: 5 },
      { x: 9, y: 0 },
    ];
    expect(tessellateSpline({ controlPoints: control, fitPoints: fit, knots: [0, 1], degree: 2 })).toEqual(fit);
  });

  it("falls back to the control polygon when only control points are usable", () => {
    expect(tessellateSpline({ controlPoints: control, knots: [], degree: 2 })).toEqual(control);
  });

  it("returns null when fewer than two points are available", () => {
    expect(tessellateSpline({ controlPoints: [{ x: 1, y: 1 }] })).toBeNull();
    expect(tessellateSpline({})).toBeNull();
  });

  it("keeps a straight spline sparse instead of oversampling it", () => {
    const straight = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 10, y: 0 },
    ];
    const points = tessellateSpline({ controlPoints: straight, knots: [0, 0, 0, 1, 1, 1], degree: 2 });
    expect(points!.length).toBeLessThanOrEqual(5);
  });

  it("refines sharply curved spans more than gentle ones while staying within the point budget", () => {
    const gentle = tessellateSpline({
      controlPoints: [
        { x: 0, y: 0 },
        { x: 10, y: 1 },
        { x: 20, y: 0 },
      ],
      knots: [0, 0, 0, 1, 1, 1],
      degree: 2,
    });
    const sharp = tessellateSpline({ controlPoints: control, knots: [0, 0, 0, 1, 1, 1], degree: 2 });
    expect(sharp!.length).toBeGreaterThan(gentle!.length);
    expect(sharp!.length).toBeLessThan(200);
  });

  it("keeps the tessellation within tolerance of the true curve", () => {
    const points = tessellateSpline({ controlPoints: control, knots: [0, 0, 0, 1, 1, 1], degree: 2 })!;
    // 弦近似の誤差: 曲線上の点 (t=0.3) は、隣り合う近似点を結ぶ線分から制御点の大きさの0.1%以内にある
    const exact = evaluateBSpline(control, [0, 0, 0, 1, 1, 1], 2, 0.3);
    let best = Infinity;
    for (let i = 0; i < points.length - 1; i++) {
      const [a, b] = [points[i], points[i + 1]];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((exact.x - a.x) * dx + (exact.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
      best = Math.min(best, Math.hypot(exact.x - (a.x + t * dx), exact.y - (a.y + t * dy)));
    }
    expect(best).toBeLessThan(0.001 * Math.hypot(20, 20));
  });

  it("caps the number of points for splines with very many spans", () => {
    const many = Array.from({ length: 400 }, (_, i) => ({ x: i, y: Math.sin(i) * 10 }));
    const degree = 3;
    const knots = [0, 0, 0, 0, ...Array.from({ length: 400 - degree - 1 }, (_, i) => i + 1), 397, 397, 397, 397];
    const points = tessellateSpline({ controlPoints: many, knots, degree });
    expect(points).not.toBeNull();
    expect(points!.length).toBeLessThan(1200);
  });
});
