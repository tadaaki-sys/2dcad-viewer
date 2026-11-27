// グループ・ロック・描画順の適用(Phase 19): 作成・解除・編集・名前変更・削除に伴う整理・複写・ロックの効き方・描画順
import { describe, expect, it } from "vitest";
import { createDocument } from "../../core/model";
import { translationMatrix } from "../../core/geometry/transform";
import { expandSelectionChange, groupOf, nextAnonymousName, validateGroupName } from "../../core/group/groups";
import type { CadEntity, CadGroup, CadLayer, Point2D } from "../../types/cad";
import { createAppEditing } from "./appEditing";
import { createEditability, withLockedLayers } from "./editability";
import { DocumentSession } from "./documentSession";
import { copyEntities, deleteEntities, transformEntities } from "./editing";
import { moveGrip } from "./gripEditing";
import { createGroup, editGroup, groupsForCopies, planGroupMaintenance, renameGroup, ungroup } from "./grouping";
import { editLayer, setLayerLocked } from "./layering";
import { setStyleProperty } from "./propertyEditing";
import { reorderEntities, textToFront } from "./reorder";

const pt = (x: number, y: number): Point2D => ({ x, y });
const LAYERS: CadLayer[] = [
  { name: "0", color: "#ffffff", visible: true },
  { name: "L", color: "#ff0000", visible: true },
];
const line = (id: string, layer = "0", x = 0): CadEntity => ({ id, type: "LINE", layer, color: "#fff", start: pt(x, 0), end: pt(x + 10, 0) });
const text = (id: string): CadEntity => ({ id, type: "TEXT", layer: "0", color: "#fff", position: pt(0, 0), text: "x", height: 3, rotation: 0, horizontalAlign: "left", verticalAlign: "baseline" });

function setup(entities: CadEntity[] = [line("n0"), line("n1", "0", 20), line("n2", "0", 40), line("n3", "L", 60)], groups: CadGroup[] = []) {
  const session = new DocumentSession(createDocument({ layers: LAYERS, entities, groups }));
  const base = createEditability(null);
  return { session, editability: withLockedLayers(base, () => session.document) };
}
const ids = (session: DocumentSession) => session.document.entities.map((e) => e.id);

describe("core: names, lookups and selection", () => {
  it("validates names (trim, empty, '*', control characters, duplicates ignoring case) and makes anonymous names", () => {
    const groups: CadGroup[] = [{ name: "Conveyor", ids: ["a"] }, { name: "*A1", ids: ["b"] }];
    expect(validateGroupName("  Line1 ", groups)).toEqual({ ok: true, value: "Line1" });
    for (const bad of ["", "   ", "*X", "a\tb", "CONVEYOR", "x".repeat(256)]) expect(validateGroupName(bad, groups).ok, JSON.stringify(bad)).toBe(false);
    expect(validateGroupName("conveyor", groups, "Conveyor").ok).toBe(true);
    expect(nextAnonymousName(groups)).toBe("*A2");
    expect(nextAnonymousName(groups, new Set(["*A2"]))).toBe("*A3");
    expect(groupOf(groups, "b")?.name).toBe("*A1");
    expect(groupOf(groups, "zz")).toBeUndefined();
  });

  it("expandSelectionChange adds the whole group of a newly picked member, removes the whole group of a removed one, and skips members that cannot be selected", () => {
    const groups: CadGroup[] = [{ name: "G", ids: ["a", "b", "c"] }];
    const all = () => true;
    expect([...expandSelectionChange(groups, new Set(), new Set(["a"]), all)].sort()).toEqual(["a", "b", "c"]);
    expect([...expandSelectionChange(groups, new Set(["a", "b", "c", "x"]), new Set(["b", "c", "x"]), all)]).toEqual(["x"]);
    expect([...expandSelectionChange(groups, new Set(), new Set(["a"]), (id) => id !== "c")].sort()).toEqual(["a", "b"]);
    expect([...expandSelectionChange([], new Set(), new Set(["a"]), all)]).toEqual(["a"]);
    // クリック(置き換え): 選んであるグループの1つをクリックし直しても、グループの全員のまま
    expect([...expandSelectionChange(groups, new Set(["a", "b", "c"]), new Set(["b"]), all, "replace")].sort()).toEqual(["a", "b", "c"]);
    // Ctrl+クリック(切り替え)で1つ外すと、グループごと外れる。2つの図形のグループでも、置き換えと区別される
    const pair: CadGroup[] = [{ name: "P", ids: ["a", "b"] }];
    expect([...expandSelectionChange(pair, new Set(["a", "b"]), new Set(["a"]), all, "toggle")]).toEqual([]);
    expect([...expandSelectionChange(pair, new Set(["a", "b"]), new Set(["a"]), all, "replace")].sort()).toEqual(["a", "b"]);
    // Ctrl+窓(追加): いままでの選択に、加わった図形のグループを足す(外れない)
    expect([...expandSelectionChange(groups, new Set(["x"]), new Set(["x", "a"]), all, "add")].sort()).toEqual(["a", "b", "c", "x"]);
  });
});

