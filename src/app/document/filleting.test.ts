// FILLET・CHAMFER の適用(Phase 13): 置き換え + 追加・1回 = Undo 1段階・元データとの対応・読み取り専用
import { describe, expect, it } from "vitest";
import { createDocument } from "../../core/model";
import { IDENTITY_MATRIX } from "../../core/geometry/transform";
import type { CadArc, CadEntity, CadLayer, CadLine, CadPolyline, Point2D } from "../../types/cad";
import { createEditability } from "./editability";
import { DocumentSession } from "./documentSession";
import { cornerAt } from "./filleting";

const LAYERS: CadLayer[] = [{ name: "0", color: "#ffffff", visible: true }, { name: "WALL", color: "#00ff00", visible: true }];
const base = { layer: "0", color: "#ffffff" };
const pt = (x: number, y: number): Point2D => ({ x, y });

/**
 * e0・e1 L字の2本(原点で出会う) / e2・e3 WALL レイヤーの2本(e2 は太線。(500,0)で出会う) / e4 閉じた折れ線(長方形) /
 * e5 ブロックの中身の線(読み取り専用) / e6 文字 / e7 円 / e8 開いた折れ線(L字)
 */
function setup(extra: CadEntity[] = []) {
  const imported: CadEntity[] = [
    { ...base, id: "e0", type: "LINE", start: pt(0, 0), end: pt(100, 0) },
    { ...base, id: "e1", type: "LINE", start: pt(0, 0), end: pt(0, 100) },
    { ...base, layer: "WALL", color: "#00ff00", id: "e2", type: "LINE", start: pt(500, 0), end: pt(600, 0), lineWeight: 50 } as CadEntity,
    { ...base, layer: "WALL", color: "#0000ff", id: "e3", type: "LINE", start: pt(500, 0), end: pt(500, 100) },
    { ...base, id: "e4", type: "LWPOLYLINE", vertices: [pt(1000, 0), pt(1100, 0), pt(1100, 100), pt(1000, 100)], closed: true } as CadEntity,
    { ...base, id: "e5", type: "LINE", start: pt(0, 400), end: pt(0, 500) },
    { ...base, id: "e6", type: "TEXT", position: pt(900, 900), text: "A", height: 10, rotation: 0, horizontalAlign: "left", verticalAlign: "baseline" },
    { ...base, id: "e7", type: "CIRCLE", center: pt(2000, 2000), radius: 20 },
    { ...base, id: "e8", type: "LWPOLYLINE", vertices: [pt(3000, 0), pt(3100, 0), pt(3100, 100)], closed: false } as CadEntity,
  ];
  const session = new DocumentSession(createDocument({ layers: LAYERS, entities: [...imported, ...extra] }));
  const editability = createEditability({
    importedIndexById: new Map(imported.map((entity, index) => [entity.id, index])),
    nested: Uint8Array.from([0, 0, 0, 0, 0, 1, 0, 0, 0]),
    parserIndex: Int32Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8]),
  });
  return { session, editability };
}

const get = (session: DocumentSession, id: string) => session.document.entities.find((entity) => entity.id === id);
const last = (session: DocumentSession) => session.document.entities[session.document.entities.length - 1];
const lineEnds = (entity: CadEntity | undefined) => {
  const l = entity as CadLine;
  return [l.start.x, l.start.y, l.end.x, l.end.y];
};
const target = (id: string, x: number, y: number) => ({ id, point: pt(x, y) });
const fillet = (radius: number) => ({ kind: "fillet" as const, radius });
const chamfer = (distance1: number, distance2: number) => ({ kind: "chamfer" as const, distance1, distance2 });

