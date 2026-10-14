import { describe, expect, it } from "vitest";
import { arcPointsBetween, expandBulges } from "./polylineBulge";

describe("arcPointsBetween", () => {
  it("returns nothing for zero, invalid, or degenerate bulges", () => {
    expect(arcPointsBetween({ x: 0, y: 0 }, { x: 10, y: 0 }, 0)).toEqual([]);
    expect(arcPointsBetween({ x: 0, y: 0 }, { x: 10, y: 0 }, Number.NaN)).toEqual([]);
    expect(arcPointsBetween({ x: 0, y: 0 }, { x: 10, y: 0 }, Infinity)).toEqual([]);
    expect(arcPointsBetween({ x: 3, y: 3 }, { x: 3, y: 3 }, 1)).toEqual([]);
  });

  it("builds a CCW semicircle for bulge +1: the arc bulges to the right of the chord direction", () => {
    // 原点→(10,0)のCCW半円は、中心(5,0)の下側(Yが負)を通る
    const points = arcPointsBetween({ x: 0, y: 0 }, { x: 10, y: 0 }, 1);
    expect(points.length).toBeGreaterThanOrEqual(2);
    for (const p of points) {
      expect(Math.hypot(p.x - 5, p.y)).toBeCloseTo(5, 9);
      expect(p.y).toBeLessThan(0);
    }
  });

  it("builds the mirror arc for negative bulge (CW, bulging the other way)", () => {
    const points = arcPointsBetween({ x: 0, y: 0 }, { x: 10, y: 0 }, -1);
    for (const p of points) {
      expect(Math.hypot(p.x - 5, p.y)).toBeCloseTo(5, 9);
      expect(p.y).toBeGreaterThan(0);
    }
  });

  it("puts every point on the circle through both endpoints for a shallow arc", () => {
    const p = { x: 0, y: 0 };
    const q = { x: 10, y: 0 };
    const bulge = 0.25; // 挟角 4*atan(0.25)
    const sweep = 4 * Math.atan(bulge);
    const radius = 10 / (2 * Math.sin(sweep / 2));
    const center = { x: 5, y: radius * Math.cos(sweep / 2) };
    const points = arcPointsBetween(p, q, bulge);
    expect(points.length).toBeGreaterThanOrEqual(1);
    for (const point of points) expect(Math.hypot(point.x - center.x, point.y - center.y)).toBeCloseTo(radius, 9);
  });

  it("uses more points for a larger sweep", () => {
    const small = arcPointsBetween({ x: 0, y: 0 }, { x: 10, y: 0 }, 0.1).length;
    const large = arcPointsBetween({ x: 0, y: 0 }, { x: 10, y: 0 }, 1).length;
    expect(large).toBeGreaterThan(small);
  });
});

describe("expandBulges", () => {
  it("leaves a straight polyline unchanged", () => {
    const vertices = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
    expect(expandBulges(vertices, false)).toEqual(vertices);
  });

  it("inserts arc points only into the segment whose start vertex has a bulge", () => {
    const vertices = [{ x: 0, y: 0, bulge: 1 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
    const points = expandBulges(vertices, false);
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points.length).toBeGreaterThan(3);
    expect(points[points.length - 2]).toEqual({ x: 10, y: 0 });
    expect(points[points.length - 1]).toEqual({ x: 10, y: 10 });
  });

  it("ignores the last vertex's bulge on an open polyline", () => {
    const vertices = [{ x: 0, y: 0 }, { x: 10, y: 0, bulge: 1 }];
    expect(expandBulges(vertices, false)).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
  });

  it("uses the last vertex's bulge for the closing segment of a closed polyline, without repeating the first point", () => {
    const vertices = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10, bulge: 1 }];
    const points = expandBulges(vertices, true);
    expect(points.length).toBeGreaterThan(3);
    expect(points.filter((p) => p.x === 0 && p.y === 0)).toHaveLength(1);
    expect(points[2]).toEqual({ x: 10, y: 10 });
  });
});
