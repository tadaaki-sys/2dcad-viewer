// 拡大縮小・鏡像・ストレッチの適用(Phase 10)。1操作 = Undo 1段階、元データとの対応(sourceRecord)、読み取り専用の除外。
import { describe, expect, it } from "vitest";
import { createDocument } from "../../core/model";
import { windowFromCorners } from "../../core/geometry/stretch";
import { IDENTITY_MATRIX, reflectionMatrix, scaleMatrix, translationMatrix } from "../../core/geometry/transform";
import type { CadEntity, CadLayer, Point2D } from "../../types/cad";
import { createEditability, READ_ONLY_REASON } from "./editability";
import type { Editability } from "./editability";
import { copyEntities, stretchEntities, transformEntities } from "./editing";
import { DocumentSession } from "./documentSession";

const LAYERS: CadLayer[] = [{ name: "0", color: "#ffffff", visible: true }];
const base = { layer: "0", color: "#ffffff" };

const line = (id: string, x0: number, y0: number, x1: number, y1: number): CadEntity => ({ ...base, id, type: "LINE", start: { x: x0, y: y0 }, end: { x: x1, y: y1 } });
const circle = (id: string, x: number, y: number, r: number): CadEntity => ({ ...base, id, type: "CIRCLE", center: { x, y }, radius: r });
const text = (id: string, x: number, y: number): CadEntity => ({ ...base, id, type: "TEXT", position: { x, y }, text: "A", height: 10, rotation: 0.3, horizontalAlign: "left", verticalAlign: "baseline" });
const arc = (id: string, cx: number): CadEntity => ({ ...base, id, type: "ARC", center: { x: cx, y: 50 }, radius: 20, startAngle: 0, endAngle: Math.PI });

/** e0..e5 は取り込んだ図形(e5 はブロックの中身=読み取り専用)。あとから描いた図形は n0 など */
function setup(extra: CadEntity[] = []) {
  const imported: CadEntity[] = [
    line("e0", 50, 50, 300, 50), // 窓(0..100)に、始点だけ入る
    line("e1", 10, 10, 90, 90), // 窓に、全体が入る
    circle("e2", 40, 40, 10),
    text("e3", 20, 20),
    arc("e4", 95), // 窓に、一部だけ入る
    line("e5", 30, 30, 60, 60), // ブロックの中身
  ];
  const session = new DocumentSession(createDocument({ layers: LAYERS, entities: [...imported, ...extra] }));
  const editability = createEditability({
    importedIndexById: new Map(imported.map((entity, index) => [entity.id, index])),
    nested: Uint8Array.from([0, 0, 0, 0, 0, 1]),
    parserIndex: Int32Array.from([0, 1, 2, 3, 4, 5]),
  });
  return { session, editability };
}

const get = (session: DocumentSession, id: string) => session.document.entities.find((entity) => entity.id === id)!;
const WINDOW = windowFromCorners({ x: 0, y: 0 }, { x: 100, y: 100 });
const ALL = ["e0", "e1", "e2", "e3", "e4", "e5"];

