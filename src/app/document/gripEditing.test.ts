// グリップ・頂点・プロパティによる編集の適用(Phase 18): Undo・取り込んだ図形の印・連動寸法の追従・編集できない図形
import { describe, expect, it } from "vitest";
import { createDocument } from "../../core/model";
import { createDashFactory, buildLineTypeTable } from "../../core/style/lineTypes";
import type { CadDimension, CadEntity, CadLayer, Point2D } from "../../types/cad";
import { createEditability } from "./editability";
import { DocumentSession } from "./documentSession";
import { addVertexAt, deleteVertexAt, moveGrip, setGeometryProperty, setPolylinesClosed } from "./gripEditing";
import { setStyleProperty } from "./propertyEditing";

const pt = (x: number, y: number): Point2D => ({ x, y });
const LAYERS: CadLayer[] = [
  { name: "0", color: "#ffffff", visible: true },
  { name: "A", color: "#ff0000", visible: true, lineType: "HIDDEN", lineWeight: 50 },
];
const line = (id: string, extra: Record<string, unknown> = {}): CadEntity => ({ id, type: "LINE", layer: "A", color: "#ff0000", start: pt(0, 0), end: pt(100, 0), ...extra }) as CadEntity;
const poly = (id: string, closed = false): CadEntity => ({ id, type: "LWPOLYLINE", layer: "A", color: "#ff0000", vertices: [pt(0, 0), pt(100, 0), pt(100, 100), pt(0, 100)], closed });

function setup(entities: CadEntity[]) {
  const session = new DocumentSession(createDocument({ layers: LAYERS, entities }));
  return { session, editability: createEditability(null) };
}
const get = (session: DocumentSession, id: string) => session.document.entities.find((e) => e.id === id)!;

