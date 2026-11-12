import { describe, expect, it } from "vitest";
import { createDocument } from "../../core/model";
import { addEntitiesChangeSet, removeEntitiesChangeSet, replaceEntitiesChangeSet } from "../../core/history";
import type { CadLayer, CadLine } from "../../types/cad";
import { describeHistoryOutcome, DocumentSession } from "./documentSession";
import type { DocumentChange } from "./documentSession";
import { renderModelFromDocument } from "./renderModel";

const LAYERS: CadLayer[] = [{ name: "0", color: "#ffffff", visible: true }];

function line(id: string, x = 0): CadLine {
  return { id, type: "LINE", layer: "0", color: "#ffffff", start: { x, y: 0 }, end: { x: x + 10, y: 10 } };
}

function newSession(ids: string[] = ["e0", "e1"]) {
  return new DocumentSession(createDocument({ layers: LAYERS, entities: ids.map((id, i) => line(id, i * 20)) }));
}

const idsOf = (session: DocumentSession) => session.document.entities.map((e) => e.id);

describe("DocumentSession", () => {
  it("applies a change, records it, and notifies subscribers with the new document", () => {
    const session = newSession();
    const events: DocumentChange[] = [];
    session.subscribe((change) => events.push(change));

    const outcome = session.apply(addEntitiesChangeSet(session.document, [line("n0", 50)], "線を追加"));
    expect(outcome).toEqual({ ok: true });
    expect(idsOf(session)).toEqual(["e0", "e1", "n0"]);
    expect(session.canUndo).toBe(true);
    expect(session.nextUndoLabel).toBe("線を追加");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "apply", label: "線を追加" });
    expect(events[0].document).toBe(session.document);
  });

  it("does not change anything or notify when a change is rejected", () => {
    const session = newSession();
    const events: DocumentChange[] = [];
    session.subscribe((change) => events.push(change));
    const before = session.document;
    const outcome = session.apply({ label: "x", changes: [{ kind: "add", entity: line("e0"), index: 2 }] });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain("e0");
    expect(session.document).toBe(before);
    expect(session.canUndo).toBe(false);
    expect(events).toEqual([]);
  });

  it("undoes and redoes, notifying with kind and label", () => {
    const session = newSession();
    const events: DocumentChange[] = [];
    session.subscribe((change) => events.push(change));
    session.apply(removeEntitiesChangeSet(session.document, ["e0"], "削除"));
    expect(idsOf(session)).toEqual(["e1"]);

    const undone = session.undo();
    expect(undone).toMatchObject({ type: "done", label: "削除" });
    expect(idsOf(session)).toEqual(["e0", "e1"]);
    expect(session.canRedo).toBe(true);
    expect(session.nextRedoLabel).toBe("削除");

    const redone = session.redo();
    expect(redone).toMatchObject({ type: "done", label: "削除" });
    expect(idsOf(session)).toEqual(["e1"]);
    expect(events.map((e) => e.kind)).toEqual(["apply", "undo", "redo"]);
  });

  it("returns empty and does not notify when there is nothing to undo or redo", () => {
    const session = newSession();
    const events: DocumentChange[] = [];
    session.subscribe((change) => events.push(change));
    expect(session.undo()).toEqual({ type: "empty" });
    expect(session.redo()).toEqual({ type: "empty" });
    expect(events).toEqual([]);
  });

  it("allocates ids without recording history or notifying, and never reuses them after Undo", () => {
    const session = newSession();
    const events: DocumentChange[] = [];
    session.subscribe((change) => events.push(change));
    const first = session.allocateEntityId();
    expect(first).toBe("n0");
    expect(session.canUndo).toBe(false);
    expect(events).toEqual([]);
    session.apply(addEntitiesChangeSet(session.document, [line(first)], "追加"));
    session.undo();
    expect(session.allocateEntityId()).toBe("n1");
  });

  it("stops notifying after unsubscribe, and one failing subscriber does not block the others", () => {
    const session = newSession();
    let calls = 0;
    const stop = session.subscribe(() => {
      calls++;
    });
    session.apply(addEntitiesChangeSet(session.document, [line("n0")], "a"));
    stop();
    session.apply(addEntitiesChangeSet(session.document, [line("n1")], "b"));
    expect(calls).toBe(1);

    const other = newSession();
    let reached = false;
    const stopFailing = other.subscribe(() => {
      throw new Error("subscriber failed");
    });
    other.subscribe(() => {
      reached = true;
    });
    expect(() => other.apply(addEntitiesChangeSet(other.document, [line("n0")], "a"))).toThrow("subscriber failed");
    expect(reached).toBe(true);
    // 状態は更新済みで、履歴とも一致している
    expect(other.document.entities).toHaveLength(3);
    stopFailing();
    expect(other.undo()).toMatchObject({ type: "done" });
    expect(other.document.entities).toHaveLength(2);
  });

  it("keeps the 200 step limit by default and accepts a custom one", () => {
    const session = new DocumentSession(createDocument({ layers: LAYERS, entities: [line("e0")] }), 2);
    for (let i = 0; i < 5; i++) session.apply(addEntitiesChangeSet(session.document, [line(`n${i}`)], `n${i}`));
    session.undo();
    session.undo();
    expect(session.undo()).toEqual({ type: "empty" });
    expect(idsOf(session)).toEqual(["e0", "n0", "n1", "n2"]);
  });
});