describe("groups", () => {
  it("creates a named group as one undo step, refuses figures already in a group, and ungroups", () => {
    const { session, editability } = setup();
    expect(createGroup(session, editability, ["n0", "n1"], "Unit").ok).toBe(true);
    expect(session.document.groups).toEqual([{ name: "Unit", ids: ["n0", "n1"] }]);
    const again = createGroup(session, editability, ["n1", "n2"], "Other");
    expect(again.ok).toBe(false);
    expect(again.message).toContain("Unit");
    expect(createGroup(session, editability, ["n2"], null).message).toContain("*A1");
    expect(ungroup(session, ["n1"]).ok).toBe(true);
    expect(session.document.groups.map((g) => g.name)).toEqual(["*A1"]);
    session.undo();
    session.undo();
    session.undo();
    expect(session.document.groups).toEqual([]);
    expect(session.canUndo).toBe(false);
  });

  it("refuses bad names and figures that cannot be edited (locked layer)", () => {
    const { session, editability } = setup();
    expect(createGroup(session, editability, ["n0"], "*bad").ok).toBe(false);
    setLayerLocked(session, "L", true);
    const locked = createGroup(session, editability, ["n3"], "X");
    expect(locked.ok).toBe(false);
    expect(locked.message).toContain("ロック");
  });

  it("adds to and removes from a group; removing the last member deletes the group; renames", () => {
    const { session, editability } = setup(undefined, [{ name: "G", ids: ["n0"] }]);
    expect(editGroup(session, editability, "g", ["n1", "n2"], "add").ok).toBe(true);
    expect(session.document.groups[0].ids).toEqual(["n0", "n1", "n2"]);
    expect(editGroup(session, editability, "G", ["n0", "n1"], "remove").ok).toBe(true);
    expect(session.document.groups[0].ids).toEqual(["n2"]);
    expect(renameGroup(session, "G", "Line A").ok).toBe(true);
    expect(session.document.groups[0].name).toBe("Line A");
    expect(editGroup(session, editability, "Line A", ["n2"], "remove").message).toContain("削除しました");
    expect(session.document.groups).toEqual([]);
    expect(editGroup(session, editability, "NOPE", ["n0"], "add").ok).toBe(false);
  });

  it("a locked figure cannot be used to ungroup or be taken out of its group (the group panel, which names the group, can still ungroup)", () => {
    const { session, editability } = setup(undefined, [{ name: "G", ids: ["n0", "n3"] }]);
    setLayerLocked(session, "L", true);
    const byLocked = ungroup(session, ["n3"], editability);
    expect(byLocked.ok).toBe(false);
    expect(byLocked.message).toContain("ロック");
    const takeOut = editGroup(session, editability, "G", ["n3"], "remove");
    expect(takeOut.ok).toBe(false);
    expect(takeOut.message).toContain("ロック");
    // 編集できる図形と一緒なら、そちらだけ外れる
    expect(editGroup(session, editability, "G", ["n0", "n3"], "remove").message).toContain("残り 1 個");
    expect(session.document.groups).toEqual([{ name: "G", ids: ["n3"] }]);
    // 編集できるメンバーを選んでの解除は、できる。パネルからの解除(editability なし)も、できる
    session.undo();
    expect(ungroup(session, ["n0"], editability).ok).toBe(true);
    session.undo();
    expect(ungroup(session, ["n3"]).ok).toBe(true);
    expect(session.document.groups).toEqual([]);
  });

  it("copy names skip names already in use (ignoring case), without gathering the names again per copy", () => {
    const { session } = setup(undefined, [{ name: "G", ids: ["n0"] }, { name: "*a1", ids: ["n1"] }, { name: "*A3", ids: ["n2"] }]);
    const maps = [new Map([["n0", "c1"]]), new Map([["n0", "c2"]]), new Map([["n0", "c3"]])];
    const changes = groupsForCopies(session.document, new Set(["n0"]), maps);
    expect(changes.map((c) => (c.kind === "groupAdd" ? [c.group.name, c.index] : null))).toEqual([["*A2", 3], ["*A4", 4], ["*A5", 5]]);
    // 2,000 個のグループを、それぞれ複写しても速い
    const many: CadGroup[] = Array.from({ length: 2_000 }, (_, i) => ({ name: `*A${i + 1}`, ids: [`m${i}`] }));
    const source = new Set(many.map((g) => g.ids[0]));
    const started = Date.now();
    const big = groupsForCopies({ ...session.document, groups: many }, source, [new Map(many.map((g) => [g.ids[0], `${g.ids[0]}c`]))]);
    expect(Date.now() - started).toBeLessThan(500);
    expect(big).toHaveLength(2_000);
    expect(big[0].kind === "groupAdd" && big[0].group.name).toBe("*A2001");
  });

  it("a figure that is in another group cannot be added", () => {
    const { session, editability } = setup(undefined, [{ name: "G", ids: ["n0"] }, { name: "H", ids: ["n1"] }]);
    const result = editGroup(session, editability, "G", ["n1"], "add");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("「H」");
    expect(session.document.groups).toEqual([{ name: "G", ids: ["n0"] }, { name: "H", ids: ["n1"] }]);
  });

  it("deleting members removes them from their group in the SAME undo step; an emptied group is deleted with a notice", () => {
    const originals = [line("n0"), line("n1", "0", 20), line("n2", "0", 40)];
    const { session, editability } = setup(originals, [{ name: "G", ids: ["n0", "n1"] }, { name: "H", ids: ["n2"] }]);
    expect(deleteEntities(session, editability, ["n0", "n2"], "削除").ok).toBe(true);
    expect(session.document.groups).toEqual([{ name: "G", ids: ["n1"] }]);
    expect(session.takeNotice()).toContain("「H」");
    session.undo();
    expect(session.document.groups).toEqual([{ name: "G", ids: ["n0", "n1"] }, { name: "H", ids: ["n2"] }]);
    expect(session.document.entities.every((e, i) => e === originals[i])).toBe(true);
    expect(session.canUndo).toBe(false);
  });

  it("planGroupMaintenance leaves changes alone when nothing grouped is removed (and when the change edits groups itself)", () => {
    const { session } = setup(undefined, [{ name: "G", ids: ["n0"] }]);
    const plain = { label: "x", changes: [{ kind: "remove" as const, entity: session.document.entities[2], index: 2 }] };
    expect(planGroupMaintenance(session.document, plain).changeSet).toBe(plain);
    // 取り出して入れ直す(描画順)は、削除ではない
    const reorder = { label: "x", changes: [{ kind: "remove" as const, entity: session.document.entities[0], index: 0 }, { kind: "add" as const, entity: session.document.entities[0], index: 3 }] };
    expect(planGroupMaintenance(session.document, reorder).changeSet).toBe(reorder);
  });

  it("copying all members of a group gives each copy its own anonymous group; copying part of a group does not", () => {
    const { session, editability } = setup(undefined, [{ name: "G", ids: ["n0", "n1"] }]);
    expect(copyEntities(session, editability, ["n0", "n1"], [translationMatrix(0, 100), translationMatrix(0, 200)], "複写").ok).toBe(true);
    expect(session.document.groups.map((g) => g.name)).toEqual(["G", "*A1", "*A2"]);
    expect(session.document.groups[1].ids).toHaveLength(2);
    expect(session.document.groups[1].ids.every((id) => !["n0", "n1"].includes(id))).toBe(true);
    session.undo();
    expect(session.document.groups.map((g) => g.name)).toEqual(["G"]);
    expect(copyEntities(session, editability, ["n0"], [translationMatrix(0, 100)], "複写").ok).toBe(true);
    expect(session.document.groups.map((g) => g.name)).toEqual(["G"]);
  });
});