describe("FILLET on two lines", () => {
  it("replaces both lines in place and adds ONE arc at the end, with the first line's attributes; one Undo step", () => {
    const { session, editability } = setup();
    const before = session.document.entities;
    const result = cornerAt(session, editability, fillet(10), target("e2", 550, 0), target("e3", 500, 50));
    expect(result).toEqual({ ok: true, message: "角を丸めました(半径 10)" });
    expect(session.document.entities.length).toBe(before.length + 1);
    // 描画順は、そのまま。2本は同じ位置・同じID(中身だけ変わる)。ほかの図形は、同じ物
    before.forEach((entity, i) => {
      const now = session.document.entities[i];
      expect(now.id).toBe(entity.id);
      if (entity.id !== "e2" && entity.id !== "e3") expect(now).toBe(entity);
    });
    expect(lineEnds(get(session, "e2"))).toEqual([510, 0, 600, 0]);
    expect(lineEnds(get(session, "e3"))).toEqual([500, 10, 500, 100]);
    expect(get(session, "e2")).toMatchObject({ layer: "WALL", color: "#00ff00", lineWeight: 50 });
    expect(get(session, "e3")).toMatchObject({ layer: "WALL", color: "#0000ff" });
    const arc = last(session) as CadArc;
    expect(arc.id).toMatch(/^n\d+$/);
    expect(arc).toMatchObject({ type: "ARC", layer: "WALL", color: "#00ff00", lineWeight: 50, center: pt(510, 10), radius: 10 });

    expect(session.undo().type).toBe("done");
    expect(session.document.entities.length).toBe(before.length);
    session.document.entities.forEach((entity, i) => expect(entity).toBe(before[i])); // 元の図形(同じ物)に戻る
    expect(session.canUndo).toBe(false);
  });

  it("the source records: each replaced line points at its own record, the new arc at the first line's; all marked reshaped", () => {
    const { session, editability } = setup();
    cornerAt(session, editability, fillet(10), target("e2", 550, 0), target("e3", 500, 50));
    expect(get(session, "e2")?.sourceRecord).toEqual({ id: "e2", matrix: IDENTITY_MATRIX, reshaped: true });
    expect(get(session, "e3")?.sourceRecord).toEqual({ id: "e3", matrix: IDENTITY_MATRIX, reshaped: true });
    expect(last(session).sourceRecord).toEqual({ id: "e2", matrix: IDENTITY_MATRIX, reshaped: true });
  });

  it("new figures (no record in the source data) get no record, and neither does the arc", () => {
    const fresh = setup([
      { ...base, id: "n1", type: "LINE", start: pt(0, 800), end: pt(100, 800) },
      { ...base, id: "n2", type: "LINE", start: pt(0, 800), end: pt(0, 900) },
    ]);
    const result = cornerAt(fresh.session, fresh.editability, fillet(10), target("n1", 50, 800), target("n2", 0, 850));
    expect(result.ok).toBe(true);
    expect(get(fresh.session, "n1")?.sourceRecord).toBeUndefined();
    expect(get(fresh.session, "n2")?.sourceRecord).toBeUndefined();
    expect(last(fresh.session).sourceRecord).toBeUndefined();
  });

  it("Redo brings the same entities back (same ids, same shapes)", () => {
    const { session, editability } = setup();
    cornerAt(session, editability, fillet(10), target("e0", 50, 0), target("e1", 0, 50));
    const arcId = last(session).id;
    const snapshot = JSON.stringify(session.document.entities);
    session.undo();
    session.redo();
    expect(JSON.stringify(session.document.entities)).toBe(snapshot);
    expect(last(session).id).toBe(arcId);
  });

  it("radius 0 joins the two lines and adds nothing", () => {
    const { session, editability } = setup();
    const count = session.document.entities.length;
    // e0 は原点から右へ、e1 は原点から上へ。すでに出会っているので、形は変わらない(そのまま、交点で結ばれる)
    expect(cornerAt(session, editability, fillet(0), target("e0", 50, 0), target("e1", 0, 50))).toEqual({ ok: true, message: "角を作りました(半径 0: 2本の線を、交点で結びました)" });
    expect(session.document.entities.length).toBe(count);
    expect(lineEnds(get(session, "e0"))).toEqual([0, 0, 100, 0]);
  });

  it("a radius that is too large is refused, and nothing changes (no partial result, no wasted ids)", () => {
    const refused = setup();
    const before = refused.session.document.entities;
    expect(cornerAt(refused.session, refused.editability, fillet(150), target("e0", 50, 0), target("e1", 0, 50))).toMatchObject({ ok: false, message: expect.stringContaining("半径が大きすぎます") });
    expect(refused.session.document.entities).toBe(before);
    expect(refused.session.canUndo).toBe(false);
    // 断った操作は、図形のIDを使わない: そのあとの成功の結果の ID は、断りの無い場合と同じ
    cornerAt(refused.session, refused.editability, fillet(10), target("e0", 50, 0), target("e1", 0, 50));
    const clean = setup();
    cornerAt(clean.session, clean.editability, fillet(10), target("e0", 50, 0), target("e1", 0, 50));
    expect(last(refused.session).id).toBe(last(clean.session).id);
  });
});

describe("CHAMFER on two lines", () => {
  it("adds a line between the two points (distance 1 on the first line, distance 2 on the second)", () => {
    const { session, editability } = setup();
    const result = cornerAt(session, editability, chamfer(10, 20), target("e2", 550, 0), target("e3", 500, 50));
    expect(result).toEqual({ ok: true, message: "角を面取りしました(距離 10, 20)" });
    expect(lineEnds(get(session, "e2"))).toEqual([510, 0, 600, 0]);
    expect(lineEnds(get(session, "e3"))).toEqual([500, 20, 500, 100]);
    const added = last(session);
    expect(added).toMatchObject({ type: "LINE", layer: "WALL", color: "#00ff00", lineWeight: 50 });
    expect(lineEnds(added)).toEqual([510, 0, 500, 20]);
    expect(added.sourceRecord).toEqual({ id: "e2", matrix: IDENTITY_MATRIX, reshaped: true });
    session.undo();
    expect(session.canUndo).toBe(false);
  });

  it("distance 0 and 0 joins the lines; the message says so", () => {
    const { session, editability } = setup();
    expect(cornerAt(session, editability, chamfer(0, 0), target("e0", 50, 0), target("e1", 0, 50))).toEqual({ ok: true, message: "角を作りました(距離 0: 2本の線を、交点で結びました)" });
  });
});