describe("moveGrip", () => {
  it("moves a line end as ONE undo step; Undo restores the very same object; no source record on a new figure", () => {
    const original = line("n0");
    const { session, editability } = setup([original]);
    const result = moveGrip(session, editability, "n0", 1, pt(100, 40));
    expect(result.ok).toBe(true);
    const moved = get(session, "n0");
    expect(moved.type === "LINE" && moved.end).toEqual(pt(100, 40));
    expect("sourceRecord" in moved).toBe(false);
    expect(session.isDirty).toBe(true);
    session.undo();
    expect(get(session, "n0")).toBe(original);
    expect(session.canUndo).toBe(false);
  });

  it("a whole-figure grip (circle center) composes the move into the source record of an imported figure; a reshaping grip marks it reshaped", () => {
    const { session } = setup([]);
    const imported = createDocument({ layers: LAYERS, entities: [{ id: "e0", type: "CIRCLE", layer: "A", color: "#f00", center: pt(0, 0), radius: 5 }, line("e1")] });
    const s = new DocumentSession(imported);
    const editability = createEditability({ importedIndexById: new Map([["e0", 0], ["e1", 1]]), nested: Uint8Array.from([0, 0]), parserIndex: Int32Array.from([0, 1]) });
    expect(moveGrip(s, editability, "e0", 0, pt(10, 0)).ok).toBe(true);
    expect(get(s, "e0").sourceRecord).toEqual({ id: "e0", matrix: [1, 0, 0, 1, 10, 0] });
    expect(moveGrip(s, editability, "e1", 1, pt(100, 30)).ok).toBe(true);
    expect(get(s, "e1").sourceRecord).toMatchObject({ id: "e1", reshaped: true });
    void session;
  });

  it("refuses what cannot be edited, an unknown figure, and bad moves, changing nothing", () => {
    const { session } = setup([line("n0")]);
    const ro = createEditability(null); // 取り込んだ図形は編集できない(対応づけなし)
    const imported = new DocumentSession(createDocument({ layers: LAYERS, entities: [line("e0")] }));
    expect(moveGrip(imported, ro, "e0", 0, pt(1, 1)).ok).toBe(false);
    expect(moveGrip(session, createEditability(null), "zz", 0, pt(1, 1)).ok).toBe(false);
    expect(moveGrip(session, createEditability(null), "n0", 0, pt(100, 0)).ok).toBe(false); // 始点と終点が同じ
    expect(moveGrip(session, createEditability(null), "n0", 0, pt(Number.NaN, 0)).ok).toBe(false);
    expect(session.canUndo).toBe(false);
  });

  it("a connected dimension follows a grip move of its line in the SAME undo step", () => {
    const dimension: CadDimension = {
      id: "n1",
      type: "DIMENSION",
      layer: "A",
      color: "#ff0000",
      kind: "linear",
      rotation: 0,
      p1: pt(0, 0),
      p2: pt(100, 0),
      position: pt(50, 40),
      values: { textHeight: 10, arrowSize: 10, decimals: 0, angleDecimals: 1, unit: "mm", showUnit: false, extensionOffset: 5 },
      refs: [{ slot: "p2", id: "n0", anchor: { kind: "end" } }],
    };
    const { session, editability } = setup([line("n0"), dimension]);
    expect(moveGrip(session, editability, "n0", 1, pt(150, 0)).ok).toBe(true);
    expect((get(session, "n1") as CadDimension).p2).toEqual(pt(150, 0));
    session.undo();
    expect((get(session, "n1") as CadDimension).p2).toEqual(pt(100, 0));
    expect(session.canUndo).toBe(false);
  });

  it("moving the dimension's own grip releases the link for that point (existing rule)", () => {
    const dimension: CadDimension = {
      id: "n1",
      type: "DIMENSION",
      layer: "A",
      color: "#ff0000",
      kind: "linear",
      rotation: 0,
      p1: pt(0, 0),
      p2: pt(100, 0),
      position: pt(50, 40),
      values: { textHeight: 10, arrowSize: 10, decimals: 0, angleDecimals: 1, unit: "mm", showUnit: false, extensionOffset: 5 },
      refs: [{ slot: "p2", id: "n0", anchor: { kind: "end" } }],
    };
    const { session, editability } = setup([line("n0"), dimension]);
    expect(moveGrip(session, editability, "n1", 1, pt(120, 0)).ok).toBe(true);
    expect((get(session, "n1") as CadDimension).refs).toBeUndefined();
    expect(session.takeNotice()).toContain("解除");
  });
});

describe("vertex editing", () => {
  it("adds a vertex, deletes one, closes and opens; each is one undo step and Undo restores the same object", () => {
    const original = poly("n0");
    const { session, editability } = setup([original]);
    expect(addVertexAt(session, editability, "n0", pt(50, 3)).ok).toBe(true);
    expect((get(session, "n0") as Extract<CadEntity, { type: "LWPOLYLINE" | "POLYLINE" }>).vertices).toHaveLength(5);
    expect(deleteVertexAt(session, editability, "n0", pt(100, 100), 5).ok).toBe(true);
    expect(setPolylinesClosed(session, editability, ["n0"], true).ok).toBe(true);
    expect((get(session, "n0") as Extract<CadEntity, { type: "LWPOLYLINE" | "POLYLINE" }>).closed).toBe(true);
    session.undo();
    session.undo();
    session.undo();
    expect(get(session, "n0")).toBe(original);
    expect(session.canUndo).toBe(false);
  });

  it("vertex edits of an imported polyline mark it reshaped (the source record is rewritten as it is now)", () => {
    const imported = new DocumentSession(createDocument({ layers: LAYERS, entities: [poly("e0")] }));
    const e = createEditability({ importedIndexById: new Map([["e0", 0]]), nested: Uint8Array.from([0]), parserIndex: Int32Array.from([0]) });
    expect(addVertexAt(imported, e, "e0", pt(50, 2)).ok).toBe(true);
    expect(get(imported, "e0").sourceRecord).toMatchObject({ id: "e0", reshaped: true });
    expect(setPolylinesClosed(imported, e, ["e0"], true).ok).toBe(true);
    expect(get(imported, "e0").sourceRecord).toMatchObject({ reshaped: true });
  });

  it("refuses to delete below the minimum or far from every vertex, and closing an already closed polyline", () => {
    const { session, editability } = setup([poly("n0", true), { id: "n1", type: "LWPOLYLINE", layer: "A", color: "#f00", vertices: [pt(0, 0), pt(5, 0)], closed: false }]);
    expect(deleteVertexAt(session, editability, "n0", pt(50, 0), 5).ok).toBe(false);
    expect(setPolylinesClosed(session, editability, ["n0"], true).ok).toBe(false);
    expect(deleteVertexAt(session, editability, "n1", pt(0, 0), 5).ok).toBe(false);
    expect(session.canUndo).toBe(false);
  });

  it("closing several polylines is one step, and figures that cannot be closed are left out with a note", () => {
    const { session, editability } = setup([poly("n0"), poly("n1"), line("n2")]);
    const result = setPolylinesClosed(session, editability, ["n0", "n1", "n2"], true);
    expect(result.ok).toBe(true);
    expect(result.message).toContain("2個");
    expect(result.message).toContain("対象外");
    session.undo();
    expect(session.canUndo).toBe(false);
  });
});

