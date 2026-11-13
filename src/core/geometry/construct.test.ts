import { describe, expect, it } from "vitest";
import type { Point2D } from "../../types/cad";
import { angleOf, arcFromCenterStartEnd, arcSweep, arcThroughThreePoints, isUsableRadius, MAX_RADIUS, normalizeAngle } from "./construct";
import { isAngleInSweep } from "./geometry";

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

const onCircle = (center: Point2D, radius: number, angle: number): Point2D => ({
  x: center.x + radius * Math.cos(angle),
  y: center.y + radius * Math.sin(angle),
});

describe("normalizeAngle / angleOf", () => {
  it("keeps angles in [0, 2π)", () => {
    expect(normalizeAngle(0)).toBe(0);
    expect(normalizeAngle(-Math.PI / 2)).toBeCloseTo((3 * Math.PI) / 2, 12);
    expect(normalizeAngle(Math.PI * 4)).toBeCloseTo(0, 12);
    // 非常に小さな負の値が 2π にならない
    expect(normalizeAngle(-1e-18)).toBeLessThan(Math.PI * 2);
    expect(angleOf({ x: 0, y: 0 }, { x: 0, y: -1 })).toBeCloseTo((3 * Math.PI) / 2, 12);
  });
});

describe("arcThroughThreePoints", () => {
  it("counter-clockwise 3 points: start→end keeps the order", () => {
    const arc = arcThroughThreePoints({ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 });
    expect(arc).not.toBeNull();
    expect(arc!.center.x).toBeCloseTo(0, 12);
    expect(arc!.center.y).toBeCloseTo(0, 12);
    expect(arc!.radius).toBeCloseTo(1, 12);
    expect(arc!.startAngle).toBeCloseTo(0, 12);
    expect(arc!.endAngle).toBeCloseTo(Math.PI, 12);
    expect(arcSweep(arc!)).toBeCloseTo(Math.PI, 12);
  });

  it("clockwise 3 points: start and end are swapped so the arc stays counter-clockwise", () => {
    const arc = arcThroughThreePoints({ x: 1, y: 0 }, { x: 0, y: -1 }, { x: -1, y: 0 });
    expect(arc).not.toBeNull();
    // (1,0)→(0,-1)→(-1,0) は時計回り。反時計回りで表すと、(-1,0) から (1,0) へ、下側を通る
    expect(arc!.startAngle).toBeCloseTo(Math.PI, 12);
    expect(arc!.endAngle).toBeCloseTo(0, 12);
    expect(arcSweep(arc!)).toBeCloseTo(Math.PI, 12);
    expect(isAngleInSweep(angleOf(arc!.center, { x: 0, y: -1 }), arc!.startAngle, arcSweep(arc!))).toBe(true);
  });

  it("random points on random circles: the arc passes through all three points and covers the middle one", () => {
    const rand = mulberry32(5);
    for (let n = 0; n < 500; n++) {
      const center = { x: (rand() - 0.5) * 1e5, y: (rand() - 0.5) * 1e5 };
      const radius = 0.01 + rand() * 1e4;
      // 3つの角度を、互いに離して選ぶ(近すぎると、一直線に近くなる)
      const base = rand() * Math.PI * 2;
      const a1 = base;
      const a2 = base + 0.3 + rand() * 2.5;
      const a3 = a2 + 0.3 + rand() * 2.5;
      const clockwise = rand() < 0.5;
      const angles = clockwise ? [a3, a2, a1] : [a1, a2, a3];
      const [p, q, r] = angles.map((angle) => onCircle(center, radius, angle));
      const arc = arcThroughThreePoints(p, q, r);
      expect(arc, `case ${n}`).not.toBeNull();
      const tol = 1e-6 * Math.max(1, radius) + 1e-6 * Math.abs(center.x) * 1e-3;
      expect(Math.hypot(arc!.center.x - center.x, arc!.center.y - center.y)).toBeLessThan(tol * 10 + 1e-5);
      expect(Math.abs(arc!.radius - radius)).toBeLessThan(tol * 10 + 1e-5);
      expect(arc!.startAngle).toBeGreaterThanOrEqual(0);
      expect(arc!.startAngle).toBeLessThan(Math.PI * 2);
      expect(arc!.endAngle).toBeGreaterThanOrEqual(0);
      expect(arc!.endAngle).toBeLessThan(Math.PI * 2);
      // 反時計回りで、通過点を含み、両端が指示した始点・終点(の一方ずつ)になる
      const span = arcSweep(arc!);
      expect(isAngleInSweep(angleOf(arc!.center, q), arc!.startAngle, span), `case ${n}`).toBe(true);
      const ends = [angleOf(arc!.center, p), angleOf(arc!.center, r)];
      const nearly = (x: number, y: number) => Math.abs(Math.atan2(Math.sin(x - y), Math.cos(x - y))) < 1e-6;
      expect(ends.some((angle) => nearly(angle, arc!.startAngle))).toBe(true);
      expect(ends.some((angle) => nearly(angle, arc!.endAngle))).toBe(true);
    }
  });

  it("refuses collinear points, coincident points and a radius above the limit", () => {
    expect(arcThroughThreePoints({ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 10 })).toBeNull();
    expect(arcThroughThreePoints({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 3 })).toBeNull();
    expect(arcThroughThreePoints({ x: 0, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 0 })).toBeNull();
    expect(arcThroughThreePoints({ x: 0, y: 0 }, { x: 4, y: 4 }, { x: 4, y: 4 })).toBeNull();
    // ほぼ一直線(半径が上限を超える)
    expect(arcThroughThreePoints({ x: 0, y: 0 }, { x: 1000, y: 1e-4 }, { x: 2000, y: 0 })).toBeNull();
    expect(arcThroughThreePoints({ x: Number.NaN, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 0 })).toBeNull();
    expect(arcThroughThreePoints({ x: 0, y: 0 }, { x: Number.POSITIVE_INFINITY, y: 1 }, { x: 2, y: 0 })).toBeNull();
  });

  it("works far from the origin (precision)", () => {
    const center = { x: 1e7, y: -1e7 };
    const arc = arcThroughThreePoints(onCircle(center, 50, 0.2), onCircle(center, 50, 1.4), onCircle(center, 50, 2.6));
    expect(arc).not.toBeNull();
    expect(Math.abs(arc!.radius - 50)).toBeLessThan(1e-5);
  });
});

