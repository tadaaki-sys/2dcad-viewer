import { describe, expect, it } from "vitest";
import { createDocument } from "../../core/model";
import { rotationMatrix, translationMatrix, IDENTITY_MATRIX } from "../../core/geometry/transform";
import type { Affine2D, CadEntity, CadLayer } from "../../types/cad";
import { createEditability, NOT_MAPPED_REASON, READ_ONLY_REASON, resolveEditTargets } from "./editability";
import type { Editability, EditabilitySource } from "./editability";
import { copyEntities, deleteEntities, movedEntity, transformEntities } from "./editing";
import { DocumentSession } from "./documentSession";

const LAYERS: CadLayer[] = [{ name: "0", color: "#ffffff", visible: true }];
const base = { layer: "0", color: "#ffffff" };

const line = (id: string, x0: number, y0: number, x1: number, y1: number): CadEntity => ({ ...base, id, type: "LINE", start: { x: x0, y: y0 }, end: { x: x1, y: y1 } });
const circle = (id: string, x: number, y: number, r: number): CadEntity => ({ ...base, id, type: "CIRCLE", center: { x, y }, radius: r });

/** e0..e4 は取り込んだ図形(e3 はブロックの中身=読み取り専用)。あとから描いた図形は n0 など */
function setup(extra: CadEntity[] = []) {
  const imported: CadEntity[] = [
    line("e0", 0, 0, 100, 0),
    line("e1", 0, 10, 100, 10),
    circle("e2", 50, 50, 20),
    line("e3", 0, 20, 100, 20), // ブロックの中身
    line("e4", 0, 30, 100, 30),
  ];
  const session = new DocumentSession(createDocument({ layers: LAYERS, entities: [...imported, ...extra] }));
  const source: EditabilitySource = {
    importedIndexById: new Map(imported.map((entity, index) => [entity.id, index])),
    nested: Uint8Array.from([0, 0, 0, 1, 0]),
    parserIndex: Int32Array.from([0, 1, 2, 3, 4]),
  };
  return { session, editability: createEditability(source), imported };
}

const startOf = (entity: CadEntity | undefined) => (entity as { start: { x: number; y: number } }).start;

describe("editability", () => {
  it("imported top-level entities and new entities are editable; block contents are read-only", () => {
    const { editability } = setup();
    expect(editability.isEditable("e0")).toBe(true);
    expect(editability.isEditable("e3")).toBe(false);
    expect(editability.reasonFor("e3")).toBe(READ_ONLY_REASON);
    expect(editability.isEditable("n0")).toBe(true);
    expect(editability.isEditable("n123")).toBe(true);
    expect(editability.isEditable("e999")).toBe(false); // 取り込んだ図形の一覧に無い
  });

  it("without a source (mapping failed) imported entities are not editable but new ones are", () => {
    const editability = createEditability(null);
    expect(editability.reasonFor("e0")).toBe(NOT_MAPPED_REASON);
    expect(editability.isEditable("n0")).toBe(true);
  });

  it("an entity without a record in the source (parserIndex < 0) is not editable", () => {
    const editability = createEditability({ importedIndexById: new Map([["e0", 0]]), nested: Uint8Array.from([0]), parserIndex: Int32Array.from([-1]) });
    expect(editability.reasonFor("e0")).toBe(NOT_MAPPED_REASON);
  });

  it("a classification that does not cover the entity (out of range, or an unexpected value) fails closed: not editable", () => {
    const short = createEditability({ importedIndexById: new Map([["e0", 0], ["e1", 1]]), nested: Uint8Array.from([0]), parserIndex: Int32Array.from([0, 1]) });
    expect(short.isEditable("e0")).toBe(true);
    expect(short.isEditable("e1")).toBe(false); // nested の長さが足りない
    const shortParser = createEditability({ importedIndexById: new Map([["e1", 1]]), nested: Uint8Array.from([0, 0]), parserIndex: Int32Array.from([0]) });
    expect(shortParser.isEditable("e1")).toBe(false); // parserIndex の長さが足りない
    const odd = createEditability({ importedIndexById: new Map([["e0", 0]]), nested: Uint8Array.from([2]), parserIndex: Int32Array.from([0]) });
    expect(odd.reasonFor("e0")).toBe(READ_ONLY_REASON); // 0 以外は、読み取り専用
    const badIndex = createEditability({ importedIndexById: new Map([["e0", -1], ["e1", 0.5]]), nested: Uint8Array.from([0, 0]), parserIndex: Int32Array.from([0, 0]) });
    expect(badIndex.isEditable("e0")).toBe(false);
    expect(badIndex.isEditable("e1")).toBe(false);
  });
  it("resolveEditTargets keeps the editable ones (no duplicates) and says why the others were dropped", () => {
    const { editability } = setup();
    const result = resolveEditTargets(editability, ["e0", "e3", "e0", "n5", "e4"]);
    expect(result.editable).toEqual(["e0", "n5", "e4"]);
    expect(result.skipped).toBe(1);
    expect(result.reason).toBe(READ_ONLY_REASON);
    expect(resolveEditTargets(editability, [])).toEqual({ editable: [], skipped: 0, reason: null });
  });
});