describe("setGeometryProperty", () => {
  it("changes one value as one undo step; imported figures are marked reshaped", () => {
    const { session, editability } = setup([line("n0")]);
    expect(setGeometryProperty(session, editability, "n0", "endX", 120).ok).toBe(true);
    expect((get(session, "n0") as Extract<CadEntity, { type: "LINE" }>).end.x).toBe(120);
    session.undo();
    expect(session.canUndo).toBe(false);
    const imported = new DocumentSession(createDocument({ layers: LAYERS, entities: [line("e0")] }));
    const e = createEditability({ importedIndexById: new Map([["e0", 0]]), nested: Uint8Array.from([0]), parserIndex: Int32Array.from([0]) });
    expect(setGeometryProperty(imported, e, "e0", "endY", 5).ok).toBe(true);
    expect(get(imported, "e0").sourceRecord).toMatchObject({ id: "e0", reshaped: true });
  });

  it("writing the value it already has (even as 1.0 for 1) changes nothing: no undo step, no reshaped mark", () => {
    const imported = new DocumentSession(createDocument({ layers: LAYERS, entities: [line("e0")] }));
    const e = createEditability({ importedIndexById: new Map([["e0", 0]]), nested: Uint8Array.from([0]), parserIndex: Int32Array.from([0]) });
    const result = setGeometryProperty(imported, e, "e0", "endX", 100.0000000000001);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("値が変わりません");
    expect(get(imported, "e0").sourceRecord).toBeUndefined();
    expect(imported.canUndo).toBe(false);
  });

  it("refuses a bad value with a reason and changes nothing", () => {
    const { session, editability } = setup([line("n0")]);
    const result = setGeometryProperty(session, editability, "n0", "endX", Number.NaN);
    expect(result.ok).toBe(false);
    expect(setGeometryProperty(session, editability, "n0", "radius", 5).ok).toBe(false);
    expect(session.canUndo).toBe(false);
  });
});

