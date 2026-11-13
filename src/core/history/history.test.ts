import { describe, expect, it } from "vitest";
import { applyChangeSet } from "./apply";
import {
  addEntitiesChangeSet,
  removeEntitiesChangeSet,
  replaceEntitiesChangeSet,
} from "./changeSet";
import type { ChangeSet } from "./changeSet";
import { DEFAULT_UNDO_LIMIT, DocumentHistory } from "./history";
import type { CadDocument } from "../model/document";
import { allocateEntityId } from "../model/document";
import { expectSameDocument, idsOf, makeDocument, makeLine, seededRandom } from "./testHelpers";

/** 適用して履歴に記録する(DocumentSession と同じ手順) */
function applyAndRecord(history: DocumentHistory, document: CadDocument, changeSet: ChangeSet): CadDocument {
  const result = applyChangeSet(document, changeSet);
  if (!result.ok) throw new Error(result.error);
  history.record(changeSet);
  return result.document;
}

function undoOk(history: DocumentHistory, document: CadDocument): CadDocument {
  const outcome = history.undo(document);
  if (outcome.type !== "done") throw new Error(`undo: ${outcome.type}`);
  return outcome.document;
}

function redoOk(history: DocumentHistory, document: CadDocument): CadDocument {
  const outcome = history.redo(document);
  if (outcome.type !== "done") throw new Error(`redo: ${outcome.type}`);
  return outcome.document;
}

describe("DocumentHistory", () => {
  it("undoes and redoes in order, with the label of each step", () => {
    const history = new DocumentHistory();
    let doc = makeDocument(["a"]);
    const original = doc;
    doc = applyAndRecord(history, doc, addEntitiesChangeSet(doc, [makeLine("b")], "線を追加"));
    doc = applyAndRecord(history, doc, removeEntitiesChangeSet(doc, ["a"], "削除"));
    expect(idsOf(doc)).toEqual(["b"]);
    expect(history.nextUndoLabel).toBe("削除");

    const first = history.undo(doc);
    expect(first).toMatchObject({ type: "done", label: "削除" });
    doc = (first as { document: CadDocument }).document;
    expect(idsOf(doc)).toEqual(["a", "b"]);
    expect(history.nextUndoLabel).toBe("線を追加");
    expect(history.nextRedoLabel).toBe("削除");

    doc = undoOk(history, doc);
    expect(expectSameDocument(doc, original)).toBeNull();
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(true);

    doc = redoOk(history, doc);
    doc = redoOk(history, doc);
    expect(idsOf(doc)).toEqual(["b"]);
    expect(history.canRedo).toBe(false);
  });

  it("reports empty when there is nothing to undo or redo", () => {
    const history = new DocumentHistory();
    const doc = makeDocument(["a"]);
    expect(history.undo(doc)).toEqual({ type: "empty" });
    expect(history.redo(doc)).toEqual({ type: "empty" });
  });

  it("drops the redo stack when a new change is recorded", () => {
    const history = new DocumentHistory();
    let doc = makeDocument(["a"]);
    doc = applyAndRecord(history, doc, addEntitiesChangeSet(doc, [makeLine("b")], "b"));
    doc = undoOk(history, doc);
    expect(history.canRedo).toBe(true);
    doc = applyAndRecord(history, doc, addEntitiesChangeSet(doc, [makeLine("c")], "c"));
    expect(history.canRedo).toBe(false);
    expect(history.redo(doc)).toEqual({ type: "empty" });
    expect(history.undoCount).toBe(1);
  });

  it("keeps at most the limit of steps, dropping the oldest", () => {
    const history = new DocumentHistory(3);
    let doc = makeDocument(["a"]);
    for (const id of ["b", "c", "d", "e", "f"]) doc = applyAndRecord(history, doc, addEntitiesChangeSet(doc, [makeLine(id)], id));
    expect(history.undoCount).toBe(3);
    for (let i = 0; i < 3; i++) doc = undoOk(history, doc);
    expect(idsOf(doc)).toEqual(["a", "b", "c"]); // 古い2つ(b, c の追加)は戻せない
    expect(history.undo(doc)).toEqual({ type: "empty" });
  });

  it("defaults to 200 steps and rejects a bad limit", () => {
    expect(DEFAULT_UNDO_LIMIT).toBe(200);
    expect(() => new DocumentHistory(0)).toThrow();
    expect(() => new DocumentHistory(1.5)).toThrow();
    const history = new DocumentHistory();
    let doc = makeDocument(["a"]);
    for (let i = 0; i < 250; i++) doc = applyAndRecord(history, doc, addEntitiesChangeSet(doc, [makeLine(`x${i}`)], `x${i}`));
    expect(history.undoCount).toBe(200);
  });

  it("on a mismatch, leaves the document alone, reports the reason and discards the history", () => {
    const history = new DocumentHistory();
    let doc = makeDocument(["a"]);
    doc = applyAndRecord(history, doc, addEntitiesChangeSet(doc, [makeLine("b")], "追加"));
    // 履歴を通さずに、図面が別のものに変わってしまった(通常は起きない)
    const tampered = makeDocument(["x", "y"]);
    const outcome = history.undo(tampered);
    expect(outcome.type).toBe("error");
    expect(idsOf(tampered)).toEqual(["x", "y"]);
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
    expect(idsOf(doc)).toEqual(["a", "b"]);
  });

  it("clear empties both stacks", () => {
    const history = new DocumentHistory();
    let doc = makeDocument(["a"]);
    doc = applyAndRecord(history, doc, addEntitiesChangeSet(doc, [makeLine("b")], "b"));
    doc = undoOk(history, doc);
    history.clear();
    expect(history.canUndo || history.canRedo).toBe(false);
  });

  it("a multi-change step is undone in one go", () => {
    const history = new DocumentHistory();
    let doc = makeDocument(["a", "b", "c"]);
    const original = doc;
    doc = applyAndRecord(history, doc, removeEntitiesChangeSet(doc, ["a", "b", "c"], "3個を削除"));
    expect(idsOf(doc)).toEqual([]);
    doc = undoOk(history, doc);
    expect(expectSameDocument(doc, original)).toBeNull();
  });
});

