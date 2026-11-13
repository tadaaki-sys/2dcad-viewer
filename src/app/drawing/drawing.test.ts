import { describe, expect, it } from "vitest";
import type { CadLayer } from "../../types/cad";
import { defaultLayerName, resolveDrawTarget } from "./drawTarget";
import { isDegenerateRectangle, isSamePoint, makeLine, makePolyline, makeRectangle, rectangleCorners } from "./newEntities";

const style = { layer: "MACHINE", color: "#00ff00" };

describe("new entities", () => {
  it("makeLine copies the points and takes the layer and color from the style", () => {
    const start = { x: 1, y: 2 };
    const line = makeLine("n0", start, { x: 3, y: 4 }, style);
    expect(line).toEqual({ id: "n0", type: "LINE", layer: "MACHINE", color: "#00ff00", start: { x: 1, y: 2 }, end: { x: 3, y: 4 } });
    start.x = 99;
    expect(line.start.x).toBe(1);
  });

  it("makePolyline makes an LWPOLYLINE with straight segments only", () => {
    const polyline = makePolyline("n1", [{ x: 0, y: 0 }, { x: 1, y: 0 }], true, style);
    expect(polyline).toEqual({
      id: "n1",
      type: "LWPOLYLINE",
      layer: "MACHINE",
      color: "#00ff00",
      vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
      closed: true,
    });
    expect("bulge" in polyline.vertices[0]).toBe(false);
  });

  it("makeRectangle makes four corners from the first corner, closed", () => {
    expect(rectangleCorners({ x: 0, y: 0 }, { x: 4, y: 3 })).toEqual([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }]);
    const rect = makeRectangle("n2", { x: 4, y: 3 }, { x: 0, y: 0 }, style);
    expect(rect.closed).toBe(true);
    expect(rect.vertices).toEqual([{ x: 4, y: 3 }, { x: 0, y: 3 }, { x: 0, y: 0 }, { x: 4, y: 0 }]);
  });

  it("detects the same point and a degenerate rectangle within the tolerance", () => {
    expect(isSamePoint({ x: 1, y: 1 }, { x: 1, y: 1 })).toBe(true);
    expect(isSamePoint({ x: 1, y: 1 }, { x: 1 + 1e-9, y: 1 })).toBe(true);
    expect(isSamePoint({ x: 1, y: 1 }, { x: 1.001, y: 1 })).toBe(false);
    expect(isDegenerateRectangle({ x: 0, y: 0 }, { x: 5, y: 0 })).toBe(true);
    expect(isDegenerateRectangle({ x: 0, y: 0 }, { x: 0, y: 5 })).toBe(true);
    expect(isDegenerateRectangle({ x: 0, y: 0 }, { x: 5, y: 1e-9 })).toBe(true);
    expect(isDegenerateRectangle({ x: 0, y: 0 }, { x: 5, y: 0.01 })).toBe(false);
  });
});

const layers = (items: Array<[string, string, boolean]>): CadLayer[] => items.map(([name, color, visible]) => ({ name, color, visible }));

describe("draw target", () => {
  it("defaults to layer 0, else the first layer, else none", () => {
    expect(defaultLayerName(layers([["A", "#111111", true], ["0", "#ffffff", true]]))).toBe("0");
    expect(defaultLayerName(layers([["A", "#111111", true], ["B", "#222222", true]]))).toBe("A");
    expect(defaultLayerName([])).toBeNull();
  });

  it("uses the current layer and its color", () => {
    const l = layers([["0", "#ffffff", true], ["MACHINE", "#00ff00", true]]);
    expect(resolveDrawTarget(l, "MACHINE")).toEqual({ ok: true, layer: "MACHINE", color: "#00ff00" });
    expect(resolveDrawTarget(l, null)).toEqual({ ok: true, layer: "0", color: "#ffffff" });
  });

  it("falls back to the default when the current layer no longer exists", () => {
    const l = layers([["0", "#ffffff", true], ["MACHINE", "#00ff00", true]]);
    expect(resolveDrawTarget(l, "GONE")).toEqual({ ok: true, layer: "0", color: "#ffffff" });
  });

  it("refuses a hidden layer (OFF or frozen) with the reason, and a drawing without layers", () => {
    const l = layers([["0", "#ffffff", true], ["HIDDEN", "#ff00ff", false]]);
    const hidden = resolveDrawTarget(l, "HIDDEN");
    expect(hidden.ok).toBe(false);
    if (!hidden.ok) expect(hidden.reason).toContain("HIDDEN");
    expect(resolveDrawTarget([], null)).toEqual({ ok: false, reason: "レイヤーがありません" });
    // 初期値(レイヤー0)が非表示のときも、描けない
    expect(resolveDrawTarget(layers([["0", "#ffffff", false]]), null).ok).toBe(false);
  });
});
