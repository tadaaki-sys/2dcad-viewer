// 図形ごとの色・線種・線の太さ・線種尺度の指定(Phase 18)
import { describe, expect, it } from "vitest";
import type { CadEntity, CadLayer } from "../../types/cad";
import { buildLineTypeTable, createDashFactory } from "../style/lineTypes";
import { BY_LAYER, withColor, withLineType, withLineTypeScale, withLineWeight } from "./entityStyle";

const table = buildLineTypeTable([]);
const dashes = createDashFactory(table, 1);
const layer: CadLayer = { name: "A", color: "#ff0000", visible: true, lineType: "HIDDEN", lineWeight: 50 };
const line = (extra: Record<string, unknown> = {}): CadEntity => ({ id: "l", type: "LINE", layer: "A", color: "#00ff00", start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, ...extra }) as CadEntity;
const text = (): CadEntity => ({ id: "t", type: "TEXT", layer: "A", color: "#00ff00", position: { x: 0, y: 0 }, text: "x", height: 3, rotation: 0, horizontalAlign: "left", verticalAlign: "baseline" });
const must = <T extends { ok: boolean }>(edit: T): Extract<T, { ok: true }> => {
  if (!edit.ok) throw new Error(JSON.stringify(edit));
  return edit as Extract<T, { ok: true }>;
};

describe("withColor", () => {
  it("an own color clears the ByLayer mark of the color only; ByLayer takes the layer color and sets the mark", () => {
    const own = must(withColor(line({ byLayer: 7 }), "#0000FF", layer)).entity;
    expect(own.color).toBe("#0000ff");
    expect(own.byLayer).toBe(6);
    const back = must(withColor(own, BY_LAYER, layer)).entity;
    expect([back.color, back.byLayer]).toEqual(["#ff0000", 7]);
    // 印が全部外れたら、項目ごと無くす
    expect("byLayer" in must(withColor(line({ byLayer: 1 }), "#123456", layer)).entity).toBe(false);
  });

  it("refuses a bad color and does not change the original", () => {
    const original = line({ byLayer: 7 });
    const copy = JSON.stringify(original);
    expect(withColor(original, "red", layer).ok).toBe(false);
    must(withColor(original, "#112233", layer));
    expect(JSON.stringify(original)).toBe(copy);
  });

  it("works for text and points too (they only have a color)", () => {
    expect(must(withColor(text(), BY_LAYER, layer)).entity.byLayer).toBe(1);
  });
});

describe("withLineType", () => {
  it("an own linetype builds the dash (keeping the figure's own scale) and clears the mark; CONTINUOUS removes the dash", () => {
    const dashed = must(withLineType(line({ byLayer: 7, lineTypeScale: 2 }), "CENTER", layer, dashes)).entity;
    expect(dashed.type === "LINE" && dashed.lineDash?.key).toBe("CENTER@2");
    expect(dashed.byLayer).toBe(5);
    const solid = must(withLineType(dashed, "CONTINUOUS", layer, dashes)).entity;
    expect("lineDash" in solid).toBe(false);
    expect(solid.lineTypeScale).toBe(2);
  });

  it("ByLayer takes the layer's linetype (solid for a solid layer) and sets the mark", () => {
    const byLayer = must(withLineType(line(), BY_LAYER, layer, dashes)).entity;
    expect(byLayer.type === "LINE" && byLayer.lineDash?.name).toBe("HIDDEN");
    expect(byLayer.byLayer).toBe(2);
    const solidLayer = must(withLineType(line({ lineDash: dashes.make("DASHED", 1) }), BY_LAYER, { ...layer, lineType: undefined }, dashes)).entity;
    expect("lineDash" in solidLayer).toBe(false);
  });

  it("refuses text and points", () => {
    expect(withLineType(text(), "CENTER", layer, dashes).ok).toBe(false);
  });
});

describe("withLineWeight", () => {
  it("an own weight clears the mark; thin weights are not stored; null is the default (thin)", () => {
    const heavy = must(withLineWeight(line({ byLayer: 7 }), 100, layer)).entity;
    expect([heavy.type === "LINE" && heavy.lineWeight, heavy.byLayer]).toEqual([100, 3]);
    const thin = must(withLineWeight(heavy, 25, layer)).entity;
    expect("lineWeight" in thin).toBe(false);
    expect(must(withLineWeight(heavy, null, layer)).entity.type === "LINE" && "lineWeight" in must(withLineWeight(heavy, null, layer)).entity).toBe(false);
  });

  it("ByLayer takes the layer's weight; a non-standard weight, text, points and dimensions are refused", () => {
    const byLayer = must(withLineWeight(line(), BY_LAYER, layer)).entity;
    expect([byLayer.type === "LINE" && byLayer.lineWeight, byLayer.byLayer]).toEqual([50, 4]);
    expect(withLineWeight(line(), 26, layer).ok).toBe(false);
    expect(withLineWeight(text(), 50, layer).ok).toBe(false);
    expect(withLineWeight({ id: "p", type: "POINT", layer: "A", color: "#fff", position: { x: 0, y: 0 } }, 50, layer).ok).toBe(false);
  });
});

describe("withLineTypeScale", () => {
  it("stores the scale (not 1) and rebuilds the existing dash for it; 1 removes the stored scale", () => {
    const dashed = line({ lineDash: dashes.make("DASHED", 1) });
    const scaled = must(withLineTypeScale(dashed, 3, dashes)).entity;
    expect(scaled.lineTypeScale).toBe(3);
    expect(scaled.type === "LINE" && scaled.lineDash?.key).toBe("DASHED@3");
    const reset = must(withLineTypeScale(scaled, 1, dashes)).entity;
    expect("lineTypeScale" in reset).toBe(false);
    expect(reset.type === "LINE" && reset.lineDash?.key).toBe("DASHED@1");
  });

  it("a solid figure only gets the scale stored; bad scales and text are refused", () => {
    const solid = must(withLineTypeScale(line(), 2, dashes)).entity;
    expect(solid.lineTypeScale).toBe(2);
    for (const bad of [0, -1, Number.NaN, Infinity, 1e-7, 1e7]) expect(withLineTypeScale(line(), bad, dashes).ok, String(bad)).toBe(false);
    expect(withLineTypeScale(text(), 2, dashes).ok).toBe(false);
  });
});