describe("transformEntities", () => {
  it("moves the selected entities as ONE history step; Undo restores the identical document, Redo moves again", () => {
    const { session, editability } = setup();
    const before = session.document.entities;
    const outcome = transformEntities(session, editability, ["e0", "e1", "e2"], translationMatrix(10, 5), "3個の図形を移動", "移動");
    expect(outcome).toEqual({ ok: true, message: "3個の図形を移動しました" });
    expect(startOf(session.document.entities[0])).toEqual({ x: 10, y: 5 });
    expect(startOf(session.document.entities[1])).toEqual({ x: 10, y: 15 });
    expect(session.document.entities[3]).toBe(before[3]); // 触っていない図形は、同じ参照のまま
    expect(session.nextUndoLabel).toBe("3個の図形を移動");

    expect(session.undo().type).toBe("done"); // 1回で、3つとも戻る
    expect(session.canUndo).toBe(false);
    expect(session.document.entities).toEqual(before);
    expect(session.redo().type).toBe("done");
    expect(startOf(session.document.entities[2] ?? undefined)).toBeUndefined(); // 円には start が無い
    expect((session.document.entities[2] as { center: { x: number } }).center.x).toBe(60);
  });

  it("read-only entities are left out with a reason; if nothing is editable nothing changes", () => {
    const { session, editability } = setup();
    const mixed = transformEntities(session, editability, ["e0", "e3"], translationMatrix(1, 0), "移動", "移動");
    expect(mixed.ok).toBe(true);
    expect(mixed.message).toContain("1個の図形を移動しました");
    expect(mixed.message).toContain("編集できない図形 1 個は除きました");
    expect(startOf(session.document.entities[3])).toEqual({ x: 0, y: 20 }); // e3 は動かない

    const none = transformEntities(session, editability, ["e3"], translationMatrix(1, 0), "移動", "移動");
    expect(none.ok).toBe(false);
    expect(none.message).toContain(READ_ONLY_REASON);
    expect(session.nextUndoLabel).toBe("移動"); // 履歴は増えていない(最初の1つだけ)
  });

  it("refuses a zero move, a non-rigid matrix and unknown ids without touching the document", () => {
    const { session, editability } = setup();
    const before = session.document.entities;
    expect(transformEntities(session, editability, ["e0"], IDENTITY_MATRIX, "移動", "移動")).toEqual({ ok: false, message: "移動量が0です" });
    expect(transformEntities(session, editability, ["e0"], rotationMatrix({ x: 0, y: 0 }, 0), "回転", "回転")).toEqual({ ok: false, message: "回転角が0度です" });
    expect(transformEntities(session, editability, ["e0"], [2, 0, 0, 2, 0, 0], "拡大", "移動").ok).toBe(false);
    expect(transformEntities(session, editability, ["e404"], translationMatrix(1, 1), "移動", "移動").ok).toBe(false);
    expect(session.document.entities).toBe(before);
    expect(session.canUndo).toBe(false);
  });

  it("rotation by 90 degrees about a base point is exact", () => {
    const { session, editability } = setup();
    transformEntities(session, editability, ["e0"], rotationMatrix({ x: 0, y: 0 }, Math.PI / 2), "回転", "回転");
    const rotated = session.document.entities[0] as { start: { x: number; y: number }; end: { x: number; y: number } };
    expect(rotated.start).toEqual({ x: 0, y: 0 });
    expect(rotated.end).toEqual({ x: 0, y: 100 });
  });
});