describe("setStyleProperty", () => {
  const dashes = createDashFactory(buildLineTypeTable([]), 1);
  void dashes;

  it("changes the color of several figures in one step; figures already at that color are counted and left alone; Undo restores them", () => {
    const originals = [line("n0"), line("n1", { color: "#0000ff", byLayer: 6 }), line("n2")];
    const { session, editability } = setup(originals);
    const result = setStyleProperty(session, editability, ["n0", "n1", "n2"], { kind: "color", value: "#0000ff" });
    expect(result.ok).toBe(true);
    expect(result.message).toContain("2個");
    expect(result.message).toContain("すでに同じ");
    expect(get(session, "n1")).toBe(originals[1]);
    session.undo();
    expect(originals.every((o) => get(session, o.id) === o)).toBe(true);
    expect(session.canUndo).toBe(false);
  });

  it("an own linetype / weight / ByLayer round trip; the layer's settings are used for ByLayer", () => {
    const { session, editability } = setup([line("n0")]);
    expect(setStyleProperty(session, editability, ["n0"], { kind: "lineType", value: "CENTER" }).ok).toBe(true);
    expect((get(session, "n0") as Extract<CadEntity, { type: "LINE" }>).lineDash?.name).toBe("CENTER");
    expect(setStyleProperty(session, editability, ["n0"], { kind: "lineType", value: "bylayer" }).ok).toBe(true);
    expect((get(session, "n0") as Extract<CadEntity, { type: "LINE" }>).lineDash?.name).toBe("HIDDEN");
    expect(setStyleProperty(session, editability, ["n0"], { kind: "lineWeight", value: 100 }).ok).toBe(true);
    expect((get(session, "n0") as Extract<CadEntity, { type: "LINE" }>).lineWeight).toBe(100);
    expect(setStyleProperty(session, editability, ["n0"], { kind: "lineWeight", value: "bylayer" }).ok).toBe(true);
    expect((get(session, "n0") as Extract<CadEntity, { type: "LINE" }>).lineWeight).toBe(50);
  });

  it("a layer edit afterwards leaves an own-attribute figure alone and moves a ByLayer one (the marks are right)", () => {
    const { session, editability } = setup([line("n0", { byLayer: 7 }), line("n1", { byLayer: 7 })]);
    setStyleProperty(session, editability, ["n1"], { kind: "color", value: "#123456" });
    expect((get(session, "n1").byLayer ?? 0) & 1).toBe(0);
    expect((get(session, "n0").byLayer ?? 0) & 1).toBe(1);
  });

  it("refuses unknown linetypes, bad colors, text for linetype (counted), and reports 'already that setting'", () => {
    const text: CadEntity = { id: "n3", type: "TEXT", layer: "A", color: "#ff0000", position: pt(0, 0), text: "x", height: 3, rotation: 0, horizontalAlign: "left", verticalAlign: "baseline" };
    const { session, editability } = setup([line("n0"), text]);
    expect(setStyleProperty(session, editability, ["n0"], { kind: "lineType", value: "NOPE" }).ok).toBe(false);
    expect(setStyleProperty(session, editability, ["n0"], { kind: "color", value: "blue" }).ok).toBe(false);
    expect(setStyleProperty(session, editability, ["n3"], { kind: "lineType", value: "CENTER" }).ok).toBe(false);
    expect(setStyleProperty(session, editability, ["n0"], { kind: "color", value: "#ff0000" }).message).toContain("すでに");
    const mixed = setStyleProperty(session, editability, ["n0", "n3"], { kind: "lineType", value: "CENTER" });
    expect(mixed.ok).toBe(true);
    expect(mixed.message).toContain("持てない設定のため除きました");
  });

  it("a figure on a layer that is not in the layer table is refused with the reason (it cannot be resolved)", () => {
    const orphan = line("n0", { layer: "MISSING" });
    const { session, editability } = setup([orphan]);
    const result = setStyleProperty(session, editability, ["n0"], { kind: "color", value: "bylayer" });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("MISSING");
    expect(get(session, "n0")).toBe(orphan);
  });

  it("figures that cannot be edited are left out with the reason", () => {
    const { session } = setup([line("n0")]);
    const imported = new DocumentSession(createDocument({ layers: LAYERS, entities: [line("e0")] }));
    const result = setStyleProperty(imported, createEditability(null), ["e0"], { kind: "color", value: "#000000" });
    expect(result.ok).toBe(false);
    expect(session.canUndo).toBe(false);
  });
});