describe("arcFromCenterStartEnd", () => {
  const center = { x: 10, y: 20 };

  it("radius comes from the start point and only the direction of the end point is used", () => {
    const result = arcFromCenterStartEnd(center, { x: 15, y: 20 }, { x: 10, y: 200 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.arc.radius).toBeCloseTo(5, 12);
    expect(result.arc.startAngle).toBeCloseTo(0, 12);
    expect(result.arc.endAngle).toBeCloseTo(Math.PI / 2, 12);
    expect(result.arc.center).toEqual(center);
  });

  it("goes counter-clockwise from the start (a start in the upper half to an end in the right half passes through the left)", () => {
    const result = arcFromCenterStartEnd(center, { x: 10, y: 25 }, { x: 15, y: 20 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.arc.startAngle).toBeCloseTo(Math.PI / 2, 12);
    expect(result.arc.endAngle).toBeCloseTo(0, 12);
    expect(arcSweep(result.arc)).toBeCloseTo((3 * Math.PI) / 2, 12);
  });

  it("refuses a zero radius, an end at the center and an end in the start direction", () => {
    expect(arcFromCenterStartEnd(center, center, { x: 20, y: 20 })).toEqual({ ok: false, reason: "radius" });
    expect(arcFromCenterStartEnd(center, { x: 15, y: 20 }, center)).toEqual({ ok: false, reason: "end-at-center" });
    expect(arcFromCenterStartEnd(center, { x: 15, y: 20 }, { x: 99, y: 20 })).toEqual({ ok: false, reason: "same-direction" });
    expect(arcFromCenterStartEnd(center, { x: 15, y: 20 }, { x: 99, y: 20 + 1e-12 })).toEqual({ ok: false, reason: "same-direction" });
    expect(arcFromCenterStartEnd(center, { x: 10 + MAX_RADIUS * 2, y: 20 }, { x: 20, y: 30 })).toEqual({ ok: false, reason: "radius" });
  });
});

describe("isUsableRadius", () => {
  it("accepts a finite value between the lower and upper limits only", () => {
    expect(isUsableRadius(1)).toBe(true);
    expect(isUsableRadius(MAX_RADIUS)).toBe(true);
    expect(isUsableRadius(0)).toBe(false);
    expect(isUsableRadius(-3)).toBe(false);
    expect(isUsableRadius(MAX_RADIUS * 2)).toBe(false);
    expect(isUsableRadius(Number.NaN)).toBe(false);
    expect(isUsableRadius(Number.POSITIVE_INFINITY)).toBe(false);
  });
});