describe("sourceRecord (what the save phase needs)", () => {
  it("moving an imported entity records which source record it is and how it was moved; moving again composes", () => {
    const { session, editability } = setup();
    expect(session.document.entities[0].sourceRecord).toBeUndefined();
    transformEntities(session, editability, ["e0"], translationMatrix(10, 0), "移動", "移動");
    const first = session.document.entities[0].sourceRecord;
    expect(first).toEqual({ id: "e0", matrix: [1, 0, 0, 1, 10, 0] });
    transformEntities(session, editability, ["e0"], rotationMatrix({ x: 0, y: 0 }, Math.PI / 2), "回転", "回転");
    const second = session.document.entities[0].sourceRecord!;
    expect(second.id).toBe("e0");
    // 元の記録の (0,0) → 移動して (10,0) → 回転して (0,10)
    // 元の記録の原点 (0,0) の行き先は、行列の移動の成分 (e, f)
    const [, , , , e, f] = second.matrix as Affine2D;
    expect({ x: e, y: f }).toEqual({ x: 0, y: 10 });
    // Undo で、対応は、動かす前(無し)に戻る
    session.undo();
    session.undo();
    expect(session.document.entities[0].sourceRecord).toBeUndefined();
  });

  it("a new entity (drawn here) gets no source record when moved", () => {
    const { session, editability } = setup([line("n0", 0, 0, 5, 5)]);
    transformEntities(session, editability, ["n0"], translationMatrix(3, 3), "移動", "移動");
    expect(session.document.entities[5].sourceRecord).toBeUndefined();
  });

  it("movedEntity does not change the original object", () => {
    const original = line("e0", 0, 0, 1, 1);
    const moved = movedEntity(original, translationMatrix(5, 5));
    expect(original).toEqual(line("e0", 0, 0, 1, 1));
    expect(moved.sourceRecord).toEqual({ id: "e0", matrix: [1, 0, 0, 1, 5, 5] });
  });
});

describe("copyEntities", () => {
  it("adds new entities (ids n<k>) at the end in the original drawing order, as ONE history step; Undo removes them all", () => {
    const { session, editability } = setup();
    const before = session.document.entities;
    const outcome = copyEntities(session, editability, ["e2", "e0"], [translationMatrix(0, 100)], "2個の図形をコピー");
    expect(outcome.ok).toBe(true);
    expect(session.document.entities).toHaveLength(7);
    const [firstCopy, secondCopy] = session.document.entities.slice(5);
    // 図面の並び(e0 が先、e2 が後)で追加される。IDは新しい
    expect(firstCopy.id).toBe("n0");
    expect(secondCopy.id).toBe("n1");
    expect((firstCopy as { start: { y: number } }).start.y).toBe(100);
    expect((secondCopy as { center: { y: number } }).center.y).toBe(150);
    // もとの図形は、そのまま
    expect(session.document.entities.slice(0, 5)).toEqual(before);
    session.undo();
    expect(session.document.entities).toEqual(before);
    expect(session.canUndo).toBe(false);
  });

  it("several copy positions in one command: all in one step, each with its own offset", () => {
    const { session, editability } = setup();
    copyEntities(session, editability, ["e0"], [translationMatrix(0, 100), translationMatrix(0, 200), translationMatrix(0, 300)], "図形をコピー(3回)");
    const copies = session.document.entities.slice(5) as Array<{ id: string; start: { y: number } }>;
    expect(copies.map((c) => c.start.y)).toEqual([100, 200, 300]);
    expect(copies.map((c) => c.id)).toEqual(["n0", "n1", "n2"]);
    session.undo();
    expect(session.document.entities).toHaveLength(5);
  });

  it("a copy of an imported entity points at the source record of the ORIGINAL imported entity, with the move composed", () => {
    const { session, editability } = setup();
    copyEntities(session, editability, ["e0"], [translationMatrix(0, 100)], "コピー");
    expect(session.document.entities[5].sourceRecord).toEqual({ id: "e0", matrix: [1, 0, 0, 1, 0, 100] });
    // コピーのコピー: 元の(取り込んだ)図形への対応のまま、変換が合成される
    copyEntities(session, editability, ["n0"], [translationMatrix(50, 0)], "コピー");
    expect(session.document.entities[6].sourceRecord).toEqual({ id: "e0", matrix: [1, 0, 0, 1, 50, 100] });
    // もとの図形を削除しても、コピーの対応は、変わらない
    deleteEntities(session, editability, ["e0"], "削除");
    expect(session.document.entities.find((e) => e.id === "n0")?.sourceRecord).toEqual({ id: "e0", matrix: [1, 0, 0, 1, 0, 100] });
  });

  it("a copy of a new entity has no source record; read-only entities are not copied", () => {
    const { session, editability } = setup([line("n9", 0, 0, 5, 5)]);
    copyEntities(session, editability, ["n9", "e3"], [translationMatrix(10, 0)], "コピー");
    const copy = session.document.entities[6];
    expect(copy.sourceRecord).toBeUndefined();
    expect(session.document.entities).toHaveLength(7); // n9 の分だけ
    expect(copyEntities(session, editability, ["e3"], [translationMatrix(1, 0)], "コピー").ok).toBe(false);
  });

  it("refuses without positions, with a zero offset, and keeps the source entity attributes (layer, color)", () => {
    const { session, editability } = setup();
    expect(copyEntities(session, editability, ["e0"], [], "コピー").ok).toBe(false);
    expect(copyEntities(session, editability, ["e0"], [IDENTITY_MATRIX], "コピー").ok).toBe(false);
    expect(session.document.entities).toHaveLength(5);
    const withStyle = line("e1", 0, 10, 100, 10);
    const styled = { ...withStyle, layer: "0", color: "#ff0000", lineWeight: 50 } as CadEntity;
    const session2 = new DocumentSession(createDocument({ layers: LAYERS, entities: [styled] }));
    const editability2 = createEditability({ importedIndexById: new Map([["e1", 0]]), nested: Uint8Array.from([0]), parserIndex: Int32Array.from([0]) });
    copyEntities(session2, editability2, ["e1"], [translationMatrix(0, 5)], "コピー");
    expect(session2.document.entities[1]).toMatchObject({ layer: "0", color: "#ff0000", lineWeight: 50 });
  });
});

