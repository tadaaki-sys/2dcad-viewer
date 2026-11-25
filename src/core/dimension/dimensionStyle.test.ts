// 寸法スタイル(値の確認・一覧の操作・保存された値の読み込み・線種)と、寸法を作る点の決め方(Phase 15)
import { describe, expect, it } from "vitest";
import {
  addDimensionStyle,
  currentDimensionStyle,
  DEFAULT_DIMENSION_STYLE,
  defaultDimensionStyleTable,
  deleteDimensionStyle,
  dimensionLineDash,
  DIMENSION_STYLE_LIMITS,
  dimensionValuesOf,
  normalizeDimensionStyleTable,
  renameDimensionStyle,
  setCurrentDimensionStyle,
  updateDimensionStyle,
  validateDimensionStyle,
} from "./dimensionStyle";
import type { DimensionStyle, DimensionStyleResult, DimensionStyleTable } from "./dimensionStyle";
import { angularFromLines, intersectionOfLines, pointOnCircleToward } from "./dimensionConstruct";

const style = (patch: Partial<DimensionStyle> = {}): DimensionStyle => ({ ...DEFAULT_DIMENSION_STYLE, name: "Note", ...patch });

function ok(result: DimensionStyleResult): DimensionStyleTable {
  if (!result.ok) throw new Error(result.message);
  return result.table;
}

describe("validateDimensionStyle", () => {
  it("accepts the standard style and ordinary values", () => {
    expect(validateDimensionStyle(DEFAULT_DIMENSION_STYLE)).toBeNull();
    expect(validateDimensionStyle(style({ color: "#00FF7f", layer: "DIM", linetype: "center", unit: "m", showUnit: true, decimals: 8, angleDecimals: 0, extensionOffset: 0 }))).toBeNull();
  });

  it("refuses names, sizes, decimals, units, colors, layers and linetypes that are out of range", () => {
    expect(validateDimensionStyle(style({ name: "" }))).not.toBeNull();
    expect(validateDimensionStyle(style({ name: " x" }))).not.toBeNull();
    expect(validateDimensionStyle(style({ name: "x".repeat(DIMENSION_STYLE_LIMITS.maxNameLength + 1) }))).not.toBeNull();
    for (const textHeight of [0, -1, Number.NaN, Infinity, 1e7]) expect(validateDimensionStyle(style({ textHeight }))).toContain("文字の高さ");
    for (const arrowSize of [0, -1, Number.NaN, 1e7]) expect(validateDimensionStyle(style({ arrowSize }))).toContain("矢印");
    for (const extensionOffset of [-1, Number.NaN, 1e7]) expect(validateDimensionStyle(style({ extensionOffset }))).toContain("補助線");
    for (const decimals of [-1, 9, 1.5, Number.NaN]) {
      expect(validateDimensionStyle(style({ decimals }))).toContain("小数桁");
      expect(validateDimensionStyle(style({ angleDecimals: decimals }))).toContain("角度の小数桁");
    }
    expect(validateDimensionStyle(style({ unit: "km" as never }))).not.toBeNull();
    expect(validateDimensionStyle(style({ showUnit: "yes" as never }))).not.toBeNull();
    for (const color of ["red", "#fff", "#gggggg", "#1234567", ""]) expect(validateDimensionStyle(style({ color }))).toContain("色");
    expect(validateDimensionStyle(style({ layer: "" }))).not.toBeNull();
    expect(validateDimensionStyle(style({ layer: "L".repeat(DIMENSION_STYLE_LIMITS.maxLayerLength + 1) }))).not.toBeNull();
    expect(validateDimensionStyle(style({ linetype: "wavy" as never }))).not.toBeNull();
  });
});

