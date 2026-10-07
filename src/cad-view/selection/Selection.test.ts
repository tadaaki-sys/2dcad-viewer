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

describe("findEntityAtPoint - CIRCLE/ARC", () => {
  const circle: CadEntity = {
    id: "circle-1",
    type: "CIRCLE",
    layer: "A",
    color: "#ffffff",
    center: { x: 0, y: 0 },
    radius: 10,
  };

  const arc: CadEntity = {
    id: "arc-1",
    type: "ARC",
    layer: "A",
    color: "#ffffff",
    center: { x: 100, y: 0 },
    radius: 10,
    startAngle: 0,
    endAngle: Math.PI, // 上半分(0〜180度)
  };

  const visible = new Set(["A"]);

  it("hits the rim of a CIRCLE but not its empty interior", () => {
    const onRim = findEntityAtPoint([circle], visible, { x: 10, y: 0.2 }, 1);
    expect(onRim?.id).toBe("circle-1");

    const atCenter = findEntityAtPoint([circle], visible, { x: 0, y: 0 }, 1);
    expect(atCenter).toBeNull();
  });

  it("hits a point on the ARC's swept range", () => {
    // 90度(上)はstartAngle=0からendAngle=180度の範囲内
    const hit = findEntityAtPoint([arc], visible, { x: 100, y: 10.2 }, 1);
    expect(hit?.id).toBe("arc-1");
  });

  it("does not hit the circle's rim outside the ARC's swept range", () => {
    // 270度(下)はARCの範囲外(0〜180度)なのでヒットしない
    const miss = findEntityAtPoint([arc], visible, { x: 100, y: -10 }, 1);
    expect(miss).toBeNull();
  });

  it("selects a CIRCLE fully inside a window box", () => {
    const box = { min: { x: -15, y: -15 }, max: { x: 15, y: 15 } };
    const result = findEntitiesInBox([circle], visible, box, "window");
    expect(result.map((e) => e.id)).toEqual(["circle-1"]);
  });

  it("does not select a CIRCLE via window box when it pokes outside", () => {
    const box = { min: { x: -5, y: -15 }, max: { x: 15, y: 15 } };
    const result = findEntitiesInBox([circle], visible, box, "window");
    expect(result).toEqual([]);
  });

  it("selects a CIRCLE via crossing box when only partially overlapping", () => {
    const box = { min: { x: -5, y: -15 }, max: { x: 15, y: 15 } };
    const result = findEntitiesInBox([circle], visible, box, "crossing");
    expect(result.map((e) => e.id)).toEqual(["circle-1"]);
  });
});

describe("findEntityAtPoint - TEXT", () => {
  // 幅 = 2文字 * height10 * 0.65 = 13, 高さ = 1行 * height10 * 1.2 = 12
  // horizontalAlign=left, verticalAlign=topなので、バウンディングボックスは x:[0,13], y:[-12,0]
  const text: CadEntity = {
    id: "text-1",
    type: "TEXT",
    layer: "A",
    color: "#ffffff",
    position: { x: 0, y: 0 },
    text: "AB",
    height: 10,
    rotation: 0,
    horizontalAlign: "left",
    verticalAlign: "top",
  };

  const visible = new Set(["A"]);

  it("hits anywhere inside the TEXT's bounding box, unlike CIRCLE's empty interior", () => {
    const inside = findEntityAtPoint([text], visible, { x: 5, y: -5 }, 1);
    expect(inside?.id).toBe("text-1");
  });

  it("narrows the clickable area with a width factor and widens it for full-width characters", () => {
    // "AB"(2文字×0.65)×高さ10 = 幅13。幅係数0.5なら6.5なので x=10 はもう箱の外
    const squeezed: CadEntity = { ...(text as Extract<CadEntity, { type: "TEXT" }>), widthFactor: 0.5 };
    expect(findEntityAtPoint([text], visible, { x: 10, y: -5 }, 0.5)?.id).toBe("text-1");
    expect(findEntityAtPoint([squeezed], visible, { x: 10, y: -5 }, 0.5)).toBeNull();

    // 全角2文字は幅20(文字高と同じ幅)。ASCIIの幅13なら x=18 は箱の外だが、全角なら中
    const japanese: CadEntity = { ...(text as Extract<CadEntity, { type: "TEXT" }>), text: "配置" };
    expect(findEntityAtPoint([text], visible, { x: 18, y: -5 }, 0.5)).toBeNull();
    expect(findEntityAtPoint([japanese], visible, { x: 18, y: -5 }, 0.5)?.id).toBe("text-1");
  });

  it("does not hit a point far outside the TEXT's bounding box", () => {
    const outside = findEntityAtPoint([text], visible, { x: 50, y: 50 }, 1);
    expect(outside).toBeNull();
  });

  it("selects a TEXT fully inside a window box", () => {
    const box = { min: { x: -2, y: -14 }, max: { x: 15, y: 2 } };
    const result = findEntitiesInBox([text], visible, box, "window");
    expect(result.map((e) => e.id)).toEqual(["text-1"]);
  });

  it("does not select a TEXT via window box when it pokes outside", () => {
    const box = { min: { x: 5, y: -14 }, max: { x: 15, y: 2 } };
    const result = findEntitiesInBox([text], visible, box, "window");
    expect(result).toEqual([]);
  });

  it("selects a TEXT via crossing box when only partially overlapping", () => {
    const box = { min: { x: 5, y: -14 }, max: { x: 15, y: 2 } };
    const result = findEntitiesInBox([text], visible, box, "crossing");
    expect(result.map((e) => e.id)).toEqual(["text-1"]);
  });
});

