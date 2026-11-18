// OFFSET・BREAK の適用(Phase 12): 新しい図形の追加・切断の置き換えと分割・1回 = Undo 1段階・元データとの対応・読み取り専用
import { describe, expect, it } from "vitest";
import { createDocument } from "../../core/model";
import { IDENTITY_MATRIX } from "../../core/geometry/transform";
import type { CadArc, CadCircle, CadEntity, CadLayer, CadLine, CadPolyline, Point2D } from "../../types/cad";
import { breakAt } from "./breaking";
import { createEditability } from "./editability";
import { DocumentSession } from "./documentSession";
import { offsetAt } from "./offsetting";
import { isFinitePiece } from "./pieces";

const LAYERS: CadLayer[] = [{ name: "0", color: "#ffffff", visible: true }, { name: "WALL", color: "#00ff00", visible: true }];
const base = { layer: "0", color: "#ffffff" };
const pt = (x: number, y: number): Point2D => ({ x, y });

/** e0 横の線 / e1 円 / e2 折れ線(L字) / e3 ブロックの中身の線(読み取り専用) / e4 文字 / e5 WALL レイヤーの線(色付き)/ e6 閉じた折れ線 */
function setup(extra: CadEntity[] = []) {
  const imported: CadEntity[] = [
    { ...base, id: "e0", type: "LINE", start: pt(0, 0), end: pt(100, 0) },
    { ...base, id: "e1", type: "CIRCLE", center: pt(500, 500), radius: 20 },
    { ...base, id: "e2", type: "LWPOLYLINE", vertices: [pt(0, 200), pt(100, 200), pt(100, 300)], closed: false } as CadEntity,
    { ...base, id: "e3", type: "LINE", start: pt(0, 400), end: pt(100, 400) },
    { ...base, id: "e4", type: "TEXT", position: pt(900, 900), text: "A", height: 10, rotation: 0, horizontalAlign: "left", verticalAlign: "baseline" },
    { ...base, layer: "WALL", color: "#00ff00", id: "e5", type: "LINE", start: pt(0, 600), end: pt(100, 600), lineWeight: 50 } as CadEntity,
    { ...base, id: "e6", type: "LWPOLYLINE", vertices: [pt(1000, 0), pt(1100, 0), pt(1100, 100), pt(1000, 100)], closed: true } as CadEntity,
  ];
  const session = new DocumentSession(createDocument({ layers: LAYERS, entities: [...imported, ...extra] }));
  const editability = createEditability({
    importedIndexById: new Map(imported.map((entity, index) => [entity.id, index])),
    nested: Uint8Array.from([0, 0, 0, 1, 0, 0, 0]),
    parserIndex: Int32Array.from([0, 1, 2, 3, 4, 5, 6]),
  });
  return { session, editability };
}

const get = (session: DocumentSession, id: string) => session.document.entities.find((entity) => entity.id === id);
const last = (session: DocumentSession) => session.document.entities[session.document.entities.length - 1];
const lineEnds = (entity: CadEntity | undefined) => {
  const l = entity as CadLine;
  return [l.start.x, l.start.y, l.end.x, l.end.y];
};
const verticesOf = (entity: CadEntity | undefined) => (entity as CadPolyline).vertices.map((v) => [v.x, v.y]);

