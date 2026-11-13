// 「いまの状態の識別番号」(未保存の判定に使う)のテスト(Phase 4)
import { describe, expect, it } from "vitest";
import { applyChangeSet } from "./apply";
import { addEntitiesChangeSet } from "./changeSet";
import { DocumentHistory } from "./history";
import type { CadDocument } from "../model/document";
import { makeDocument, makeLine } from "./testHelpers";

function record(history: DocumentHistory, document: CadDocument, id: string): CadDocument {
  const changeSet = addEntitiesChangeSet(document, [makeLine(id)], id);
  const result = applyChangeSet(document, changeSet);
  if (!result.ok) throw new Error(result.error);
  history.record(changeSet);
  return result.document;
}

function undo(history: DocumentHistory, document: CadDocument): CadDocument {
  const outcome = history.undo(document);
  if (outcome.type !== "done") throw new Error(outcome.type);
  return outcome.document;
}

function redo(history: DocumentHistory, document: CadDocument): CadDocument {
  const outcome = history.redo(document);
  if (outcome.type !== "done") throw new Error(outcome.type);
  return outcome.document;
}

describe("DocumentHistory.currentStateId", () => {
  it("starts at 0 (the state just after opening) and changes with every recorded change", () => {
    const history = new DocumentHistory();
    expect(history.currentStateId).toBe(0);
    let doc = makeDocument(["a"]);
    doc = record(history, doc, "b");
    const afterB = history.currentStateId;
    expect(afterB).not.toBe(0);
    doc = record(history, doc, "c");
    expect(history.currentStateId).not.toBe(afterB);
  });

  it("returns to the same number when Undo goes back to a state (and Redo comes forward again)", () => {
    const history = new DocumentHistory();
    let doc = makeDocument(["a"]);
    doc = record(history, doc, "b");
    const afterB = history.currentStateId;
    doc = record(history, doc, "c");
    const afterC = history.currentStateId;
    doc = undo(history, doc);
    expect(history.currentStateId).toBe(afterB);
    doc = undo(history, doc);
    expect(history.currentStateId).toBe(0);
    doc = redo(history, doc);
    expect(history.currentStateId).toBe(afterB);
    doc = redo(history, doc);
    expect(history.currentStateId).toBe(afterC);
  });

  it("a new change after Undo is a different state from the one that was undone", () => {
    const history = new DocumentHistory();
    let doc = makeDocument(["a"]);
    doc = record(history, doc, "b");
    const oldB = history.currentStateId;
    doc = undo(history, doc);
    doc = record(history, doc, "x"); // 別の変更
    expect(history.currentStateId).not.toBe(oldB);
    expect(history.currentStateId).not.toBe(0);
  });

  it("dropping the oldest steps (limit) does not make the trimmed base look like the opened state", () => {
    const history = new DocumentHistory(2);
    let doc = makeDocument(["a"]);
    for (const id of ["b", "c", "d", "e"]) doc = record(history, doc, id);
    doc = undo(history, doc); // 上限が2なので、戻せるのは2段階(d と e)だけ
    expect(history.canUndo).toBe(true);
    doc = undo(history, doc);
    // 戻せる段階が尽きた。この状態は「開いた直後(0)」ではない(b と c の記録は捨てられている)
    expect(history.canUndo).toBe(false);
    expect(doc.entities.map((e) => e.id)).toEqual(["a", "b", "c"]);
    expect(history.currentStateId).not.toBe(0);
  });

  it("clear() (history discarded) gives a number that no earlier state had", () => {
    const history = new DocumentHistory();
    let doc = makeDocument(["a"]);
    const seen = new Set<number>([history.currentStateId]);
    doc = record(history, doc, "b");
    seen.add(history.currentStateId);
    doc = undo(history, doc);
    history.clear();
    expect(seen.has(history.currentStateId)).toBe(false);
  });
});
