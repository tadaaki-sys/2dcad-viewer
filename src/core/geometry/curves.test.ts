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

describe("Codex review fixes (Phase 7): numerically hard cases", () => {
  it("a very long segment that clearly misses the circle is not taken as tangent", () => {
    // 線 y=2 は、半径1の円(中心 (0,0))から、距離2離れている。交点は無い
    expect(intersectSegmentCircle({ x: -1e6, y: 2 }, { x: 1e6, y: 2 }, { x: 0, y: 0 }, 1)).toEqual([]);
    expect(intersectSegmentCircle({ x: -1e9, y: 1.5 }, { x: 1e9, y: 1.5 }, { x: 0, y: 0 }, 1)).toEqual([]);
  });

  it("a very long segment still gives both intersections (no loss to rounding)", () => {
    const points = sorted(intersectSegmentCircle({ x: -1e9, y: 0 }, { x: 1e9, y: 0 }, { x: 0, y: 0 }, 1));
    expect(points).toHaveLength(2);
    expect(points[0].x).toBeCloseTo(-1, 6);
    expect(points[1].x).toBeCloseTo(1, 6);
    expect(Math.abs(points[0].y) + Math.abs(points[1].y)).toBeLessThan(1e-6);
  });

  it("a very long tilted segment: the points are on the circle and on the line", () => {
    const a = { x: -1e8, y: -1e8 };
    const b = { x: 1e8, y: 1e8 + 5 };
    const points = intersectSegmentCircle(a, b, { x: 3, y: 4 }, 10);
    expect(points).toHaveLength(2);
    for (const p of points) expect(Math.abs(Math.hypot(p.x - 3, p.y - 4) - 10)).toBeLessThan(1e-5);
  });

  it("a segment that just touches the circle (tangent) still gives the touching point; one that stops short gives none", () => {
    const touch = intersectSegmentCircle({ x: -50, y: 1 }, { x: 50, y: 1 }, { x: 0, y: 0 }, 1);
    expect(touch).toHaveLength(1);
    expect(touch[0].x).toBeCloseTo(0, 9);
    expect(intersectSegmentCircle({ x: -50, y: 1 }, { x: -1, y: 1 }, { x: 0, y: 0 }, 1)).toEqual([]);
  });

  it("a small circle inside a huge one, with a gap, does not get an invented touching point", () => {
    // 大きな円(半径 1e9)の内側の、半径 1 の円。円周の間に 0.5 の隙間がある
    expect(intersectCircles({ x: 0, y: 0 }, 1e9, { x: 999999998.5, y: 0 }, 1)).toEqual([]);
    // 本当に接する(内接)ときは、接点が出る
    const touching = intersectCircles({ x: 0, y: 0 }, 1e9, { x: 999999999, y: 0 }, 1);
    expect(touching.length).toBeGreaterThanOrEqual(1);
    expect(touching[0].x).toBeCloseTo(1e9, 0);
  });

  it("huge circles that really cross: the points lie on both circles", () => {
    const c1 = { x: 0, y: 0 };
    const c2 = { x: 1.5e9, y: 1e8 };
    const points = intersectCircles(c1, 1e9, c2, 8e8);
    expect(points).toHaveLength(2);
    for (const p of points) {
      expect(Math.abs(Math.hypot(p.x - c1.x, p.y - c1.y) - 1e9)).toBeLessThan(1e-3);
      expect(Math.abs(Math.hypot(p.x - c2.x, p.y - c2.y) - 8e8)).toBeLessThan(1e-3);
    }
  });

  it("random long segments: every returned point is on the circle and inside the segment", () => {
    const rand = mulberry32(31);
    let total = 0;
    for (let n = 0; n < 300; n++) {
      const c = { x: (rand() - 0.5) * 100, y: (rand() - 0.5) * 100 };
      const r = 0.5 + rand() * 20;
      const angle = rand() * Math.PI * 2;
      const reach = 10 ** (3 + rand() * 5); // 1e3 〜 1e8
      const a = { x: c.x + Math.cos(angle) * reach, y: c.y + Math.sin(angle) * reach };
      const b = { x: c.x - Math.cos(angle + (rand() - 0.5) * 1e-5) * reach, y: c.y - Math.sin(angle + (rand() - 0.5) * 1e-5) * reach };
      for (const p of intersectSegmentCircle(a, b, c, r)) {
        total++;
        expect(Math.abs(Math.hypot(p.x - c.x, p.y - c.y) - r)).toBeLessThan(1e-4 + reach * 1e-12);
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