describe("layer lock", () => {
  it("locking is one undo step; locked figures cannot be moved, deleted, grip-edited or restyled; unlocking restores editing", () => {
    const { session, editability } = setup();
    expect(setLayerLocked(session, "L", true).ok).toBe(true);
    expect(session.document.layers[1].locked).toBe(true);
    expect(transformEntities(session, editability, ["n3"], translationMatrix(5, 0), "移動", "移動").ok).toBe(false);
    expect(deleteEntities(session, editability, ["n3"], "削除").ok).toBe(false);
    expect(moveGrip(session, editability, "n3", 0, pt(1, 1)).ok).toBe(false);
    expect(setStyleProperty(session, editability, ["n3"], { kind: "color", value: "#00ff00" }).ok).toBe(false);
    // ロックされていない図形と一緒なら、そちらだけ動く(除いた数と理由を知らせる)
    const mixed = transformEntities(session, editability, ["n0", "n3"], translationMatrix(5, 0), "移動", "移動");
    expect(mixed.ok).toBe(true);
    expect(mixed.message).toContain("ロック");
    expect(setLayerLocked(session, "L", true).ok).toBe(false);
    expect(setLayerLocked(session, "L", false).ok).toBe(true);
    expect(session.document.layers[1].locked).toBeUndefined();
    expect(deleteEntities(session, editability, ["n3"], "削除").ok).toBe(true);
  });

  it("changing the color of a locked layer keeps it locked", () => {
    const { session } = setup();
    setLayerLocked(session, "L", true);
    expect(editLayer(session, "L", { color: "#00ff00" }).ok).toBe(true);
    expect(session.document.layers[1]).toMatchObject({ color: "#00ff00", locked: true });
  });

  it("the import classification reason comes first; the lock reason is used only for otherwise editable figures", () => {
    const session = new DocumentSession(createDocument({ layers: LAYERS, entities: [line("e0", "L"), line("n0", "L")] }));
    const editability = withLockedLayers(createEditability(null), () => session.document);
    setLayerLocked(session, "L", true);
    expect(editability.reasonFor("e0")).toContain("対応づけられなかった");
    expect(editability.reasonFor("n0")).toContain("ロック");
    expect(withLockedLayers(createEditability(null), () => null).reasonFor("n0")).toBeNull();
  });

  it("Undo of a lock unlocks; the visibility (a view setting) is kept", () => {
    const { session } = setup();
    session.setLayerVisible("L", false);
    setLayerLocked(session, "L", true);
    session.undo();
    expect(session.document.layers[1].locked).toBeUndefined();
    expect(session.document.layers[1].visible).toBe(false);
  });
});

