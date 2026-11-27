// プロパティ欄からの、値(座標・半径・角度・文字の高さ・回転)の編集(Phase 18)
import { describe, expect, it } from "vitest";
import type { CadEntity } from "../../types/cad";
import { geometryFieldsOf, geometryValueOf, withGeometryValue } from "./propertyGeometry";
import type { GeometryField } from "./propertyGeometry";

const base = { layer: "0", color: "#fff" };
const line = (): CadEntity => ({ ...base, id: "l", type: "LINE", start: { x: 0, y: 0 }, end: { x: 10, y: 0 } });
const circle = (): CadEntity => ({ ...base, id: "c", type: "CIRCLE", center: { x: 1, y: 2 }, radius: 5 });
const arc = (): CadEntity => ({ ...base, id: "a", type: "ARC", center: { x: 0, y: 0 }, radius: 10, startAngle: 0, endAngle: Math.PI / 2 });
const text = (): CadEntity => ({ ...base, id: "t", type: "TEXT", position: { x: 3, y: 4 }, text: "x", height: 2, rotation: Math.PI / 2, horizontalAlign: "left", verticalAlign: "baseline" });
const point = (): CadEntity => ({ ...base, id: "p", type: "POINT", position: { x: 7, y: 8 } });

const set = (entity: CadEntity, field: GeometryField, value: number) => withGeometryValue(entity, field, value);
const ok = (entity: CadEntity, field: GeometryField, value: number): CadEntity => {
  const edit = set(entity, field, value);
  if (!edit.ok) throw new Error(edit.error);
  return edit.entity;
};

describe("fields and current values", () => {
  it("each figure has its own fields; the others have none; angles read in degrees", () => {
    expect(geometryFieldsOf(line())).toEqual(["startX", "startY", "endX", "endY"]);
    expect(geometryFieldsOf(arc())).toContain("endAngle");
    expect(geometryFieldsOf({ ...base, id: "s", type: "SPLINE", points: [], closed: false })).toEqual([]);
    expect(geometryValueOf(arc(), "endAngle")).toBeCloseTo(90);
    expect(geometryValueOf(text(), "rotation")).toBeCloseTo(90);
    expect(geometryValueOf(circle(), "startAngle")).toBeNull();
    for (const e of [line(), circle(), arc(), text(), point()]) for (const f of geometryFieldsOf(e)) expect(geometryValueOf(e, f), `${e.type} ${f}`).not.toBeNull();
  });
});

describe("withGeometryValue", () => {
  it("changes exactly one value", () => {
    const l = ok(line(), "endY", 5);
    expect(l.type === "LINE" && [l.start, l.end]).toEqual([{ x: 0, y: 0 }, { x: 10, y: 5 }]);
    const c = ok(circle(), "radius", 9);
    expect(c.type === "CIRCLE" && [c.center, c.radius]).toEqual([{ x: 1, y: 2 }, 9]);
    const t = ok(text(), "rotation", 180);
    expect(t.type === "TEXT" && t.rotation).toBeCloseTo(Math.PI);
    expect(t.type === "TEXT" && [t.position, t.height]).toEqual([{ x: 3, y: 4 }, 2]);
    const p = ok(point(), "positionX", -1);
    expect(p.type === "POINT" && p.position).toEqual({ x: -1, y: 8 });
  });

  it("arc angles are set in degrees and normalized; equal or full-circle angles are refused", () => {
    const a = ok(arc(), "startAngle", -90);
    expect(a.type === "ARC" && a.startAngle).toBeCloseTo((3 * Math.PI) / 2);
    expect(set(arc(), "endAngle", 0).ok).toBe(false);
    expect(set(arc(), "endAngle", 360).ok).toBe(false);
    expect(set(arc(), "startAngle", 90).ok).toBe(false);
  });

  it("refuses non-finite values, huge coordinates, unusable radii and heights, a zero-length line, and fields the figure does not have", () => {
    for (const bad of [Number.NaN, Infinity, -Infinity]) expect(set(line(), "endX", bad).ok).toBe(false);
    expect(set(line(), "endX", 1e16).ok).toBe(false);
    expect(set(circle(), "radius", 0).ok).toBe(false);
    expect(set(circle(), "radius", 1e10).ok).toBe(false);
    expect(set(circle(), "radius", -3).ok).toBe(false);
    expect(set(text(), "height", 0).ok).toBe(false);
    expect(set(text(), "height", 1e10).ok).toBe(false);
    expect(set(line(), "endX", 5).ok).toBe(true);
    const zero: CadEntity = { ...base, id: "z", type: "LINE", start: { x: 0, y: 0 }, end: { x: 0, y: 5 } };
    expect(set(zero, "endY", 0).ok).toBe(false);
    expect(set(circle(), "startAngle", 10).ok).toBe(false);
    expect(set(point(), "radius", 1).ok).toBe(false);
  });

  it("refuses an angle so large that converting it to radians overflows (no NaN / Infinity is ever stored)", () => {
    expect(set(arc(), "startAngle", 1e308).ok).toBe(false);
    expect(set(arc(), "endAngle", -1e308).ok).toBe(false);
    expect(set(text(), "rotation", 1e308).ok).toBe(false);
    // 大きいが、桁あふれしない角度は、そろえて、有限の値になる
    const turned = set(text(), "rotation", 3600 * 1000 + 90);
    expect(turned.ok && turned.entity.type === "TEXT" && Number.isFinite(turned.entity.rotation)).toBe(true);
  });

  it("does not change the original", () => {
    const original = text();
    const copy = JSON.stringify(original);
    ok(original, "height", 9);
    expect(JSON.stringify(original)).toBe(copy);
  });
});