describe("random sequences: undo everything returns to the original, redo everything to the last state", () => {
  for (const seed of [1, 2, 3, 42, 2024]) {
    it(`seed ${seed}`, () => {
      const random = seededRandom(seed);
      const pick = (n: number) => Math.floor(random() * n);
      const history = new DocumentHistory(1000);
      let doc = makeDocument(Array.from({ length: 30 }, (_, i) => `e${i}`));
      const original = doc;
      const snapshots: CadDocument[] = [doc];

      for (let step = 0; step < 150; step++) {
        const ids = idsOf(doc);
        const kind = ids.length === 0 ? 0 : pick(5);
        let changeSet: ChangeSet;
        if (kind === 0) {
          // 追加(複数・途中の位置を含む)
          const count = 1 + pick(3);
          const changes = [];
          let working = doc;
          for (let i = 0; i < count; i++) {
            const allocated = allocateEntityId(working);
            working = allocated.document;
            changes.push({ kind: "add" as const, entity: makeLine(allocated.id, pick(500), pick(2) === 0 ? "0" : "MACHINE"), index: pick(ids.length + i + 1) });
          }
          doc = working; // 払い出し番号は進む(履歴には入らない)
          changeSet = { label: `add${step}`, changes };
        } else if (kind === 1) {
          const count = 1 + pick(Math.min(4, ids.length));
          changeSet = removeEntitiesChangeSet(doc, Array.from({ length: count }, () => ids[pick(ids.length)]), `remove${step}`);
        } else if (kind === 2) {
          const id = ids[pick(ids.length)];
          changeSet = replaceEntitiesChangeSet(doc, [makeLine(id, 1000 + step)], `replace${step}`);
        } else if (kind === 4) {
          // 描画順の入れ替え(任意の位置から任意の位置へ)
          const from = pick(ids.length);
          changeSet = { label: `move${step}`, changes: [{ kind: "move", entity: doc.entities[from], from, to: pick(ids.length) }] };
        } else {
          // 混合: 先頭を置き換え、末尾に追加
          const first = doc.entities[0];
          const allocated = allocateEntityId(doc);
          doc = allocated.document;
          changeSet = {
            label: `mixed${step}`,
            changes: [
              { kind: "replace", before: first, after: makeLine(first.id, 2000 + step), index: 0 },
              { kind: "add", entity: makeLine(allocated.id), index: ids.length },
            ],
          };
        }
        doc = applyAndRecord(history, doc, changeSet);
        snapshots.push(doc);
      }

      // 途中の状態を、1つずつ戻しながら、記録した状態と一致するか確かめる
      let walking = doc;
      for (let i = snapshots.length - 2; i >= 0; i--) {
        walking = undoOk(history, walking);
        expect(expectSameDocument(walking, snapshots[i]), `undo to step ${i}`).toBeNull();
      }
      expect(expectSameDocument(walking, original)).toBeNull();
      expect(history.canUndo).toBe(false);

      for (let i = 1; i < snapshots.length; i++) {
        walking = redoOk(history, walking);
        expect(expectSameDocument(walking, snapshots[i]), `redo to step ${i}`).toBeNull();
      }
      expect(history.canRedo).toBe(false);
    });
  }
});