describe("SCALE and MIRROR (in place) through transformEntities", () => {
  it("scales several entities as ONE history step; Undo restores the identical document; the source record holds the scale matrix", () => {
    const { session, editability } = setup();
    const before = session.document.entities;
    const matrix = scaleMatrix({ x: 0, y: 0 }, 2);
    const result = transformEntities(session, editability, ["e0", "e2", "e3"], matrix, "3個の図形を拡大縮小(×2)", "拡大縮小");
    expect(result).toEqual({ ok: true, message: "3個の図形を拡大縮小しました" });
    expect(get(session, "e2")).toMatchObject({ center: { x: 80, y: 80 }, radius: 20, sourceRecord: { id: "e2", matrix } });
    expect(get(session, "e3")).toMatchObject({ position: { x: 40, y: 40 }, height: 20 });
    expect(get(session, "e0")).toMatchObject({ start: { x: 100, y: 100 }, end: { x: 600, y: 100 } });
    expect(session.undo().type).toBe("done");
    expect(session.document.entities.length).toBe(before.length);
    session.document.entities.forEach((entity, i) => expect(entity).toBe(before[i]));
    expect(session.canUndo).toBe(false); // 1段階だけ
  });

  it("mirrors in place: ids and draw order stay; a text is moved but not turned; the record holds the reflection", () => {
    const { session, editability } = setup();
    const order = session.document.entities.map((entity) => entity.id);
    const matrix = reflectionMatrix({ x: 0, y: 0 }, { x: 0, y: 1 })!; // Y 軸
    expect(transformEntities(session, editability, ["e0", "e3"], matrix, "鏡像化", "鏡像化").ok).toBe(true);
    expect(session.document.entities.map((entity) => entity.id)).toEqual(order);
    expect(get(session, "e0")).toMatchObject({ start: { x: -50, y: 50 }, end: { x: -300, y: 50 }, sourceRecord: { id: "e0", matrix } });
    const t = get(session, "e3") as CadEntity & { position: Point2D; rotation: number };
    expect(t.position).toEqual({ x: -20, y: 20 });
    expect(t.rotation).toBe(0.3); // 文字は反転させない
  });

  it("a later move composes onto the scale in the source record (first scale, then move)", () => {
    const { session, editability } = setup();
    const scale = scaleMatrix({ x: 0, y: 0 }, 2);
    const move = translationMatrix(5, 7);
    transformEntities(session, editability, ["e2"], scale, "拡大縮小", "拡大縮小");
    transformEntities(session, editability, ["e2"], move, "移動", "移動");
    const record = (get(session, "e2") as CadEntity).sourceRecord!;
    expect(record.matrix).toEqual([2, 0, 0, 2, 5, 7]);
  });

  it("refuses non-uniform scaling and read-only entities, changing nothing", () => {
    const { session, editability } = setup();
    const before = session.document;
    expect(transformEntities(session, editability, ["e0"], [2, 0, 0, 1, 0, 0], "x", "拡大縮小").ok).toBe(false);
    const readOnly = transformEntities(session, editability, ["e5"], scaleMatrix({ x: 0, y: 0 }, 2), "x", "拡大縮小");
    expect(readOnly.ok).toBe(false);
    expect(readOnly.message).toContain(READ_ONLY_REASON);
    expect(session.document).toBe(before);
  });

  it("a scale that overflows is refused as a whole", () => {
    const huge = circle("n0", 0, 0, 1e308);
    const { session, editability } = setup([huge]);
    const before = session.document;
    const result = transformEntities(session, editability, ["e2", "n0"], scaleMatrix({ x: 0, y: 0 }, 1000), "x", "拡大縮小");
    expect(result.ok).toBe(false);
    expect(session.document).toBe(before);
  });
});

describe("MIRROR (copy) through copyEntities", () => {
  it("adds mirrored copies as new entities in ONE step; the originals stay; a copy of an imported entity points at the ORIGINAL record with the reflection", () => {
    const { session, editability } = setup();
    const matrix = reflectionMatrix({ x: 0, y: 0 }, { x: 10, y: 0 })!; // X 軸
    const result = copyEntities(session, editability, ["e0", "e2"], [matrix], "2個の図形を鏡像コピー");
    expect(result.ok).toBe(true);
    expect(session.document.entities.length).toBe(8);
    expect(get(session, "e0")).toMatchObject({ start: { x: 50, y: 50 } }); // 元は動かない
    const copies = session.document.entities.slice(6) as Array<CadEntity & { start?: Point2D; center?: Point2D }>;
    expect(copies[0]).toMatchObject({ start: { x: 50, y: -50 }, end: { x: 300, y: -50 }, sourceRecord: { id: "e0", matrix } });
    expect(copies[1]).toMatchObject({ center: { x: 40, y: -40 }, radius: 10, sourceRecord: { id: "e2", matrix } });
    expect(copies.every((copy) => /^n\d+$/.test(copy.id))).toBe(true);
    expect(session.undo().type).toBe("done");
    expect(session.document.entities.length).toBe(6);
    expect(session.canUndo).toBe(false);
  });

  it("a mirrored copy of a new entity has no source record", () => {
    const { session, editability } = setup([line("n5", 1, 2, 3, 4)]);
    copyEntities(session, editability, ["n5"], [reflectionMatrix({ x: 0, y: 0 }, { x: 0, y: 1 })!], "鏡像コピー");
    expect((session.document.entities[7] as CadEntity).sourceRecord).toBeUndefined();
  });
});