describe("the style table", () => {
  it("starts with Standard; add makes the new style current; the limit is enforced", () => {
    const table = ok(addDimensionStyle(defaultDimensionStyleTable(), style({ textHeight: 200 })));
    expect(table.current).toBe("Note");
    expect(currentDimensionStyle(table).textHeight).toBe(200);
    expect(addDimensionStyle(table, style()).ok).toBe(false);
    expect(addDimensionStyle(table, style({ name: "Bad", textHeight: 0 })).ok).toBe(false);
    let full = defaultDimensionStyleTable();
    for (let i = 1; i < DIMENSION_STYLE_LIMITS.maxStyles; i++) full = ok(addDimensionStyle(full, style({ name: `S${i}` })));
    expect(full.styles).toHaveLength(DIMENSION_STYLE_LIMITS.maxStyles);
    expect(addDimensionStyle(full, style({ name: "One too many" })).ok).toBe(false);
  });

  it("update keeps the name, validates the values and leaves other styles alone", () => {
    const table = ok(addDimensionStyle(defaultDimensionStyleTable(), style()));
    const updated = ok(updateDimensionStyle(table, "Note", { decimals: 2, color: "#ff0000" }));
    expect(updated.styles.find((s) => s.name === "Note")).toMatchObject({ decimals: 2, color: "#ff0000" });
    expect(updated.styles.find((s) => s.name === "Standard")).toEqual(DEFAULT_DIMENSION_STYLE);
    expect(updateDimensionStyle(table, "Note", { decimals: 99 }).ok).toBe(false);
    expect(updateDimensionStyle(table, "Missing", {}).ok).toBe(false);
    // Standard の値は、変えられる
    expect(ok(updateDimensionStyle(table, "Standard", { textHeight: 150 })).styles[0].textHeight).toBe(150);
  });

  it("rename and delete: Standard is protected, the current style follows a rename, deleting the current style returns to Standard", () => {
    const table = ok(addDimensionStyle(defaultDimensionStyleTable(), style()));
    expect(renameDimensionStyle(table, "Standard", "X").ok).toBe(false);
    expect(deleteDimensionStyle(table, "Standard").ok).toBe(false);
    const renamed = ok(renameDimensionStyle(table, "Note", "Memo"));
    expect(renamed.current).toBe("Memo");
    expect(renameDimensionStyle(table, "Note", "Standard").ok).toBe(false);
    expect(renameDimensionStyle(table, "Note", " bad").ok).toBe(false);
    expect(renameDimensionStyle(table, "Missing", "A").ok).toBe(false);
    const deleted = ok(deleteDimensionStyle(table, "Note"));
    expect(deleted.current).toBe("Standard");
    expect(deleted.styles).toHaveLength(1);
    expect(deleteDimensionStyle(table, "Missing").ok).toBe(false);
  });

  it("switching the current style needs an existing name", () => {
    const table = ok(addDimensionStyle(defaultDimensionStyleTable(), style()));
    expect(ok(setCurrentDimensionStyle(table, "Standard")).current).toBe("Standard");
    expect(setCurrentDimensionStyle(table, "Missing").ok).toBe(false);
  });
});