describe("a polyline: two adjacent segments", () => {
  it("replaces the polyline only (the arc becomes its vertices); the figure keeps its id, place and attributes; one Undo step", () => {
    const { session, editability } = setup();
    const before = session.document.entities;
    const result = cornerAt(session, editability, fillet(10), target("e4", 1050, 0), target("e4", 1100, 50));
    expect(result).toEqual({ ok: true, message: "角を丸めました(半径 10)" });
    expect(session.document.entities.length).toBe(before.length); // 図形は増えない
    const rounded = get(session, "e4") as CadPolyline;
    expect(rounded.closed).toBe(true);
    expect(rounded.vertices.length).toBeGreaterThan(50);
    expect(get(session, "e4")?.sourceRecord).toEqual({ id: "e4", matrix: IDENTITY_MATRIX, reshaped: true });
    expect(session.document.entities.indexOf(rounded)).toBe(4);
    session.undo();
    session.document.entities.forEach((entity, i) => expect(entity).toBe(before[i]));
  });

  it("an open polyline, chamfered", () => {
    const { session, editability } = setup();
    expect(cornerAt(session, editability, chamfer(10, 10), target("e8", 3050, 0), target("e8", 3100, 50)).ok).toBe(true);
    expect((get(session, "e8") as CadPolyline).vertices).toEqual([pt(3000, 0), pt(3090, 0), pt(3100, 10), pt(3100, 100)]);
  });

  it("radius 0 on a polyline is refused (nothing changes), and so are non-adjacent clicks", () => {
    const { session, editability } = setup();
    const before = session.document.entities;
    expect(cornerAt(session, editability, fillet(0), target("e4", 1050, 0), target("e4", 1100, 50))).toMatchObject({ ok: false, message: expect.stringContaining("変わりません") });
    expect(cornerAt(session, editability, fillet(5), target("e4", 1050, 0), target("e4", 1050, 100))).toMatchObject({ ok: false });
    expect(cornerAt(session, editability, fillet(5), target("e4", 1050, 0), target("e4", 1060, 0))).toMatchObject({ ok: false, message: expect.stringContaining("同じ線分") });
    expect(session.document.entities).toBe(before);
    expect(session.canUndo).toBe(false);
  });
});

describe("refusals (nothing changes)", () => {
  it("block content (read-only), text, a circle, a missing figure, a polyline with a line, the same line twice, bad clicks", () => {
    const { session, editability } = setup();
    const before = session.document.entities;
    // e5 は e0 と交わる(平行ではない)ので、読み取り専用でなければ、成功してしまう組み合わせ
    expect(cornerAt(session, editability, fillet(5), target("e5", 0, 450), target("e0", 50, 0))).toEqual({ ok: false, message: "フィレットできません: ブロックの中身・寸法は、読み取り専用です" });
    expect(cornerAt(session, editability, chamfer(5, 5), target("e0", 50, 0), target("e5", 0, 450))).toEqual({ ok: false, message: "面取りできません: ブロックの中身・寸法は、読み取り専用です" });
    expect(cornerAt(session, editability, fillet(5), target("e6", 900, 900), target("e0", 50, 0))).toMatchObject({ ok: false, message: expect.stringContaining("TEXT は、フィレットできません") });
    expect(cornerAt(session, editability, chamfer(5, 5), target("e0", 50, 0), target("e7", 2020, 2000))).toMatchObject({ ok: false, message: expect.stringContaining("CIRCLE は、面取りできません") });
    expect(cornerAt(session, editability, fillet(5), target("zzz", 0, 0), target("e0", 50, 0))).toMatchObject({ ok: false, message: expect.stringContaining("見つかりません") });
    expect(cornerAt(session, editability, fillet(5), target("e8", 3050, 0), target("e0", 50, 0))).toMatchObject({ ok: false, message: expect.stringContaining("折れ線は") });
    expect(cornerAt(session, editability, fillet(5), target("e0", 20, 0), target("e0", 80, 0))).toMatchObject({ ok: false, message: expect.stringContaining("同じ線") });
    expect(cornerAt(session, editability, fillet(5), target("e0", Number.NaN, 0), target("e1", 0, 50))).toMatchObject({ ok: false });
    expect(cornerAt(session, editability, fillet(-1), target("e0", 50, 0), target("e1", 0, 50))).toMatchObject({ ok: false, message: expect.stringContaining("0 以上") });
    expect(cornerAt(session, editability, chamfer(0, 5), target("e0", 50, 0), target("e1", 0, 50))).toMatchObject({ ok: false, message: expect.stringContaining("片方だけ 0") });
    // 平行な線
    expect(cornerAt(session, editability, fillet(5), target("e0", 50, 0), target("e2", 550, 0))).toMatchObject({ ok: false, message: expect.stringContaining("平行") });
    expect(session.document.entities).toBe(before);
    expect(session.canUndo).toBe(false);
  });
});