describe("stretchEntities", () => {
  it("moves only the vertices inside the window as ONE step; Undo restores the identical document", () => {
    const { session, editability } = setup();
    const before = session.document.entities;
    const result = stretchEntities(session, editability, ALL, WINDOW, 10, 20, "ストレッチ");
    expect(result.ok).toBe(true);
    // e0: 始点だけ動く(形が変わった)。e1: 全体が窓の中なので、図形ごと移動。円・文字も、図形ごと移動
    expect(get(session, "e0")).toMatchObject({ start: { x: 60, y: 70 }, end: { x: 300, y: 50 } });
    expect(get(session, "e1")).toMatchObject({ start: { x: 20, y: 30 }, end: { x: 100, y: 110 } });
    expect(get(session, "e2")).toMatchObject({ center: { x: 50, y: 60 } });
    expect(get(session, "e3")).toMatchObject({ position: { x: 30, y: 40 } });
    // 一部だけ窓に入る円弧と、読み取り専用の線は、動かない(同じオブジェクトのまま)
    expect(get(session, "e4")).toBe(before[4]);
    expect(get(session, "e5")).toBe(before[5]);
    expect(session.undo().type).toBe("done");
    session.document.entities.forEach((entity, i) => expect(entity).toBe(before[i]));
    expect(session.canUndo).toBe(false);
  });

  it("the message counts reshaped / moved entities and says what was left out (partial arc, read-only)", () => {
    const { session, editability } = setup();
    const result = stretchEntities(session, editability, ALL, WINDOW, 10, 20, "ストレッチ");
    expect(result.message).toContain("4個の図形をストレッチしました");
    expect(result.message).toContain("形が変わった 1 個");
    expect(result.message).toContain("図形ごと移動 3 個");
    expect(result.message).toContain("円弧・楕円・寸法 1 個は、一部だけが窓に入っている");
    expect(result.message).toContain("編集できない図形 1 個");
  });

  it("the source record: reshaped entities get the reshaped mark; whole moves just compose the translation; new entities get none", () => {
    const { session, editability } = setup([line("n0", 50, 50, 300, 50)]);
    stretchEntities(session, editability, [...ALL, "n0"], WINDOW, 10, 20, "ストレッチ");
    expect(get(session, "e0")).toMatchObject({ sourceRecord: { id: "e0", matrix: IDENTITY_MATRIX, reshaped: true } });
    expect((get(session, "e1") as CadEntity).sourceRecord).toEqual({ id: "e1", matrix: translationMatrix(10, 20) });
    expect((get(session, "e1") as CadEntity).sourceRecord?.reshaped).toBeUndefined();
    expect((get(session, "n0") as CadEntity).sourceRecord).toBeUndefined();
    expect(get(session, "n0")).toMatchObject({ start: { x: 60, y: 70 } }); // 新しい図形も、形は変わる
  });

  it("the reshaped mark survives a later move (the matrix still composes)", () => {
    const { session, editability } = setup();
    stretchEntities(session, editability, ["e0"], WINDOW, 10, 20, "ストレッチ");
    transformEntities(session, editability, ["e0"], translationMatrix(1, 1), "移動", "移動");
    expect((get(session, "e0") as CadEntity).sourceRecord).toEqual({ id: "e0", matrix: translationMatrix(1, 1), reshaped: true });
  });

  it("a copy of a reshaped entity keeps the mark", () => {
    const { session, editability } = setup();
    stretchEntities(session, editability, ["e0"], WINDOW, 10, 20, "ストレッチ");
    copyEntities(session, editability, ["e0"], [translationMatrix(0, 100)], "コピー");
    expect((session.document.entities[6] as CadEntity).sourceRecord?.reshaped).toBe(true);
  });

  it("nothing to stretch (no vertex in the window), a zero move and a non-finite move change nothing", () => {
    const { session, editability } = setup();
    const before = session.document;
    const none = stretchEntities(session, editability, ["e0"], windowFromCorners({ x: 500, y: 500 }, { x: 600, y: 600 }), 10, 10, "x");
    expect(none).toMatchObject({ ok: false });
    expect(none.message).toContain("窓の中に、動かせる頂点や図形がありません");
    expect(stretchEntities(session, editability, ["e0"], WINDOW, 0, 0, "x")).toEqual({ ok: false, message: "移動量が0です" });
    expect(stretchEntities(session, editability, ["e0"], WINDOW, Number.NaN, 1, "x").ok).toBe(false);
    expect(session.document).toBe(before);
  });

  it("only partially-inside arcs: nothing moves, and it says why", () => {
    const { session, editability } = setup();
    const before = session.document;
    const result = stretchEntities(session, editability, ["e4"], WINDOW, 5, 0, "x");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("円弧・楕円・寸法 1 個");
    expect(session.document).toBe(before);
  });

  it("an overflowing stretch is refused as a whole", () => {
    const far = line("n0", 50, 50, 1.7e308, 50);
    const { session, editability } = setup([far]);
    const before = session.document;
    const wide = windowFromCorners({ x: 0, y: 0 }, { x: 1.7e308, y: 100 });
    const result = stretchEntities(session, editability, ["e0", "n0"], wide, 1.7e308, 0, "x");
    expect(result.ok).toBe(false);
    expect(session.document).toBe(before);
  });

  it("all targets read-only: refused with the reason", () => {
    const { session, editability } = setup();
    const result = stretchEntities(session, editability, ["e5"], WINDOW, 5, 5, "x");
    expect(result.ok).toBe(false);
    expect(result.message).toContain(READ_ONLY_REASON);
  });
});

