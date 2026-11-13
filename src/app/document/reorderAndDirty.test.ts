import { describe, expect, it } from "vitest";
import { createDocument } from "../../core/model";
import { addEntitiesChangeSet } from "../../core/history";
import type { CadLayer, CadLine } from "../../types/cad";
import { DocumentSession } from "./documentSession";
import type { DocumentChange } from "./documentSession";
import { reorderSelection } from "./reorder";

const LAYERS: CadLayer[] = [{ name: "0", color: "#ffffff", visible: true }];

function line(id: string, x = 0): CadLine {
  return { id, type: "LINE", layer: "0", color: "#ffffff", start: { x, y: 0 }, end: { x: x + 10, y: 10 } };
}

/** 取り込んだ図形 e0, e1 の後ろに、新しい図形 n0, n1, n2 を追加したセッション */
function sessionWithNew(): DocumentSession {
  const session = new DocumentSession(createDocument({ layers: LAYERS, entities: [line("e0"), line("e1", 20)] }));
  session.apply(addEntitiesChangeSet(session.document, [line("n0", 40), line("n1", 60), line("n2", 80)], "追加"));
  return session;
}

const ids = (session: DocumentSession) => session.document.entities.map((e) => e.id);

describe("reorderSelection", () => {
  it("moves selected new entities to the back and to the front, keeping their order, in one Undo step each", () => {
    const session = sessionWithNew();
    const toBack = reorderSelection(session, ["n1", "n2"], "back");
    expect(toBack).toBe("2個の図形を最背面へ移動しました");
    expect(ids(session)).toEqual(["n1", "n2", "e0", "e1", "n0"]);
    expect(session.nextUndoLabel).toBe("最背面へ移動");

    const toFront = reorderSelection(session, ["n1"], "front");
    expect(toFront).toBe("1個の図形を最前面へ移動しました");
    expect(ids(session)).toEqual(["n2", "e0", "e1", "n0", "n1"]);

    session.undo();
    expect(ids(session)).toEqual(["n1", "n2", "e0", "e1", "n0"]);
    session.undo();
    expect(ids(session)).toEqual(["e0", "e1", "n0", "n1", "n2"]);
  });

  it("ignores imported entities in the selection and says how many", () => {
    const session = sessionWithNew();
    const message = reorderSelection(session, ["e0", "n0", "zzz"], "back");
    expect(message).toBe("1個の図形を最背面へ移動しました(取り込んだ図形 2 個は対象外)");
    expect(ids(session)).toEqual(["n0", "e0", "e1", "n1", "n2"]);
  });

  it("does nothing, with a clear message, when no new entity is selected", () => {
    const session = sessionWithNew();
    const before = ids(session);
    const undoCount = session.nextUndoLabel;
    expect(reorderSelection(session, ["e0", "e1"], "front")).toContain("新しく描いた図形が選択されていません");
    expect(reorderSelection(session, [], "front")).toContain("新しく描いた図形が選択されていません");
    expect(ids(session)).toEqual(before);
    expect(session.nextUndoLabel).toBe(undoCount);
  });

  it("says so when the entities are already at the front or back, and records no history", () => {
    const session = sessionWithNew();
    expect(reorderSelection(session, ["n2"], "front")).toBe("選択中の図形は、すでに最前面にあります");
    expect(reorderSelection(session, ["n0", "n1", "n2"], "front")).toBe("選択中の図形は、すでに最前面にあります");
    expect(session.nextUndoLabel).toBe("追加");
    const fresh = new DocumentSession(createDocument({ layers: LAYERS, entities: [] }));
    fresh.apply(addEntitiesChangeSet(fresh.document, [line("n0")], "追加"));
    expect(reorderSelection(fresh, ["n0"], "back")).toBe("選択中の図形は、すでに最背面にあります");
  });
});

describe("DocumentSession dirty tracking and state", () => {
  it("is clean when opened, dirty after a change, clean again when Undo returns to the opened state", () => {
    const session = new DocumentSession(createDocument({ layers: LAYERS, entities: [line("e0")] }));
    expect(session.isDirty).toBe(false);
    expect(session.state).toEqual({ canUndo: false, canRedo: false, isDirty: false });
    session.apply(addEntitiesChangeSet(session.document, [line("n0", 20)], "追加"));
    expect(session.isDirty).toBe(true);
    expect(session.state).toEqual({ canUndo: true, canRedo: false, isDirty: true });
    session.undo();
    expect(session.isDirty).toBe(false);
    expect(session.state).toEqual({ canUndo: false, canRedo: true, isDirty: false });
    session.redo();
    expect(session.isDirty).toBe(true);
  });

  it("markSaved makes the current state clean; further changes, or going back before it, are dirty", () => {
    const session = sessionWithNew();
    expect(session.isDirty).toBe(true);
    session.markSaved();
    expect(session.isDirty).toBe(false);
    session.apply(addEntitiesChangeSet(session.document, [line("n9", 100)], "追加"));
    expect(session.isDirty).toBe(true);
    session.undo();
    expect(session.isDirty).toBe(false); // 保存した状態に戻った
    session.undo();
    expect(session.isDirty).toBe(true); // 保存より前の状態
    session.redo();
    expect(session.isDirty).toBe(false);
  });

  it("a different change after Undo is dirty even if the history depth matches the saved one", () => {
    const session = new DocumentSession(createDocument({ layers: LAYERS, entities: [line("e0")] }));
    session.apply(addEntitiesChangeSet(session.document, [line("n0", 20)], "A"));
    session.markSaved();
    session.undo();
    session.apply(addEntitiesChangeSet(session.document, [line("n1", 40)], "B")); // 履歴の深さは同じ(1)だが、別の内容
    expect(session.isDirty).toBe(true);
  });

  it("tells subscribers the new state with every change", () => {
    const session = new DocumentSession(createDocument({ layers: LAYERS, entities: [line("e0")] }));
    const events: DocumentChange[] = [];
    session.subscribe((change) => events.push(change));
    session.apply(addEntitiesChangeSet(session.document, [line("n0", 20)], "追加"));
    session.undo();
    session.redo();
    expect(events.map((e) => e.state)).toEqual([
      { canUndo: true, canRedo: false, isDirty: true },
      { canUndo: false, canRedo: true, isDirty: false },
      { canUndo: true, canRedo: false, isDirty: true },
    ]);
  });
});