describe("normalizeDimensionStyleTable (saved values cannot be trusted)", () => {
  it("falls back to the default for non-objects", () => {
    for (const raw of [null, undefined, 5, "x", [], { styles: "no" }]) expect(normalizeDimensionStyleTable(raw)).toEqual(defaultDimensionStyleTable());
  });

  it("keeps valid styles, drops invalid and duplicate ones, and adds Standard when it is missing", () => {
    const table = normalizeDimensionStyleTable({
      styles: [style({ name: "A" }), { name: "B", textHeight: "tall" }, style({ name: "A", textHeight: 999 }), null, 5, style({ name: "C", color: "red" })],
      current: "A",
    });
    expect(table.styles.map((s) => s.name)).toEqual(["Standard", "A"]);
    expect(table.current).toBe("A");
    expect(table.styles[1].textHeight).toBe(DEFAULT_DIMENSION_STYLE.textHeight);
  });

  it("an unknown current style returns to Standard", () => {
    expect(normalizeDimensionStyleTable({ styles: [DEFAULT_DIMENSION_STYLE], current: "Gone" }).current).toBe("Standard");
  });

  it("never exceeds the limit, even when Standard has to be added", () => {
    const styles = Array.from({ length: DIMENSION_STYLE_LIMITS.maxStyles + 50 }, (_, i) => style({ name: `S${i}` }));
    const table = normalizeDimensionStyleTable({ styles });
    expect(table.styles).toHaveLength(DIMENSION_STYLE_LIMITS.maxStyles);
    expect(table.styles[0].name).toBe("Standard");
  });

  it("reads only a bounded number of entries", () => {
    const junk = Array.from({ length: 100_000 }, () => null);
    const started = Date.now();
    expect(normalizeDimensionStyleTable({ styles: [...junk, style({ name: "Late" })] }).styles.map((s) => s.name)).toEqual(["Standard"]);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe("what a dimension takes from the style", () => {
  it("copies the sizes, decimals, unit and offset (not the color, layer or linetype)", () => {
    const values = dimensionValuesOf(style({ textHeight: 123, arrowSize: 45, decimals: 3, angleDecimals: 2, unit: "cm", showUnit: true, extensionOffset: 7, color: "#ff0000", layer: "DIM", linetype: "dashed" }));
    expect(values).toEqual({ textHeight: 123, arrowSize: 45, decimals: 3, angleDecimals: 2, unit: "cm", showUnit: true, extensionOffset: 7 });
  });

  it("builds a dash pattern from the linetype, scaled by the text height; continuous has none", () => {
    expect(dimensionLineDash("continuous", 100)).toBeUndefined();
    const dashed = dimensionLineDash("dashed", 100);
    expect(dashed?.name).toBe("破線");
    expect(dashed?.pattern).toEqual([480, 240]);
    // 同じ線種・高さは、同じ key(描画で、まとめて描く)
    expect(dimensionLineDash("dashed", 100)?.key).toBe(dashed?.key);
    expect(dimensionLineDash("dashed", 200)?.key).not.toBe(dashed?.key);
    expect(dimensionLineDash("center", 100)?.pattern).toHaveLength(4);
    expect(dimensionLineDash("phantom", 100)?.pattern).toHaveLength(6);
    expect(dimensionLineDash("phantom", 2.5)?.pattern[0]).toBe(25);
  });
});

describe("how the defining points are found", () => {
  it("a point on the circle toward the clicked point; the center falls back to +X", () => {
    expect(pointOnCircleToward({ x: 10, y: 10 }, 5, { x: 10, y: 99 })).toEqual({ x: 10, y: 15 });
    const diagonal = pointOnCircleToward({ x: 0, y: 0 }, 10, { x: 3, y: 4 });
    expect(diagonal.x).toBeCloseTo(6);
    expect(diagonal.y).toBeCloseTo(8);
    expect(pointOnCircleToward({ x: 10, y: 10 }, 5, { x: 10, y: 10 })).toEqual({ x: 15, y: 10 });
  });

  it("the intersection of two lines (extended); parallel, nearly parallel and zero-length lines have none", () => {
    const p = intersectionOfLines({ start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }, { start: { x: 20, y: 5 }, end: { x: 20, y: 9 } });
    expect(p?.x).toBeCloseTo(20);
    expect(p?.y).toBeCloseTo(0);
    expect(intersectionOfLines({ start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }, { start: { x: 0, y: 5 }, end: { x: 10, y: 5 } })).toBeNull();
    expect(intersectionOfLines({ start: { x: 0, y: 0 }, end: { x: 1e6, y: 0 } }, { start: { x: 0, y: 1 }, end: { x: 1e6, y: 1.001 } })).toBeNull();
    expect(intersectionOfLines({ start: { x: 0, y: 0 }, end: { x: 0, y: 0 } }, { start: { x: 0, y: 5 }, end: { x: 10, y: 5 } })).toBeNull();
  });

  it("angular from two lines: the wedge containing the position decides the arms", () => {
    const horizontal = { start: { x: 0, y: 0 }, end: { x: 1000, y: 0 } };
    const vertical = { start: { x: 0, y: 0 }, end: { x: 0, y: 1000 } };
    const first = angularFromLines(horizontal, vertical, { x: 300, y: 300 });
    expect(first).toMatchObject({ ok: true, vertex: { x: 0, y: 0 }, arm1: { x: 1000, y: 0 }, arm2: { x: 0, y: 1000 } });
    // 反対側(第3象限): 腕は、線の反対側へ。線は頂点から先に伸びていないので、わずかな長さにする
    const opposite = angularFromLines(horizontal, vertical, { x: -300, y: -300 });
    if (!opposite.ok) throw new Error(opposite.reason);
    expect(opposite.arm1.x).toBeLessThan(0);
    expect(opposite.arm2.y).toBeLessThan(0);
    // 第2象限
    const second = angularFromLines(horizontal, vertical, { x: -300, y: 300 });
    if (!second.ok) throw new Error(second.reason);
    expect(second.arm1.x).toBeLessThan(0);
    expect(second.arm2.y).toBeGreaterThan(0);
    // 平行
    expect(angularFromLines(horizontal, { start: { x: 0, y: 9 }, end: { x: 5, y: 9 } }, { x: 1, y: 1 }).ok).toBe(false);
  });

  it("angular from two lines meeting away from both lines: the arms reach the far end along the ray", () => {
    const a = { start: { x: 100, y: 0 }, end: { x: 400, y: 0 } };
    const b = { start: { x: 0, y: 100 }, end: { x: 0, y: 500 } };
    const result = angularFromLines(a, b, { x: 50, y: 50 });
    if (!result.ok) throw new Error(result.reason);
    expect(result.vertex.x).toBeCloseTo(0);
    expect(result.arm1.x).toBeCloseTo(400);
    expect(result.arm2.y).toBeCloseTo(500);
  });
});
