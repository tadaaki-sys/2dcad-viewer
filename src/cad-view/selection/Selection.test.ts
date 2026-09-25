import { describe, expect, it } from "vitest";
import { findEntitiesInBox, findEntitiesNearPoint, findEntityAtPoint } from "./Selection";
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

describe("findEntitiesNearPoint", () => {
  it("returns overlapping candidates ordered from nearest to farthest", () => {
    const near: CadEntity = {
      id: "near",
      type: "LINE",
      layer: "A",
      color: "#ffffff",
      start: { x: 0, y: 0.5 },
      end: { x: 10, y: 0.5 },
    };
    const middle: CadEntity = {
      id: "middle",
      type: "LINE",
      layer: "A",
      color: "#ffffff",
      start: { x: 0, y: 2 },
      end: { x: 10, y: 2 },
    };
    const far: CadEntity = {
      id: "far",
      type: "LINE",
      layer: "A",
      color: "#ffffff",
      start: { x: 0, y: 4 },
      end: { x: 10, y: 4 },
    };

    const result = findEntitiesNearPoint([far, near, middle], allVisible, { x: 5, y: 0 }, 5);
    expect(result.map((e) => e.id)).toEqual(["near", "middle", "far"]);
  });

  it("returns an empty array when nothing is within tolerance", () => {
    const result = findEntitiesNearPoint([line], allVisible, { x: 100, y: 100 }, 1);
    expect(result).toEqual([]);
  });

  it("excludes entities on hidden layers from the candidate list", () => {
    const result = findEntitiesNearPoint(allEntities, new Set(["A"]), { x: 20.2, y: 5 }, 1);
    expect(result.map((e) => e.id)).toEqual([]);
  });
});

describe("findEntitiesInBox", () => {
  const box = { min: { x: 0, y: 0 }, max: { x: 10, y: 10 } };

  const fullyEnclosed: CadEntity = {
    id: "enclosed",
    type: "LINE",
    layer: "A",
    color: "#ffffff",
    start: { x: 2, y: 2 },
    end: { x: 8, y: 8 },
  };

  const straddling: CadEntity = {
    id: "straddling",
    type: "LINE",
    layer: "A",
    color: "#ffffff",
    start: { x: -5, y: 5 },
    end: { x: 15, y: 5 },
  };

  const outside: CadEntity = {
    id: "outside",
    type: "LINE",
    layer: "A",
    color: "#ffffff",
    start: { x: 20, y: 20 },
    end: { x: 30, y: 30 },
  };

  const entities = [fullyEnclosed, straddling, outside];
  const visible = new Set(["A"]);

  it("window mode selects only fully-enclosed entities", () => {
    const result = findEntitiesInBox(entities, visible, box, "window");
    expect(result.map((e) => e.id)).toEqual(["enclosed"]);
  });

  it("crossing mode also selects entities that merely pass through the box", () => {
    const result = findEntitiesInBox(entities, visible, box, "crossing");
    expect(result.map((e) => e.id).sort()).toEqual(["enclosed", "straddling"]);
  });

  it("excludes entities on hidden layers from box selection", () => {
    const result = findEntitiesInBox(entities, new Set(), box, "crossing");
    expect(result).toEqual([]);
  });

  it("crossing mode detects a closed polyline edge crossing the box boundary", () => {
    const polylineTouchingEdge: CadEntity = {
      id: "poly-edge",
      type: "LWPOLYLINE",
      layer: "A",
      color: "#ffffff",
      vertices: [
        { x: 5, y: -5 },
        { x: 5, y: 15 },
        { x: 15, y: 15 },
        { x: 15, y: -5 },
      ],
      closed: true,
    };
    const result = findEntitiesInBox([polylineTouchingEdge], visible, box, "crossing");
    expect(result.map((e) => e.id)).toEqual(["poly-edge"]);

    const windowResult = findEntitiesInBox([polylineTouchingEdge], visible, box, "window");
    expect(windowResult).toEqual([]);
  });
});
