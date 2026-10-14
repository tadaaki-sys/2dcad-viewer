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

  describe("nearest point on a line", () => {
    const options = { nearestToleranceWorld: 5 };

    it("snaps onto the line when within the nearest distance and no endpoint/midpoint/intersection is close", () => {
      // 端点(0,0)・中点(5,0)から離れた(2.5, 3)。線までの距離は3mm
      const result = findSnapPoint([line], allVisible, { x: 2.5, y: 3 }, 0.5, undefined, options);
      expect(result?.type).toBe("nearest");
      expect(result?.point.x).toBeCloseTo(2.5, 9);
      expect(result?.point.y).toBeCloseTo(0, 9);
    });

    it("does not snap when the line is farther than the nearest distance", () => {
      expect(findSnapPoint([line], allVisible, { x: 2.5, y: 6 }, 0.5, undefined, options)).toBeNull();
    });

    it("does nothing without the option (existing behavior)", () => {
      expect(findSnapPoint([line], allVisible, { x: 2.5, y: 3 }, 0.5)).toBeNull();
    });

    it("still prefers an endpoint over the nearest point", () => {
      const result = findSnapPoint([line], allVisible, { x: 0.3, y: 2 }, 3, undefined, options);
      expect(result?.type).toBe("endpoint");
    });

    it("clamps to the segment end for a point beyond the line's end", () => {
      const result = findSnapPoint([line], allVisible, { x: 13, y: 1 }, 0.5, undefined, options);
      expect(result?.type).toBe("nearest");
      expect(result?.point).toEqual({ x: 10, y: 0 });
    });

    it("snaps to the rim of a circle and to the covered side of an arc", () => {
      const circle: CadEntity = { id: "c", type: "CIRCLE", layer: "A", color: "#fff", center: { x: 0, y: 0 }, radius: 10 };
      const onCircle = findSnapPoint([circle], allVisible, { x: 12, y: 0 }, 0.5, undefined, options);
      expect(onCircle?.type).toBe("nearest");
      expect(onCircle?.point.x).toBeCloseTo(10, 9);
      expect(onCircle?.point.y).toBeCloseTo(0, 9);

      const upperArc: CadEntity = { ...(circle as Extract<CadEntity, { type: "CIRCLE" }>), type: "ARC", id: "a", startAngle: 0, endAngle: Math.PI } as CadEntity;
      // 弧(上半分)の範囲外(下側)は最も近い端点(-10,0)ではなく(10,0)に寄る
      const outside = findSnapPoint([upperArc], allVisible, { x: 9, y: -2 }, 0.5, undefined, options);
      expect(outside?.point.x).toBeCloseTo(10, 9);
      expect(outside?.point.y).toBeCloseTo(0, 9);
    });

    it("ignores hidden layers and TEXT", () => {
      const hidden = new Set<string>();
      expect(findSnapPoint([line], hidden, { x: 2.5, y: 3 }, 0.5, undefined, options)).toBeNull();
      const text: CadEntity = {
        id: "t", type: "TEXT", layer: "A", color: "#fff", position: { x: 0, y: 0 }, text: "A", height: 2, rotation: 0,
        horizontalAlign: "left", verticalAlign: "baseline",
      };
      expect(findSnapPoint([text], allVisible, { x: 0.5, y: 0.5 }, 0.1, undefined, options)).toBeNull();
    });
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