describe("deleteEntities", () => {
  it("removes the editable ones as ONE history step; Undo puts them back in the same places", () => {
    const { session, editability } = setup();
    const before = session.document.entities;
    const outcome = deleteEntities(session, editability, ["e0", "e2", "e3"], "2個の図形を削除");
    expect(outcome.ok).toBe(true);
    expect(outcome.message).toContain("2個の図形を削除しました");
    expect(session.document.entities.map((e) => e.id)).toEqual(["e1", "e3", "e4"]);
    session.undo();
    expect(session.document.entities).toEqual(before);
    session.redo();
    expect(session.document.entities.map((e) => e.id)).toEqual(["e1", "e3", "e4"]);
  });

  it("nothing editable: refused with the reason, no history", () => {
    const { session, editability } = setup();
    const result = deleteEntities(session, editability, ["e3"], "削除");
    expect(result.ok).toBe(false);
    expect(result.message).toContain(READ_ONLY_REASON);
    expect(session.canUndo).toBe(false);
  });
});

describe("a large operation", () => {
  it("moving 20000 entities is one step, and Undo restores them exactly", () => {
    const entities: CadEntity[] = Array.from({ length: 20_000 }, (_, i) => line(`e${i}`, i, 0, i + 1, 1));
    const session = new DocumentSession(createDocument({ layers: LAYERS, entities }));
    const editability = createEditability({
      importedIndexById: new Map(entities.map((e, i) => [e.id, i])),
      nested: new Uint8Array(entities.length),
      parserIndex: Int32Array.from(entities, (_, i) => i),
    });
    const ids = entities.map((e) => e.id);
    const outcome = transformEntities(session, editability, ids, translationMatrix(5, 5), "20000個の図形を移動", "移動");
    expect(outcome.ok).toBe(true);
    expect(startOf(session.document.entities[19_999])).toEqual({ x: 20_004, y: 5 });
    session.undo();
    expect(session.document.entities).toEqual(entities);
  });
});

describe("an operation whose result would overflow is refused and changes nothing", () => {
  const point = (id: string, x: number): CadEntity => ({ ...base, id, type: "POINT", position: { x, y: 0 } });
  const all: Editability = { isEditable: () => true, reasonFor: () => null };

  it("MOVE: a finite coordinate that would become infinite is refused as a whole (no partial move)", () => {
    const session = new DocumentSession(createDocument({ layers: LAYERS, entities: [point("n0", 1e308), point("n1", 5)] }));
    const before = session.document;
    const result = transformEntities(session, all, ["n0", "n1"], translationMatrix(1e308, 0), "移動", "移動");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("大きすぎ");
    expect(session.document).toBe(before);
    expect(session.undo().type).not.toBe("done");
  });

  it("COPY: the same, and no entity is added", () => {
    const session = new DocumentSession(createDocument({ layers: LAYERS, entities: [point("n0", 1e308)] }));
    const before = session.document;
    const result = copyEntities(session, all, ["n0"], [translationMatrix(1e308, 0)], "複写");
    expect(result.ok).toBe(false);
    expect(session.document).toBe(before);
  });

  it("a composed source-record matrix that would overflow is refused", () => {
    const moved: CadEntity = { ...line("e0", 0, 0, 1, 0), sourceRecord: { id: "e0", matrix: translationMatrix(1.7e308, 0) } };
    const session = new DocumentSession(createDocument({ layers: LAYERS, entities: [moved] }));
    const before = session.document;
    const result = transformEntities(session, all, ["e0"], translationMatrix(1.7e308, 0), "移動", "移動");
    expect(result.ok).toBe(false);
    expect(session.document).toBe(before);
  });
});
