import { describe, expect, it } from "vitest";
import type { CadLayer } from "../../types/cad";
import { DEFAULT_DIMENSION_STYLE } from "../../core/dimension/dimensionStyle";
import { DEFAULT_TEXT_STYLE } from "../../core/text/textStyle";
import { buildLineTypeTable, createDashFactory } from "../../core/style/lineTypes";
import { defaultLayerName, resolveDrawTarget, resolveNamedLayerTarget } from "./drawTarget";
import { drawingStyleOfTarget, isDegenerateRectangle, isSamePoint, makeArc, makeCircle, makeDimension, makeLine, makePolyline, makeRectangle, makeText, rectangleCorners } from "./newEntities";

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
    // 新しい図形は、色・線種・線の太さがレイヤーに従う(ByLayer。印は 7)
    expect(resolveDrawTarget(l, "MACHINE")).toEqual({ ok: true, layer: "MACHINE", color: "#00ff00", byLayer: 7 });
    expect(resolveDrawTarget(l, null)).toEqual({ ok: true, layer: "0", color: "#ffffff", byLayer: 7 });
  });

  it("carries the linetype (as a dash) and the non-thin weight of the layer, resolved, with the ByLayer mark", () => {
    const l: CadLayer[] = [{ name: "0", color: "#ffffff", visible: true }, { name: "HID", color: "#0000ff", visible: true, lineType: "HIDDEN", lineWeight: 50 }, { name: "THIN", color: "#ff0000", visible: true, lineWeight: 25 }];
    const target = resolveDrawTarget(l, "HID");
    expect(target).toMatchObject({ ok: true, layer: "HID", color: "#0000ff", lineWeight: 50, byLayer: 7 });
    if (target.ok) expect(target.lineDash).toMatchObject({ name: "HIDDEN", key: "HIDDEN@1" });
    // 細線は、図形に持たない。尺度は、渡した破線の入れ物(図面の全体の線種尺度)に従う
    const thin = resolveDrawTarget(l, "THIN");
    expect(thin.ok && "lineWeight" in thin).toBe(false);
    const scaled = resolveDrawTarget(l, "HID", createDashFactory(buildLineTypeTable([]), 10));
    if (scaled.ok) expect(scaled.lineDash?.pattern).toEqual([95.25, 63.5]);
    expect(resolveNamedLayerTarget(l, "HID")).toMatchObject({ ok: true, byLayer: 7, lineWeight: 50 });
  });

  it("falls back to the default when the current layer no longer exists", () => {
    const l = layers([["0", "#ffffff", true], ["MACHINE", "#00ff00", true]]);
    expect(resolveDrawTarget(l, "GONE")).toEqual({ ok: true, layer: "0", color: "#ffffff", byLayer: 7 });
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

describe("new entities follow the layer (ByLayer, Phase 17)", () => {
  const dashes = createDashFactory(buildLineTypeTable([]), 1);
  const layer: CadLayer = { name: "HID", color: "#0000ff", visible: true, lineType: "HIDDEN", lineWeight: 50 };
  const target = resolveDrawTarget([layer], "HID", dashes);
  if (!target.ok) throw new Error("target");
  const byLayerStyle = drawingStyleOfTarget(target);

  it("lines, polylines, rectangles, circles and arcs carry the layer's dash and weight and the ByLayer mark", () => {
    const entities = [
      makeLine("n0", { x: 0, y: 0 }, { x: 1, y: 0 }, byLayerStyle),
      makePolyline("n1", [{ x: 0, y: 0 }, { x: 1, y: 1 }], false, byLayerStyle),
      makeRectangle("n2", { x: 0, y: 0 }, { x: 2, y: 2 }, byLayerStyle),
      makeCircle("n3", { x: 0, y: 0 }, 5, byLayerStyle),
      makeArc("n4", { center: { x: 0, y: 0 }, radius: 5, startAngle: 0, endAngle: 1 }, byLayerStyle),
    ];
    for (const entity of entities) {
      expect(entity.byLayer, entity.type).toBe(7);
      expect(entity.lineWeight, entity.type).toBe(50);
      expect(entity.lineDash?.name, entity.type).toBe("HIDDEN");
      expect(entity.color, entity.type).toBe("#0000ff");
    }
  });

  it("text follows only the color", () => {
    const text = makeText("n5", { x: 0, y: 0 }, "abc", 0, DEFAULT_TEXT_STYLE, byLayerStyle);
    expect(text.byLayer).toBe(1);
    expect("lineDash" in text).toBe(false);
    expect("lineWeight" in text).toBe(false);
  });

  it("a style without the mark (old callers) makes plain, own-attribute figures", () => {
    const line = makeLine("n0", { x: 0, y: 0 }, { x: 1, y: 0 }, { layer: "A", color: "#123456" });
    expect("byLayer" in line).toBe(false);
    expect("lineDash" in line).toBe(false);
  });

  it("a dimension follows the layer's linetype and color by default; a style with its own color or linetype does not", () => {
    const geometry = { kind: "linear", p1: { x: 0, y: 0 }, p2: { x: 100, y: 0 }, position: { x: 50, y: 30 }, rotation: 0 } as const;
    const byLayer = makeDimension("n6", geometry, DEFAULT_DIMENSION_STYLE, byLayerStyle);
    expect(byLayer.byLayer).toBe(1 | 2);
    expect(byLayer.lineDash?.name).toBe("HIDDEN");
    const own = makeDimension("n7", geometry, { ...DEFAULT_DIMENSION_STYLE, color: "#ff0000", linetype: "dashed" }, byLayerStyle);
    expect("byLayer" in own).toBe(false);
    expect(own.color).toBe("#ff0000");
    expect(own.lineDash?.key).toContain("dim:dashed");
    const ownColorOnly = makeDimension("n8", geometry, { ...DEFAULT_DIMENSION_STYLE, color: "#ff0000" }, byLayerStyle);
    expect(ownColorOnly.byLayer).toBe(2);
    const solid = makeDimension("n9", geometry, { ...DEFAULT_DIMENSION_STYLE, linetype: "continuous" }, byLayerStyle);
    expect(solid.byLayer).toBe(1);
    expect(solid.lineDash).toBeUndefined();
  });
});