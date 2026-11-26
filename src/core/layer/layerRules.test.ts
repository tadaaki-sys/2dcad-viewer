// レイヤーの決まりと、ByLayer の見た目の計算(Phase 17)
import { describe, expect, it } from "vitest";
import type { CadEntity, CadLayer } from "../../types/cad";
import { createDashFactory, buildLineTypeTable } from "../style/lineTypes";
import {
  countEntitiesOnLayer,
  layerAppearance,
  rescaleEntityDash,
  restyleEntityToLayer,
  validateLayerColor,
  validateLayerLineType,
  validateLayerLineWeight,
  validateLayerName,
} from "./layerRules";

const table = buildLineTypeTable([]);
const layer = (name: string, extra: Partial<CadLayer> = {}): CadLayer => ({ name, color: "#ff0000", visible: true, ...extra });
const line = (extra: Partial<Extract<CadEntity, { type: "LINE" }>> = {}): CadEntity => ({
  id: "e1",
  type: "LINE",
  layer: "A",
  color: "#ffffff",
  start: { x: 0, y: 0 },
  end: { x: 10, y: 0 },
  ...extra,
});

describe("validateLayerName", () => {
  const layers = [layer("0"), layer("Walls")];

  it("trims the name and accepts ordinary names (including Japanese)", () => {
    expect(validateLayerName("  機械  ", layers)).toEqual({ ok: true, value: "機械" });
  });

  it("rejects an empty name, a too long name, and characters DXF does not allow", () => {
    expect(validateLayerName("   ", layers).ok).toBe(false);
    expect(validateLayerName("a".repeat(256), layers).ok).toBe(false);
    expect(validateLayerName("a".repeat(255), layers).ok).toBe(true);
    for (const bad of ["a<b", "a>b", "a/b", "a\\b", 'a"b', "a:b", "a;b", "a?b", "a*b", "a|b", "a=b", "a`b", "a\u0000b", "a\tb", "a\u007fb"]) {
      expect(validateLayerName(bad, layers).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it("rejects a name that is already used, ignoring case; renaming a layer to its own name or a case variant is allowed", () => {
    expect(validateLayerName("WALLS", layers).ok).toBe(false);
    expect(validateLayerName("walls", layers, "Walls")).toEqual({ ok: true, value: "walls" });
    expect(validateLayerName("0", layers, "Walls").ok).toBe(false);
  });
});

describe("validators for color, linetype and weight", () => {
  it("accepts #rrggbb only, lowercased", () => {
    expect(validateLayerColor("#FFaa00")).toEqual({ ok: true, value: "#ffaa00" });
    for (const bad of ["red", "#fff", "#12345", "#1234567", "ff0000", "#gg0000", ""]) expect(validateLayerColor(bad).ok).toBe(false);
  });

  it("accepts linetype names that are in the table (case-insensitive) and returns the table's spelling", () => {
    expect(validateLayerLineType("hidden", table)).toEqual({ ok: true, value: "HIDDEN" });
    expect(validateLayerLineType("NOPE", table).ok).toBe(false);
  });

  it("accepts only standard weights", () => {
    expect(validateLayerLineWeight(50)).toEqual({ ok: true, value: 50 });
    for (const bad of [-1, 26, 1000, Number.NaN]) expect(validateLayerLineWeight(bad).ok).toBe(false);
  });
});

describe("restyleEntityToLayer", () => {
  const dashes = createDashFactory(table, 1);

  it("returns the same object when the entity follows nothing (ByObject) or when nothing would change", () => {
    const own = line();
    expect(restyleEntityToLayer(own, layer("A", { color: "#00ff00" }), dashes)).toBe(own);
    const same = line({ byLayer: 7, color: "#ff0000" });
    expect(restyleEntityToLayer(same, layer("A"), dashes)).toBe(same);
  });

  it("changes only the attributes that follow the layer", () => {
    const entity = line({ byLayer: 1 | 4, lineDash: { key: "HIDDEN@1", name: "HIDDEN", pattern: [1, 1] } });
    const next = restyleEntityToLayer(entity, layer("A", { color: "#00ff00", lineType: "DASHED", lineWeight: 50 }), dashes) as Extract<CadEntity, { type: "LINE" }>;
    expect(next.color).toBe("#00ff00");
    expect(next.lineWeight).toBe(50);
    expect(next.lineDash).toBe(entity.type === "LINE" ? entity.lineDash : undefined); // 線種は ByLayer でないので、そのまま
    expect(next).not.toBe(entity);
    expect(entity.color).toBe("#ffffff"); // 元の図形は書き換えない
  });

  it("builds the dash from the layer's linetype, drops it for a solid layer, and drops a thin weight", () => {
    const entity = line({ byLayer: 7, lineWeight: 100 });
    const dashed = restyleEntityToLayer(entity, layer("A", { lineType: "CENTER" }), dashes) as Extract<CadEntity, { type: "LINE" }>;
    expect(dashed.lineDash?.name).toBe("CENTER");
    expect("lineWeight" in dashed).toBe(false);
    const solid = restyleEntityToLayer(dashed, layer("A"), dashes) as Extract<CadEntity, { type: "LINE" }>;
    expect("lineDash" in solid).toBe(false);
    const thin = restyleEntityToLayer(line({ byLayer: 4, lineWeight: 100 }), layer("A", { lineWeight: 25 }), dashes);
    expect("lineWeight" in thin).toBe(false);
  });

  it("keeps the entity's own linetype scale when the linetype changes (recovered from the dash key)", () => {
    const scaled = createDashFactory(table, 2).make("DASHED", 3)!; // 鍵 DASHED@6 = 全体 2 × 図形 3
    const entity = line({ byLayer: 2, lineDash: scaled });
    const next = restyleEntityToLayer(entity, layer("A", { lineType: "HIDDEN" }), createDashFactory(table, 2)) as Extract<CadEntity, { type: "LINE" }>;
    expect(next.lineDash?.key).toBe("HIDDEN@6");
  });

  it("a figure's own linetype scale survives a solid layer in between (solid → dashed again keeps the scale)", () => {
    const entity = line({ byLayer: 2, lineTypeScale: 2, lineDash: dashes.make("DASHED", 2)! });
    const solid = restyleEntityToLayer(entity, layer("A"), dashes) as Extract<CadEntity, { type: "LINE" }>;
    expect(solid.lineDash).toBeUndefined();
    expect(solid.lineTypeScale).toBe(2);
    const again = restyleEntityToLayer(solid, layer("A", { lineType: "DASHED" }), dashes) as Extract<CadEntity, { type: "LINE" }>;
    expect(again.lineDash?.key).toBe("DASHED@2");
    // 全体の尺度の変更でも、持っている尺度を使う
    const rescaled = rescaleEntityDash(again, 1, createDashFactory(table, 3)) as Extract<CadEntity, { type: "LINE" }>;
    expect(rescaled.lineDash?.key).toBe("DASHED@6");
  });

  it("the `only` argument limits which attributes are re-evaluated (a color change does not touch the linetype)", () => {
    const entity = line({ byLayer: 7 });
    const next = restyleEntityToLayer(entity, layer("A", { color: "#00ff00", lineType: "CENTER" }), dashes, 1) as Extract<CadEntity, { type: "LINE" }>;
    expect(next.color).toBe("#00ff00");
    expect("lineDash" in next).toBe(false);
  });

  it("text and points follow only the color; a dimension follows color and linetype but has no weight", () => {
    const text: CadEntity = { id: "t", type: "TEXT", layer: "A", color: "#fff", byLayer: 7, position: { x: 0, y: 0 }, text: "x", height: 5, rotation: 0, horizontalAlign: "left", verticalAlign: "baseline" };
    const next = restyleEntityToLayer(text, layer("A", { lineType: "CENTER", lineWeight: 50 }), dashes) as Record<string, unknown>;
    expect(next.color).toBe("#ff0000");
    expect("lineDash" in next).toBe(false);
    expect("lineWeight" in next).toBe(false);
    const dimension = {
      id: "d", type: "DIMENSION", layer: "A", color: "#fff", byLayer: 7, kind: "linear", p1: { x: 0, y: 0 }, p2: { x: 1, y: 0 }, position: { x: 0, y: 1 },
      values: { textHeight: 1, arrowSize: 1, decimals: 0, angleDecimals: 0, unit: "mm", showUnit: false, extensionOffset: 0 },
    } as CadEntity;
    const dim = restyleEntityToLayer(dimension, layer("A", { lineType: "CENTER", lineWeight: 50 }), dashes) as Record<string, unknown>;
    expect((dim.lineDash as { name: string }).name).toBe("CENTER");
    expect("lineWeight" in dim).toBe(false);
  });
});

describe("rescaleEntityDash", () => {
  it("rebuilds `NAME@scale` dashes for the new global scale, keeping the entity's own scale", () => {
    const old = createDashFactory(table, 1);
    const entity = line({ lineDash: old.make("DASHED", 3)! });
    const next = rescaleEntityDash(entity, 1, createDashFactory(table, 2)) as Extract<CadEntity, { type: "LINE" }>;
    expect(next.lineDash?.key).toBe("DASHED@6");
    expect(next.lineDash?.pattern).toEqual([12.7 * 6, 6.35 * 6]);
  });

  it("uses the figure's own scale even when the old dash key cannot give it back", () => {
    const entity = line({ lineTypeScale: 2, lineDash: { key: "legacy", name: "DASHED", pattern: [1, 1] } });
    const next = rescaleEntityDash(entity, 1, createDashFactory(table, 3)) as Extract<CadEntity, { type: "LINE" }>;
    expect(next.lineDash?.key).toBe("DASHED@6");
  });

  it("leaves entities without a dash, with another kind of key, or with an unchanged key alone", () => {
    const dashes = createDashFactory(table, 2);
    const plain = line();
    expect(rescaleEntityDash(plain, 1, dashes)).toBe(plain);
    const other = line({ lineDash: { key: "dim:dashed:100", name: "DASHED", pattern: [1, 1] } });
    expect(rescaleEntityDash(other, 1, dashes)).toBe(other);
    const unchanged = line({ lineDash: dashes.make("DASHED", 1)! });
    expect(rescaleEntityDash(unchanged, 2, dashes)).toBe(unchanged);
  });
});

describe("layerAppearance and countEntitiesOnLayer", () => {
  it("gives the layer's color, dash and (non-thin) weight as resolved values", () => {
    const dashes = createDashFactory(table, 1);
    expect(layerAppearance(layer("A"), dashes)).toEqual({ color: "#ff0000" });
    const a = layerAppearance(layer("A", { lineType: "HIDDEN", lineWeight: 50 }), dashes);
    expect(a.lineDash?.name).toBe("HIDDEN");
    expect(a.lineWeight).toBe(50);
    expect(layerAppearance(layer("A", { lineWeight: 25 }), dashes)).toEqual({ color: "#ff0000" });
  });

  it("counts the entities on a layer", () => {
    expect(countEntitiesOnLayer([line(), line({ layer: "B" }), line()], "A")).toBe(2);
    expect(countEntitiesOnLayer([], "A")).toBe(0);
  });
});