describe("draw order", () => {
  it("DRAWORDER front / back / above / below as one undo step each; locked figures are left out", () => {
    const { session, editability } = setup();
    expect(reorderEntities(session, editability, ["n0"], { kind: "front" }).ok).toBe(true);
    expect(ids(session)).toEqual(["n1", "n2", "n3", "n0"]);
    expect(reorderEntities(session, editability, ["n0"], { kind: "below", referenceId: "n1" }).ok).toBe(true);
    expect(ids(session)).toEqual(["n0", "n1", "n2", "n3"]);
    expect(reorderEntities(session, editability, ["n0"], { kind: "above", referenceId: "n2" }).ok).toBe(true);
    expect(ids(session)).toEqual(["n1", "n2", "n0", "n3"]);
    expect(reorderEntities(session, editability, ["n0"], { kind: "above", referenceId: "n2" }).message).toContain("すでに");
    setLayerLocked(session, "L", true);
    expect(reorderEntities(session, editability, ["n3"], { kind: "back" }).ok).toBe(false);
    // 基準の図形は、ロックされていてもよい(動かさない)
    expect(reorderEntities(session, editability, ["n1"], { kind: "above", referenceId: "n3" }).ok).toBe(true);
    expect(ids(session)).toEqual(["n2", "n0", "n3", "n1"]);
  });

  it("the reference pick (DRAWORDER) finds a locked figure; an ordinary pick refuses it with the lock reason", () => {
    const { session, editability } = setup();
    setLayerLocked(session, "L", true);
    const app = createAppEditing({
      ready: true,
      getSession: () => session,
      getEditability: () => editability,
      getSelection: () => [],
      getVisibleLayerNames: () => new Set(["0", "L"]),
      getPickTolerance: () => 1,
      takePendingGrip: () => null,
    });
    expect(app.pickEntity(pt(65, 0), "描画順の基準", "reference")).toEqual({ ok: true, id: "n3" });
    const plain = app.pickEntity(pt(65, 0), "描画順の基準", "any");
    expect(plain.ok).toBe(false);
    if (!plain.ok) expect(plain.message).toContain("ロック");
  });

  it("the reference figure itself is left out of the moved figures (selecting it too is not an error)", () => {
    const { session, editability } = setup();
    expect(reorderEntities(session, editability, ["n0", "n2"], { kind: "above", referenceId: "n2" }).ok).toBe(true);
    expect(ids(session)).toEqual(["n1", "n2", "n0", "n3"]);
  });

  it("TEXTTOFRONT sends texts and dimensions to the front, keeping their order", () => {
    const dimension = {
      id: "n4", type: "DIMENSION", layer: "0", color: "#fff", kind: "linear", rotation: 0, p1: pt(0, 0), p2: pt(10, 0), position: pt(5, 5),
      values: { textHeight: 1, arrowSize: 1, decimals: 0, angleDecimals: 0, unit: "mm", showUnit: false, extensionOffset: 0 },
    } as CadEntity;
    const { session, editability } = setup([text("n0"), dimension, line("n1"), text("n2"), line("n3")]);
    expect(textToFront(session, editability).ok).toBe(true);
    expect(ids(session)).toEqual(["n1", "n3", "n0", "n4", "n2"]);
    expect(textToFront(session, editability).message).toContain("すでに");
    const none = setup([line("n0")]);
    expect(textToFront(none.session, none.editability).ok).toBe(false);
  });

  it("a grouped figure moved in the draw order stays in its group (a reorder is not a deletion)", () => {
    const { session, editability } = setup(undefined, [{ name: "G", ids: ["n0", "n1"] }]);
    expect(reorderEntities(session, editability, ["n0"], { kind: "front" }).ok).toBe(true);
    expect(session.document.groups).toEqual([{ name: "G", ids: ["n0", "n1"] }]);
  });
});