describe("findEntityAtPoint - SPLINE", () => {
  const spline: CadEntity = {
    id: "spline-1",
    type: "SPLINE",
    layer: "A",
    color: "#ffffff",
    points: [
      { x: 0, y: 0 },
      { x: 5, y: 5 },
      { x: 10, y: 0 },
    ],
    closed: false,
  };
  const visible = new Set(["A"]);

  it("hits near the curve but not far from it", () => {
    expect(findEntityAtPoint([spline], visible, { x: 2.5, y: 2.6 }, 1)?.id).toBe("spline-1");
    expect(findEntityAtPoint([spline], visible, { x: 5, y: -5 }, 1)).toBeNull();
  });

  it("does not add a closing segment when the SPLINE is open, but does when closed", () => {
    // 始点(0,0)と終点(10,0)の中間(5,0)は、開いたスプラインでは曲線から離れている
    expect(findEntityAtPoint([spline], visible, { x: 5, y: 0 }, 0.5)).toBeNull();
    const closed: CadEntity = { ...(spline as Extract<CadEntity, { type: "SPLINE" }>), closed: true };
    expect(findEntityAtPoint([closed], visible, { x: 5, y: 0 }, 0.5)?.id).toBe("spline-1");
  });
});

describe("findEntityAtPoint - ELLIPSE", () => {
  const ellipse: CadEntity = {
    id: "ellipse-1",
    type: "ELLIPSE",
    layer: "A",
    color: "#ffffff",
    center: { x: 0, y: 0 },
    majorRadius: 10,
    minorRadius: 5,
    rotation: 0,
    startParam: 0,
    endParam: Math.PI * 2,
  };

  const ellipseArc: CadEntity = {
    id: "ellipse-arc-1",
    type: "ELLIPSE",
    layer: "A",
    color: "#ffffff",
    center: { x: 100, y: 0 },
    majorRadius: 10,
    minorRadius: 5,
    rotation: 0,
    startParam: 0,
    endParam: Math.PI, // 上半分(param 0〜180度)
  };

  const visible = new Set(["A"]);

  it("hits the rim of an ELLIPSE but not its empty interior", () => {
    const onRim = findEntityAtPoint([ellipse], visible, { x: 0, y: 5.2 }, 1);
    expect(onRim?.id).toBe("ellipse-1");

    const atCenter = findEntityAtPoint([ellipse], visible, { x: 0, y: 0 }, 1);
    expect(atCenter).toBeNull();
  });

  it("hits a point on the elliptical arc's swept range", () => {
    const hit = findEntityAtPoint([ellipseArc], visible, { x: 100, y: 5.2 }, 1);
    expect(hit?.id).toBe("ellipse-arc-1");
  });

  it("does not hit the ellipse's rim outside the arc's swept range", () => {
    const miss = findEntityAtPoint([ellipseArc], visible, { x: 100, y: -5 }, 1);
    expect(miss).toBeNull();
  });

  it("selects an ELLIPSE fully inside a window box", () => {
    const box = { min: { x: -15, y: -10 }, max: { x: 15, y: 10 } };
    const result = findEntitiesInBox([ellipse], visible, box, "window");
    expect(result.map((e) => e.id)).toEqual(["ellipse-1"]);
  });

  it("does not select an ELLIPSE via window box when it pokes outside", () => {
    const box = { min: { x: -5, y: -10 }, max: { x: 15, y: 10 } };
    const result = findEntitiesInBox([ellipse], visible, box, "window");
    expect(result).toEqual([]);
  });

  it("selects an ELLIPSE via crossing box when only partially overlapping", () => {
    const box = { min: { x: -5, y: -10 }, max: { x: 15, y: 10 } };
    const result = findEntitiesInBox([ellipse], visible, box, "crossing");
    expect(result.map((e) => e.id)).toEqual(["ellipse-1"]);
  });
});
