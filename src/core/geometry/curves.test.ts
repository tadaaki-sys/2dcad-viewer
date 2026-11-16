import { describe, expect, it } from "vitest";
import type { Point2D } from "../../types/cad";
import { intersectCircles, intersectSegmentCircle, isAngleInArcSweep, isPointInArcSweep, tangentPointsFromPoint } from "./curves";

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

const sorted = (points: Point2D[]) => [...points].sort((p, q) => p.x - q.x || p.y - q.y);

describe("intersectSegmentCircle", () => {
  const center = { x: 5, y: 0 };

  it("a segment through the circle gives two points; only those on the segment are returned", () => {
    const both = sorted(intersectSegmentCircle({ x: 0, y: 0 }, { x: 10, y: 0 }, center, 3));
    expect(both).toHaveLength(2);
    expect(both[0].x).toBeCloseTo(2, 9);
    expect(both[1].x).toBeCloseTo(8, 9);
    const one = intersectSegmentCircle({ x: 0, y: 0 }, { x: 4, y: 0 }, center, 3);
    expect(one).toHaveLength(1);
    expect(one[0].x).toBeCloseTo(2, 9);
    expect(intersectSegmentCircle({ x: 0, y: 0 }, { x: 1, y: 0 }, center, 3)).toEqual([]);
  });

  it("a tangent segment gives one point; a missing segment gives none", () => {
    const tangent = intersectSegmentCircle({ x: 0, y: 3 }, { x: 10, y: 3 }, center, 3);
    expect(tangent).toHaveLength(1);
    expect(tangent[0].x).toBeCloseTo(5, 9);
    expect(tangent[0].y).toBeCloseTo(3, 9);
    expect(intersectSegmentCircle({ x: 0, y: 3.5 }, { x: 10, y: 3.5 }, center, 3)).toEqual([]);
  });

  it("degenerate input (zero-length segment, zero radius) gives none", () => {
    expect(intersectSegmentCircle({ x: 1, y: 1 }, { x: 1, y: 1 }, center, 3)).toEqual([]);
    expect(intersectSegmentCircle({ x: 0, y: 0 }, { x: 10, y: 0 }, center, 0)).toEqual([]);
  });

  it("random segments and circles: every returned point lies on both", () => {
    const rand = mulberry32(3);
    let total = 0;
    for (let n = 0; n < 400; n++) {
      const c = { x: (rand() - 0.5) * 200, y: (rand() - 0.5) * 200 };
      const r = 1 + rand() * 80;
      const a = { x: (rand() - 0.5) * 300, y: (rand() - 0.5) * 300 };
      const b = { x: (rand() - 0.5) * 300, y: (rand() - 0.5) * 300 };
      for (const p of intersectSegmentCircle(a, b, c, r)) {
        total++;
        expect(Math.abs(Math.hypot(p.x - c.x, p.y - c.y) - r)).toBeLessThan(1e-7);
        // 線分の上にある(a→b の向きの射影が 0〜1)
        const t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / ((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
        expect(t).toBeGreaterThanOrEqual(-1e-9);
        expect(t).toBeLessThanOrEqual(1 + 1e-9);
        const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
        expect(Math.abs(cross) / Math.hypot(b.x - a.x, b.y - a.y)).toBeLessThan(1e-7);
      }
    }
    expect(total).toBeGreaterThan(50); // テストが空振りしていない
  });
});

describe("intersectCircles", () => {
  it("two intersecting circles give two symmetric points", () => {
    const points = sorted(intersectCircles({ x: 0, y: 0 }, 5, { x: 6, y: 0 }, 5));
    expect(points).toHaveLength(2);
    expect(points[0].x).toBeCloseTo(3, 9);
    expect(points[0].y).toBeCloseTo(-4, 9);
    expect(points[1].y).toBeCloseTo(4, 9);
  });

  it("externally and internally tangent circles give one point", () => {
    const external = intersectCircles({ x: 0, y: 0 }, 1, { x: 2, y: 0 }, 1);
    expect(external).toHaveLength(1);
    expect(external[0].x).toBeCloseTo(1, 9);
    const internal = intersectCircles({ x: 0, y: 0 }, 5, { x: 2, y: 0 }, 3);
    expect(internal).toHaveLength(1);
    expect(internal[0].x).toBeCloseTo(5, 9);
  });

  it("separate, contained and concentric circles give none", () => {
    expect(intersectCircles({ x: 0, y: 0 }, 1, { x: 5, y: 0 }, 1)).toEqual([]);
    expect(intersectCircles({ x: 0, y: 0 }, 10, { x: 1, y: 0 }, 2)).toEqual([]);
    expect(intersectCircles({ x: 0, y: 0 }, 3, { x: 0, y: 0 }, 3)).toEqual([]);
  });

  it("random circles: every returned point lies on both circles", () => {
    const rand = mulberry32(8);
    let total = 0;
    for (let n = 0; n < 400; n++) {
      const c1 = { x: (rand() - 0.5) * 100, y: (rand() - 0.5) * 100 };
      const c2 = { x: (rand() - 0.5) * 100, y: (rand() - 0.5) * 100 };
      const r1 = 1 + rand() * 60;
      const r2 = 1 + rand() * 60;
      for (const p of intersectCircles(c1, r1, c2, r2)) {
        total++;
        expect(Math.abs(Math.hypot(p.x - c1.x, p.y - c1.y) - r1)).toBeLessThan(1e-7);
        expect(Math.abs(Math.hypot(p.x - c2.x, p.y - c2.y) - r2)).toBeLessThan(1e-7);
      }
    }
    expect(total).toBeGreaterThan(100);
  });
});

describe("tangentPointsFromPoint", () => {
  it("from a point outside the circle: two points, each with the radius perpendicular to the tangent line", () => {
    const points = tangentPointsFromPoint({ x: 10, y: 0 }, { x: 0, y: 0 }, 5);
    expect(points).toHaveLength(2);
    for (const p of points) {
      expect(p.x).toBeCloseTo(2.5, 9);
      expect(Math.abs(p.y)).toBeCloseTo(Math.sqrt(25 - 6.25), 9);
    }
  });

  it("from a point on or inside the circle: none", () => {
    expect(tangentPointsFromPoint({ x: 5, y: 0 }, { x: 0, y: 0 }, 5)).toEqual([]);
    expect(tangentPointsFromPoint({ x: 1, y: 1 }, { x: 0, y: 0 }, 5)).toEqual([]);
    expect(tangentPointsFromPoint({ x: 0, y: 0 }, { x: 0, y: 0 }, 5)).toEqual([]);
  });

  it("random: the radius to the tangent point is perpendicular to the line from the point (dot product 0)", () => {
    const rand = mulberry32(12);
    for (let n = 0; n < 300; n++) {
      const c = { x: (rand() - 0.5) * 200, y: (rand() - 0.5) * 200 };
      const r = 1 + rand() * 50;
      const from = { x: c.x + (rand() - 0.5) * 400, y: c.y + (rand() - 0.5) * 400 };
      const d = Math.hypot(from.x - c.x, from.y - c.y);
      const points = tangentPointsFromPoint(from, c, r);
      if (d <= r * (1 + 1e-9)) {
        expect(points).toEqual([]);
        continue;
      }
      expect(points).toHaveLength(2);
      for (const p of points) {
        expect(Math.abs(Math.hypot(p.x - c.x, p.y - c.y) - r)).toBeLessThan(1e-7);
        const dot = (p.x - c.x) * (p.x - from.x) + (p.y - c.y) * (p.y - from.y);
        expect(Math.abs(dot) / (r * d)).toBeLessThan(1e-9);
      }
    }
  });
});

describe("arc sweep checks", () => {
  it("includes the edges (with rounding tolerance) and excludes the outside", () => {
    // 0度 → 90度の弧
    expect(isAngleInArcSweep(0, 0, Math.PI / 2)).toBe(true);
    expect(isAngleInArcSweep(Math.PI / 2, 0, Math.PI / 2)).toBe(true);
    expect(isAngleInArcSweep(Math.PI / 4, 0, Math.PI / 2)).toBe(true);
    expect(isAngleInArcSweep(Math.PI / 2 + 1e-12, 0, Math.PI / 2)).toBe(true);
    expect(isAngleInArcSweep(-1e-12, 0, Math.PI / 2)).toBe(true);
    expect(isAngleInArcSweep(Math.PI, 0, Math.PI / 2)).toBe(false);
    expect(isAngleInArcSweep(-0.1, 0, Math.PI / 2)).toBe(false);
  });

  it("an arc across 0 degrees (330 to 30)", () => {
    const start = (330 * Math.PI) / 180;
    const end = (30 * Math.PI) / 180;
    expect(isAngleInArcSweep(0, start, end)).toBe(true);
    expect(isAngleInArcSweep(Math.PI, start, end)).toBe(false);
    expect(isPointInArcSweep({ x: 0, y: 0 }, { x: 10, y: 1 }, start, end)).toBe(true);
    expect(isPointInArcSweep({ x: 0, y: 0 }, { x: -10, y: 1 }, start, end)).toBe(false);
  });
});
