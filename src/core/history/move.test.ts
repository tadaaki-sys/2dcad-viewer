// 描画順の入れ替え(move)のテスト(Phase 4)
import { describe, expect, it } from "vitest";
import { applyChangeSet } from "./apply";
import { invertChangeSet, moveToBackChangeSet, moveToFrontChangeSet } from "./changeSet";
import type { ChangeSet } from "./changeSet";
import { DocumentHistory } from "./history";
import type { CadDocument } from "../model/document";
import { expectSameDocument, idsOf, makeDocument, makeLine, seededRandom } from "./testHelpers";

function mustApply(document: CadDocument, changeSet: ChangeSet): CadDocument {
  const result = applyChangeSet(document, changeSet);
  if (!result.ok) throw new Error(result.error);
  return result.document;
}

describe("move: apply and invert", () => {
  it("moves one entity to the given position and keeps the index consistent", () => {
    const doc = makeDocument(["a", "b", "c", "d"]);
    const next = mustApply(doc, { label: "x", changes: [{ kind: "move", entity: doc.entities[0], from: 0, to: 3 }] });
    expect(idsOf(next)).toEqual(["b", "c", "d", "a"]);
    expect(next.indexById.get("a")).toBe(3);
    expect(next.indexById.get("b")).toBe(0);
    const back = mustApply(next, { label: "x", changes: [{ kind: "move", entity: next.entities[3], from: 3, to: 0 }] });
    expect(expectSameDocument(back, doc)).toBeNull();
  });

  it("shares the entity objects and does not modify the original document", () => {
    const doc = makeDocument(["a", "b", "c"]);
    const next = mustApply(doc, { label: "x", changes: [{ kind: "move", entity: doc.entities[2], from: 2, to: 0 }] });
    expect(idsOf(doc)).toEqual(["a", "b", "c"]);
    expect(next.entities[0]).toBe(doc.entities[2]);
    expect(next.entities[1]).toBe(doc.entities[0]);
  });

  it("rejects bad positions and a stale entity, changing nothing", () => {
    const doc = makeDocument(["a", "b"]);
    const a = doc.entities[0];
    for (const [from, to] of [[0, 2], [2, 0], [-1, 0], [0, -1], [0.5, 1], [0, Number.NaN]]) {
      expect(applyChangeSet(doc, { label: "x", changes: [{ kind: "move", entity: a, from, to }] }).ok, `${from}->${to}`).toBe(false);
    }
    expect(applyChangeSet(doc, { label: "x", changes: [{ kind: "move", entity: a, from: 1, to: 0 }] }).ok).toBe(false);
    expect(applyChangeSet(doc, { label: "x", changes: [{ kind: "move", entity: makeLine("a"), from: 0, to: 1 }] }).ok).toBe(false);
    expect(idsOf(doc)).toEqual(["a", "b"]);
  });

  it("inverting swaps from and to, and applying both restores the same entities", () => {
    const doc = makeDocument(["a", "b", "c", "d", "e"]);
    const changeSet: ChangeSet = {
      label: "x",
      changes: [
        { kind: "move", entity: doc.entities[1], from: 1, to: 4 },
        { kind: "move", entity: doc.entities[3], from: 2, to: 0 },
      ],
    };
    const inverse = invertChangeSet(changeSet);
    expect(inverse.changes.map((c) => c.kind)).toEqual(["move", "move"]);
    const changed = mustApply(doc, changeSet);
    expect(idsOf(changed)).toEqual(["d", "a", "c", "e", "b"]);
    expect(expectSameDocument(mustApply(changed, inverse), doc)).toBeNull();
    expect(invertChangeSet(inverse).changes).toEqual(changeSet.changes);
  });
});