describe("OFFSET", () => {
  it("adds ONE new entity at the end (the source is untouched), with the source's layer, color and weight; one Undo step", () => {
    const { session, editability } = setup();
    const before = session.document.entities;
    const result = offsetAt(session, editability, "e5", 10, pt(50, 700));
    expect(result).toEqual({ ok: true, message: "図形をオフセットしました(距離 10)" });
    expect(session.document.entities.length).toBe(before.length + 1);
    session.document.entities.slice(0, before.length).forEach((entity, i) => expect(entity).toBe(before[i])); // 元の図形は、そのまま
    const created = last(session);
    expect(created.id).toMatch(/^n\d+$/);
    expect(created).toMatchObject({ type: "LINE", layer: "WALL", color: "#00ff00", lineWeight: 50 });
    expect(lineEnds(created)).toEqual([0, 610, 100, 610]);

    expect(session.undo().type).toBe("done");
    expect(session.document.entities.length).toBe(before.length);
    session.document.entities.forEach((entity, i) => expect(entity).toBe(before[i]));
    expect(session.canUndo).toBe(false);
  });

  it("the side follows the click; the distance is the typed one", () => {
    const { session, editability } = setup();
    offsetAt(session, editability, "e0", 10, pt(50, 30));
    expect(lineEnds(last(session))).toEqual([0, 10, 100, 10]);
    offsetAt(session, editability, "e0", 10, pt(50, -3));
    expect(lineEnds(last(session))).toEqual([0, -10, 100, -10]);
  });

  it("through a point (distance = null): the distance and the side are decided by the point", () => {
    const { session, editability } = setup();
    const result = offsetAt(session, editability, "e0", null, pt(500, -25));
    expect(result.ok).toBe(true);
    expect(lineEnds(last(session))).toEqual([0, -25, 100, -25]);
    expect(offsetAt(session, editability, "e0", null, pt(40, 0))).toEqual({ ok: false, message: "オフセットできません: 通過点が図形の上にあります(距離が0になります)" });
  });

  it("a circle (outward and inward), a polyline and a closed polyline", () => {
    const { session, editability } = setup();
    offsetAt(session, editability, "e1", 5, pt(500, 540));
    expect(last(session)).toMatchObject({ type: "CIRCLE", radius: 25, center: pt(500, 500) });
    offsetAt(session, editability, "e1", 5, pt(500, 500));
    expect((last(session) as CadCircle).radius).toBe(15);
    offsetAt(session, editability, "e2", 10, pt(50, 150)); // 進行方向(東→北)の右側(外側)
    expect(verticesOf(last(session))).toEqual([[0, 190], [110, 190], [110, 300]]);
    offsetAt(session, editability, "e6", 10, pt(1050, 50)); // 閉じた折れ線の内側(反時計回りの左)
    expect((last(session) as CadPolyline).closed).toBe(true);
    expect(verticesOf(last(session))).toEqual([[1010, 10], [1090, 10], [1090, 90], [1010, 90]]);
  });

  it("the source record: imported source → points at its record with the reshaped mark; a new entity as the source → none", () => {
    const { session, editability } = setup();
    offsetAt(session, editability, "e0", 10, pt(50, 30));
    const first = last(session);
    expect(first.sourceRecord).toEqual({ id: "e0", matrix: IDENTITY_MATRIX, reshaped: true });
    // 新しく描いた図形(offset の結果。元データに記録が無い)のオフセットも、記録を引き継ぐ(元は e0 の記録)。新しく描いた線には付かない
    offsetAt(session, editability, first.id, 10, pt(50, 50));
    expect(last(session).sourceRecord).toEqual({ id: "e0", matrix: IDENTITY_MATRIX, reshaped: true });
    const fresh = setup([{ ...base, id: "n9", type: "LINE", start: pt(0, 800), end: pt(100, 800) }]);
    offsetAt(fresh.session, fresh.editability, "n9", 10, pt(50, 900));
    expect(last(fresh.session).sourceRecord).toBeUndefined();
  });

  it("each OFFSET is one Undo step; Redo brings the same entity back (same id, same place)", () => {
    const { session, editability } = setup();
    offsetAt(session, editability, "e0", 10, pt(50, 30));
    const firstId = last(session).id;
    offsetAt(session, editability, "e0", 20, pt(50, 30));
    expect(session.document.entities.length).toBe(9);
    session.undo();
    expect(session.document.entities.length).toBe(8);
    session.redo();
    expect(session.document.entities.length).toBe(9);
    expect(lineEnds(last(session))).toEqual([0, 20, 100, 20]);
    expect(session.document.entities.find((entity) => entity.id === firstId)).toBeDefined();
  });

  it("refuses: read-only (block content), text, a missing figure, a click on the figure, a too-large inward distance", () => {
    const { session, editability } = setup();
    const count = session.document.entities.length;
    expect(offsetAt(session, editability, "e3", 10, pt(50, 450)).ok).toBe(false); // ブロックの中身
    expect(offsetAt(session, editability, "e4", 10, pt(900, 950))).toMatchObject({ ok: false, message: expect.stringContaining("TEXT は、オフセットできません") });
    expect(offsetAt(session, editability, "zzz", 10, pt(0, 0))).toMatchObject({ ok: false, message: expect.stringContaining("見つかりません") });
    expect(offsetAt(session, editability, "e0", 10, pt(40, 0))).toMatchObject({ ok: false, message: expect.stringContaining("どちら側") });
    expect(offsetAt(session, editability, "e1", 20, pt(500, 500))).toMatchObject({ ok: false, message: expect.stringContaining("半径以上") });
    expect(offsetAt(session, editability, "e0", 10, pt(NaN, 1)).ok).toBe(false);
    expect(session.document.entities.length).toBe(count); // 何も追加されていない
    expect(session.canUndo).toBe(false);
  });
});

describe("results with non-finite numbers are never applied", () => {
  it("isFinitePiece checks circles too (centre and radius)", () => {
    expect(isFinitePiece({ ...base, id: "c", type: "CIRCLE", center: pt(0, 0), radius: 5 })).toBe(true);
    expect(isFinitePiece({ ...base, id: "c", type: "CIRCLE", center: pt(Infinity, 0), radius: 5 })).toBe(false);
    expect(isFinitePiece({ ...base, id: "c", type: "CIRCLE", center: pt(0, 0), radius: NaN })).toBe(false);
  });

  it("a click on the extension of a line gives an honest reason", () => {
    const { session, editability } = setup();
    expect(offsetAt(session, editability, "e0", 10, pt(500, 0))).toMatchObject({ ok: false, message: expect.stringContaining("延長線の上") });
  });
});

