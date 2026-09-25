import { describe, expect, it } from "vitest";
import { findSnapPoint } from "./SnapEngine";
import type { CadEntity } from "../../types/cad";

const line: CadEntity = {
  id: "line-1",
  type: "LINE",
  layer: "A",
  color: "#ffffff",
  start: { x: 0, y: 0 },
  end: { x: 10, y: 0 },
};

const crossingLine: CadEntity = {
  id: "line-2",
  type: "LINE",
  layer: "A",
  color: "#ffffff",
  start: { x: 5, y: -5 },
  end: { x: 5, y: 5 },
};

const closedSquare: CadEntity = {
  id: "square-1",
  type: "LWPOLYLINE",
  layer: "B",
  color: "#ffffff",
  vertices: [
    { x: 20, y: 0 },
    { x: 30, y: 0 },
    { x: 30, y: 10 },
    { x: 20, y: 10 },
  ],
  closed: true,
};

const allVisible = new Set(["A", "B"]);

describe("findSnapPoint", () => {
  it("snaps to the nearest endpoint", () => {
    const result = findSnapPoint([line], allVisible, { x: 0.4, y: 0.3 }, 1);
    expect(result).toEqual({ point: { x: 0, y: 0 }, type: "endpoint" });
  });

  it("snaps to a segment midpoint", () => {
    const result = findSnapPoint([line], allVisible, { x: 5.2, y: 0.3 }, 1);
    expect(result).toEqual({ point: { x: 5, y: 0 }, type: "midpoint" });
  });

  it("snaps to the closing segment's midpoint of a closed polyline", () => {
    // closing segment is (20,10)-(20,0); its midpoint is (20, 5)
    const result = findSnapPoint([closedSquare], allVisible, { x: 20.3, y: 5.2 }, 1);
    expect(result?.type).toBe("midpoint");
    expect(result?.point.x).toBeCloseTo(20, 9);
    expect(result?.point.y).toBeCloseTo(5, 9);
  });

  it("snaps to the intersection point of two crossing lines", () => {
    const result = findSnapPoint([line, crossingLine], allVisible, { x: 5.2, y: 0.3 }, 0.6);
    expect(result).toEqual({ point: { x: 5, y: 0 }, type: "intersection" });
  });

  it("prefers whichever candidate is nearest, even across different snap types", () => {
    // cursor is closer to the endpoint (0,0) than to the midpoint (5,0)
    const near = findSnapPoint([line], allVisible, { x: 0.2, y: 0.1 }, 10);
    expect(near?.type).toBe("endpoint");

    // cursor is closer to the midpoint (5,0) than to either endpoint
    const mid = findSnapPoint([line], allVisible, { x: 5, y: 0.1 }, 10);
    expect(mid?.type).toBe("midpoint");
  });

  it("returns null when nothing is within tolerance", () => {
    const result = findSnapPoint([line], allVisible, { x: 5, y: 5 }, 0.5);
    expect(result).toBeNull();
  });

  it("excludes entities on hidden layers", () => {
    const result = findSnapPoint([closedSquare], new Set(), { x: 20, y: 0 }, 1);
    expect(result).toBeNull();
  });

  it("does not report an intersection for segments that do not actually cross", () => {
    const parallelLine: CadEntity = {
      id: "line-3",
      type: "LINE",
      layer: "A",
      color: "#ffffff",
      start: { x: 0, y: 3 },
      end: { x: 10, y: 3 },
    };
    const result = findSnapPoint([line, parallelLine], allVisible, { x: 5, y: 1.5 }, 2);
    // only midpoints/endpoints of the two parallel lines are candidates, no intersection exists
    expect(result?.type).not.toBe("intersection");
  });
});
