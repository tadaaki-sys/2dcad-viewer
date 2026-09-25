import { describe, expect, it } from "vitest";
import { findEntityAtPoint } from "./Selection";
import type { CadEntity } from "../../types/cad";

const line: CadEntity = {
  id: "line-1",
  type: "LINE",
  layer: "A",
  color: "#ffffff",
  start: { x: 0, y: 0 },
  end: { x: 10, y: 0 },
};

const closedPolyline: CadEntity = {
  id: "poly-1",
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

const allEntities = [line, closedPolyline];
const allVisible = new Set(["A", "B"]);

describe("findEntityAtPoint", () => {
  it("finds a LINE entity within tolerance", () => {
    const result = findEntityAtPoint(allEntities, allVisible, { x: 5, y: 0.5 }, 1);
    expect(result?.id).toBe("line-1");
  });

  it("returns null when nothing is within tolerance", () => {
    const result = findEntityAtPoint(allEntities, allVisible, { x: 5, y: 5 }, 1);
    expect(result).toBeNull();
  });

  it("hits the closing segment of a closed polyline", () => {
    // (20,10)-(20,0) is the implicit closing segment; midpoint is (20, 5)
    const result = findEntityAtPoint(allEntities, allVisible, { x: 20.2, y: 5 }, 1);
    expect(result?.id).toBe("poly-1");
  });

  it("does not select an entity on a hidden layer", () => {
    const visibleOnlyA = new Set(["A"]);
    const result = findEntityAtPoint(allEntities, visibleOnlyA, { x: 20.2, y: 5 }, 1);
    expect(result).toBeNull();
  });

  it("prefers the closest entity when multiple are within tolerance", () => {
    const nearLine: CadEntity = {
      id: "line-2",
      type: "LINE",
      layer: "A",
      color: "#ffffff",
      start: { x: 0, y: 2 },
      end: { x: 10, y: 2 },
    };
    // point is closer to `line` (y=0, distance 0.5) than `nearLine` (y=2, distance 1.5)
    const result = findEntityAtPoint([line, nearLine], allVisible, { x: 5, y: 0.5 }, 5);
    expect(result?.id).toBe("line-1");
  });
});