describe("BREAK", () => {
  it("a gap in a line: the line becomes two entities (the second is new, right above the first); ONE Undo step", () => {
    const { session, editability } = setup();
    const before = session.document.entities;
    const result = breakAt(session, editability, "e0", pt(30, 0), pt(60, 0));
    expect(result).toEqual({ ok: true, message: "図形を切断しました(2つの図形に分かれました)" });
    expect(lineEnds(get(session, "e0"))).toEqual([0, 0, 30, 0]);
    const order = session.document.entities.map((entity) => entity.id);
    const second = session.document.entities[order.indexOf("e0") + 1];
    expect(second.id).toMatch(/^n\d+$/);
    expect(lineEnds(second)).toEqual([60, 0, 100, 0]);
    expect(session.document.entities.length).toBe(before.length + 1);

    expect(session.undo().type).toBe("done");
    session.document.entities.forEach((entity, i) => expect(entity).toBe(before[i]));
    expect(session.canUndo).toBe(false);
    expect(session.redo().type).toBe("done");
    expect(lineEnds(get(session, "e0"))).toEqual([0, 0, 30, 0]);
  });

  it("both pieces point at the SAME original record with the reshaped mark; a new entity has none", () => {
    const { session, editability } = setup([{ ...base, id: "n9", type: "LINE", start: pt(0, 800), end: pt(100, 800) }]);
    breakAt(session, editability, "e0", pt(30, 0), pt(60, 0));
    const second = session.document.entities[session.document.entities.findIndex((e) => e.id === "e0") + 1];
    expect(get(session, "e0")?.sourceRecord).toEqual({ id: "e0", matrix: IDENTITY_MATRIX, reshaped: true });
    expect(second.sourceRecord).toEqual({ id: "e0", matrix: IDENTITY_MATRIX, reshaped: true });
    breakAt(session, editability, "n9", pt(30, 800), pt(60, 800));
    expect(get(session, "n9")?.sourceRecord).toBeUndefined();
  });

  it("the same point splits into two; a gap at one end leaves one (replaced); the whole line removes it", () => {
    const { session, editability } = setup();
    expect(breakAt(session, editability, "e0", pt(50, 0), pt(50, 0))).toMatchObject({ ok: true });
    expect(lineEnds(get(session, "e0"))).toEqual([0, 0, 50, 0]);
    expect(lineEnds(session.document.entities[session.document.entities.findIndex((e) => e.id === "e0") + 1])).toEqual([50, 0, 100, 0]);

    const other = setup();
    const count = other.session.document.entities.length;
    expect(breakAt(other.session, other.editability, "e0", pt(70, 0), pt(500, 0))).toEqual({ ok: true, message: "図形を切断しました" });
    expect(lineEnds(get(other.session, "e0"))).toEqual([0, 0, 70, 0]);
    expect(other.session.document.entities.length).toBe(count);

    const whole = setup();
    expect(breakAt(whole.session, whole.editability, "e0", pt(-10, 0), pt(110, 0))).toEqual({ ok: true, message: "図形を切断しました(図形の全体を取り除いたため、図形を削除しました)" });
    expect(get(whole.session, "e0")).toBeUndefined();
  });

  it("a circle becomes an arc (the type changes; the id is kept); a closed polyline becomes one open polyline", () => {
    const { session, editability } = setup();
    breakAt(session, editability, "e1", pt(520, 500), pt(500, 520));
    const arc = get(session, "e1") as CadArc;
    expect(arc.type).toBe("ARC");
    expect(arc.startAngle).toBeCloseTo(Math.PI / 2, 12);
    expect(arc.endAngle).toBeCloseTo(0, 12);
    breakAt(session, editability, "e6", pt(1050, 0), pt(1100, 50));
    const polyline = get(session, "e6") as CadPolyline;
    expect(polyline.closed).toBe(false);
    expect(verticesOf(polyline)).toEqual([[1100, 50], [1100, 100], [1000, 100], [1000, 0], [1050, 0]]);
  });

  it("refuses with a reason and changes nothing: read-only, text, a missing figure, nothing to break, a circle with one point", () => {
    const { session, editability } = setup();
    const before = session.document.entities;
    expect(breakAt(session, editability, "e3", pt(30, 400), pt(60, 400)).ok).toBe(false);
    expect(breakAt(session, editability, "e4", pt(900, 900), pt(901, 900))).toMatchObject({ ok: false, message: expect.stringContaining("TEXT は、切断できません") });
    expect(breakAt(session, editability, "zzz", pt(0, 0), pt(1, 0))).toMatchObject({ ok: false, message: expect.stringContaining("見つかりません") });
    expect(breakAt(session, editability, "e0", pt(-30, 0), pt(-10, 0))).toMatchObject({ ok: false, message: expect.stringContaining("図形は変わりません") });
    expect(breakAt(session, editability, "e1", pt(520, 500), pt(520, 500))).toMatchObject({ ok: false, message: expect.stringContaining("異なる2点") });
    expect(session.document.entities).toBe(before);
    expect(session.canUndo).toBe(false);
  });
});