describe("describeHistoryOutcome", () => {
  it("writes the message shown in the command line", () => {
    expect(describeHistoryOutcome("undo", { type: "done", document: newSession().document, label: "線を追加" })).toBe("元に戻しました: 線を追加");
    expect(describeHistoryOutcome("redo", { type: "done", document: newSession().document, label: "線を追加" })).toBe("やり直しました: 線を追加");
    expect(describeHistoryOutcome("undo", { type: "empty" })).toBe("元に戻す操作がありません");
    expect(describeHistoryOutcome("redo", { type: "empty" })).toBe("やり直す操作がありません");
    expect(describeHistoryOutcome("undo", { type: "error", error: "理由" })).toContain("履歴を破棄しました");
  });
});

describe("renderModelFromDocument", () => {
  it("rebuilds the draw model, bounds included, after each change and after Undo", () => {
    const session = newSession(["e0"]); // (0,0)-(10,10)
    expect(renderModelFromDocument(session.document).bounds).toEqual({ min: { x: 0, y: 0 }, max: { x: 10, y: 10 } });

    session.apply(addEntitiesChangeSet(session.document, [line("n0", 100)], "追加")); // (100,0)-(110,10)
    const after = renderModelFromDocument(session.document);
    expect(after.entities.map((e) => e.id)).toEqual(["e0", "n0"]);
    expect(after.bounds).toEqual({ min: { x: 0, y: 0 }, max: { x: 110, y: 10 } });
    expect(after.entityBounds).toHaveLength(2 * 4);

    session.apply(replaceEntitiesChangeSet(session.document, [line("e0", 500)], "移動"));
    expect(renderModelFromDocument(session.document).bounds).toEqual({ min: { x: 100, y: 0 }, max: { x: 510, y: 10 } });

    session.undo();
    session.undo();
    const restored = renderModelFromDocument(session.document);
    expect(restored.entities.map((e) => e.id)).toEqual(["e0"]);
    expect(restored.bounds).toEqual({ min: { x: 0, y: 0 }, max: { x: 10, y: 10 } });
  });

  it("an empty drawing has no bounds", () => {
    const session = newSession(["e0"]);
    session.apply(removeEntitiesChangeSet(session.document, ["e0"], "削除"));
    const model = renderModelFromDocument(session.document);
    expect(model.entities).toEqual([]);
    expect(model.bounds).toBeNull();
  });
});