describe("a large stretch stays in one step", () => {
  it("5,000 lines with one end in the window: one Undo restores them all", () => {
    const lines: CadEntity[] = Array.from({ length: 5000 }, (_, i) => line(`n${i}`, 10, i, 500, i));
    const session = new DocumentSession(createDocument({ layers: LAYERS, entities: lines }));
    const all: Editability = { isEditable: () => true, reasonFor: () => null };
    const before = session.document.entities;
    const window = windowFromCorners({ x: 0, y: -1 }, { x: 100, y: 6000 });
    expect(stretchEntities(session, all, lines.map((l) => l.id), window, 5, 5, "ストレッチ").ok).toBe(true);
    expect(get(session, "n4999")).toMatchObject({ start: { x: 15, y: 5004 }, end: { x: 500, y: 4999 } });
    session.undo();
    session.document.entities.forEach((entity, i) => expect(entity).toBe(before[i]));
  });
});

describe("a sequence of edits keeps the geometry and the source record consistent through Undo and Redo (Codex review)", () => {
  it("stretch, then move, then mirror-copy: three steps; Undo x3 returns to the identical start; Redo x3 returns to the identical end", () => {
    const { session, editability } = setup();
    const start = session.document.entities;
    stretchEntities(session, editability, ["e0", "e1"], WINDOW, 10, 20, "ストレッチ");
    const afterStretch = session.document.entities;
    transformEntities(session, editability, ["e0"], translationMatrix(1, 1), "移動", "移動");
    const afterMove = session.document.entities;
    copyEntities(session, editability, ["e0"], [reflectionMatrix({ x: 0, y: 0 }, { x: 1, y: 1 })!], "鏡像コピー");
    const end = session.document.entities;
    expect(session.document.entities.length).toBe(7);

    const same = (a: readonly CadEntity[], b: readonly CadEntity[]) => a.length === b.length && a.every((entity, i) => entity === b[i]);
    session.undo();
    expect(same(session.document.entities, afterMove)).toBe(true);
    session.undo();
    expect(same(session.document.entities, afterStretch)).toBe(true);
    session.undo();
    expect(same(session.document.entities, start)).toBe(true);
    expect(session.canUndo).toBe(false);
    session.redo();
    session.redo();
    session.redo();
    expect(same(session.document.entities, end)).toBe(true);

    // 元データとの対応: e0 は、頂点が動いた印と、あとの移動の行列。コピーは、その印を引き継ぐ
    const e0 = get(session, "e0") as CadEntity;
    expect(e0.sourceRecord).toEqual({ id: "e0", matrix: translationMatrix(1, 1), reshaped: true });
    const copy = session.document.entities[6] as CadEntity;
    expect(copy.sourceRecord?.id).toBe("e0");
    expect(copy.sourceRecord?.reshaped).toBe(true);
  });

  it("an overflow in the LAST entity of several changes nothing at all (no partial result, no history entry)", () => {
    const far = line("n0", 1e308, 0, 1e308, 10);
    const { session, editability } = setup([far]);
    const before = session.document;
    const result = transformEntities(session, editability, ["e0", "e1", "e2", "n0"], scaleMatrix({ x: 0, y: 0 }, 10), "拡大縮小", "拡大縮小");
    expect(result.ok).toBe(false);
    expect(session.document).toBe(before);
    expect(session.canUndo).toBe(false);
  });
});