describe("moveToFrontChangeSet / moveToBackChangeSet", () => {
  const ids = ["a", "b", "c", "d", "e", "f"];

  it("moves targets to the front keeping their order, others keep theirs", () => {
    const doc = makeDocument(ids);
    const changeSet = moveToFrontChangeSet(doc, ["b", "d"], "最前面へ");
    expect(changeSet).not.toBeNull();
    expect(idsOf(mustApply(doc, changeSet!))).toEqual(["a", "c", "e", "f", "b", "d"]);
  });

  it("moves targets to the back keeping their order", () => {
    const doc = makeDocument(ids);
    const changeSet = moveToBackChangeSet(doc, ["e", "c"], "最背面へ");
    expect(idsOf(mustApply(doc, changeSet!))).toEqual(["c", "e", "a", "b", "d", "f"]);
  });

  it("does not depend on the order of the given ids, and ignores duplicates", () => {
    const doc = makeDocument(ids);
    const one = mustApply(doc, moveToFrontChangeSet(doc, ["d", "b", "d"], "x")!);
    const two = mustApply(doc, moveToFrontChangeSet(doc, ["b", "d"], "x")!);
    expect(idsOf(one)).toEqual(idsOf(two));
  });

  it("returns null when the targets are already at the front (or back), or there are none", () => {
    const doc = makeDocument(ids);
    expect(moveToFrontChangeSet(doc, ["f"], "x")).toBeNull();
    expect(moveToFrontChangeSet(doc, ["e", "f"], "x")).toBeNull();
    expect(moveToBackChangeSet(doc, ["a"], "x")).toBeNull();
    expect(moveToBackChangeSet(doc, ["a", "b"], "x")).toBeNull();
    expect(moveToFrontChangeSet(doc, [], "x")).toBeNull();
    expect(moveToBackChangeSet(doc, [], "x")).toBeNull();
    // 先頭の1つを最前面へ、末尾の1つを最背面へは、動く
    expect(moveToFrontChangeSet(doc, ["a"], "x")).not.toBeNull();
    expect(moveToBackChangeSet(doc, ["f"], "x")).not.toBeNull();
  });

  it("moves all entities (everything is already in front): null", () => {
    const doc = makeDocument(["a", "b"]);
    expect(moveToFrontChangeSet(doc, ["a", "b"], "x")).toBeNull();
    expect(moveToBackChangeSet(doc, ["a", "b"], "x")).toBeNull();
  });

  it("throws for an unknown id", () => {
    const doc = makeDocument(ids);
    expect(() => moveToFrontChangeSet(doc, ["zzz"], "x")).toThrow(/zzz/);
    expect(() => moveToBackChangeSet(doc, ["a", "zzz"], "x")).toThrow(/zzz/);
  });

  it("undo restores the exact original order", () => {
    const doc = makeDocument(ids);
    const history = new DocumentHistory();
    const changeSet = moveToFrontChangeSet(doc, ["a", "c"], "x")!;
    const moved = mustApply(doc, changeSet);
    history.record(changeSet);
    const undone = history.undo(moved);
    if (undone.type !== "done") throw new Error(undone.type);
    expect(expectSameDocument(undone.document, doc)).toBeNull();
  });

  it("random targets: front puts them last in the original order, back puts them first; the rest keep their order", () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const random = seededRandom(seed);
      const n = 2 + Math.floor(random() * 30);
      const all = Array.from({ length: n }, (_, i) => `e${i}`);
      const doc = makeDocument(all);
      const chosen = all.filter(() => random() < 0.3);
      const rest = all.filter((id) => !chosen.includes(id));

      const front = moveToFrontChangeSet(doc, chosen, "x");
      const expectedFront = [...rest, ...chosen];
      if (front === null) expect(expectedFront).toEqual(all);
      else {
        const moved = mustApply(doc, front);
        expect(idsOf(moved), `front seed ${seed}`).toEqual(expectedFront);
        expect(expectSameDocument(mustApply(moved, invertChangeSet(front)), doc)).toBeNull();
      }

      const back = moveToBackChangeSet(doc, chosen, "x");
      const expectedBack = [...chosen, ...rest];
      if (back === null) expect(expectedBack).toEqual(all);
      else {
        const moved = mustApply(doc, back);
        expect(idsOf(moved), `back seed ${seed}`).toEqual(expectedBack);
        expect(expectSameDocument(mustApply(moved, invertChangeSet(back)), doc)).toBeNull();
      }
    }
  });
});
