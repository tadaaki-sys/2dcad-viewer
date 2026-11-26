// 線種表と、線種から破線を作る処理(Phase 17)
import { describe, expect, it } from "vitest";
import { buildLineTypeTable, createDashFactory, dashKeyOf, entityDashScaleOf, lineTypeKeyOf, STANDARD_LINE_TYPES } from "./lineTypes";
import { STANDARD_LINE_WEIGHTS, isStandardLineWeight, lineWeightLabel } from "./lineWeight";
import { BYLAYER_ALL, byLayerMaskOf, followsLayer } from "./byLayer";

describe("buildLineTypeTable", () => {
  it("starts with CONTINUOUS, then the drawing's own linetypes, then the standard ones it did not define", () => {
    const table = buildLineTypeTable([{ name: "Mine", elements: [10, -5] }]);
    expect(table[0]).toEqual({ name: "CONTINUOUS", elements: [] });
    expect(table[1]).toEqual({ name: "Mine", elements: [10, -5] });
    expect(table.map((t) => t.name)).toContain("CENTER");
    expect(table).toHaveLength(1 + 1 + STANDARD_LINE_TYPES.length);
  });

  it("lets the drawing's definition win over a standard one with the same name (case-insensitive), and keeps the drawing's spelling", () => {
    const table = buildLineTypeTable([{ name: "Dashed", elements: [1, -1] }]);
    const found = table.filter((t) => t.name.toUpperCase() === "DASHED");
    expect(found).toEqual([{ name: "Dashed", elements: [1, -1] }]);
  });

  it("ignores duplicates (the first wins), blank names, BYLAYER, BYBLOCK and a second CONTINUOUS", () => {
    const table = buildLineTypeTable([
      { name: "A", elements: [1, -1] },
      { name: "a", elements: [2, -2] },
      { name: "  ", elements: [1, -1] },
      { name: "ByLayer", elements: [] },
      { name: "BYBLOCK", elements: [] },
      { name: "Continuous", elements: [] },
    ]);
    expect(table.filter((t) => ["A", "a"].includes(t.name))).toEqual([{ name: "A", elements: [1, -1] }]);
    expect(table.map((t) => lineTypeKeyOf(t.name))).not.toContain("BYLAYER");
    expect(table.map((t) => lineTypeKeyOf(t.name))).not.toContain("BYBLOCK");
    expect(table.filter((t) => lineTypeKeyOf(t.name) === "CONTINUOUS")).toHaveLength(1);
  });

  it("is idempotent: building from a built table gives the same table (the model round trip relies on it)", () => {
    const once = buildLineTypeTable([{ name: "Mine", elements: [10, -5] }]);
    expect(buildLineTypeTable(once)).toEqual(once);
  });

  it("copies the elements (changing the input afterwards does not change the table)", () => {
    const elements = [3, -3];
    const table = buildLineTypeTable([{ name: "X", elements }]);
    elements[0] = 99;
    expect(table.find((t) => t.name === "X")!.elements).toEqual([3, -3]);
  });
});

describe("createDashFactory", () => {
  const table = buildLineTypeTable([]);

  it("builds a dash from a linetype name, multiplying by the global and the entity scale; the key is NAME@scale", () => {
    const dashes = createDashFactory(table, 2);
    const dash = dashes.make("dashed", 3)!;
    expect(dash.pattern).toEqual([12.7 * 6, 6.35 * 6]);
    expect(dash.key).toBe("DASHED@6");
    expect(dash.name).toBe("DASHED");
  });

  it("gives no dash for CONTINUOUS, undefined and unknown names, and for a pattern that is not a dash", () => {
    const dashes = createDashFactory(table, 1);
    expect(dashes.make(undefined, 1)).toBeUndefined();
    expect(dashes.make("Continuous", 1)).toBeUndefined();
    expect(dashes.make("NO_SUCH", 1)).toBeUndefined();
    expect(dashes.make("", 1)).toBeUndefined();
  });

  it("shares one dash object for the same linetype and scale", () => {
    const dashes = createDashFactory(table, 1);
    expect(dashes.make("HIDDEN", 1)).toBe(dashes.make("hidden", 1));
    expect(dashes.make("HIDDEN", 1)).not.toBe(dashes.make("HIDDEN", 2));
  });

  it("falls back to 1 for a bad global or entity scale (never makes a NaN pattern)", () => {
    for (const bad of [0, -1, Number.NaN, Infinity]) {
      expect(createDashFactory(table, bad).ltScale).toBe(1);
      expect(createDashFactory(table, 1).make("DASHED", bad)!.pattern).toEqual([12.7, 6.35]);
    }
  });
});

describe("entityDashScaleOf", () => {
  it("recovers the entity's own scale from the key (key scale ÷ global scale), without floating point noise", () => {
    const dashes = createDashFactory(buildLineTypeTable([]), 0.1);
    const dash = dashes.make("DASHED", 3)!;
    expect(entityDashScaleOf(dash, 0.1)).toBe(3);
    expect(dashKeyOf("dashed", 0.30000000000000004)).toBe("DASHED@0.30000000000000004");
  });

  it("returns null when the key's name part is not the dash's own name (a custom key that merely contains @)", () => {
    expect(entityDashScaleOf({ key: "custom@2", name: "DASHED", pattern: [1, 1] }, 1)).toBeNull();
    expect(entityDashScaleOf({ key: "DASHED@2", name: "Dashed", pattern: [1, 1] }, 1)).toBe(2);
  });

  it("gives no dash (instead of an Infinity key) when the scales multiply to something not finite or not positive", () => {
    expect(createDashFactory(buildLineTypeTable([]), 2).make("DASHED", 1e308)).toBeUndefined();
    expect(createDashFactory(buildLineTypeTable([]), 1e-200).make("DASHED", 1e-200)).toBeUndefined();
    expect(createDashFactory(buildLineTypeTable([]), 2).make("DASHED", 3)).toBeDefined();
  });

  it("returns null for other kinds of keys (a dimension's dash) and for bad values", () => {
    expect(entityDashScaleOf({ key: "dim:dashed:100", name: "x", pattern: [1, 1] }, 1)).toBeNull();
    expect(entityDashScaleOf({ key: "DASHED@abc", name: "x", pattern: [1, 1] }, 1)).toBeNull();
    expect(entityDashScaleOf({ key: "DASHED@2", name: "x", pattern: [1, 1] }, 0)).toBeNull();
  });
});

describe("line weights and ByLayer marks", () => {
  it("the standard weights are the AutoCAD set; labels show mm", () => {
    expect(STANDARD_LINE_WEIGHTS).toHaveLength(24);
    expect(isStandardLineWeight(25)).toBe(true);
    expect(isStandardLineWeight(26)).toBe(false);
    expect(lineWeightLabel(25)).toBe("0.25 mm");
    expect(lineWeightLabel(211)).toBe("2.11 mm");
  });

  it("a mask outside 0..7, or not an integer, counts as no mark", () => {
    expect(byLayerMaskOf({ byLayer: 7 })).toBe(7);
    for (const bad of [undefined, 0, -1, 8, 1.5, Number.NaN]) expect(byLayerMaskOf({ byLayer: bad })).toBe(0);
    expect(followsLayer({ byLayer: 2 }, 2)).toBe(true);
    expect(followsLayer({ byLayer: 2 }, 1)).toBe(false);
    expect(BYLAYER_ALL).toBe(7);
  });
});
