import { describe, expect, it } from "vitest";
import { allocateEntityId, createDocument } from "../model/document";
import { applyChangeSet } from "./apply";
import {
  addEntitiesChangeSet,
  invertChangeSet,
  removeEntitiesChangeSet,
  replaceEntitiesChangeSet,
} from "./changeSet";
import type { ChangeSet } from "./changeSet";
import { expectSameDocument, idsOf, makeDocument, makeLine, TEST_LAYERS } from "./testHelpers";

function mustApply(document: ReturnType<typeof makeDocument>, changeSet: ChangeSet) {
  const result = applyChangeSet(document, changeSet);
  if (!result.ok) throw new Error(result.error);
  return result.document;
}

describe("applyChangeSet: add", () => {
  it("appends to the end (top of the draw order) and keeps the index consistent", () => {
    const doc = makeDocument(["a", "b"]);
    const next = mustApply(doc, addEntitiesChangeSet(doc, [makeLine("c"), makeLine("d")], "追加"));
    expect(idsOf(next)).toEqual(["a", "b", "c", "d"]);
    expect(next.indexById.get("d")).toBe(3);
    expect(expectSameDocument(next, next)).toBeNull();
  });

  it("inserts in the middle at the given draw-order position", () => {
    const doc = makeDocument(["a", "b", "c"]);
    const next = mustApply(doc, { label: "挿入", changes: [{ kind: "add", entity: makeLine("x"), index: 1 }] });
    expect(idsOf(next)).toEqual(["a", "x", "b", "c"]);
    expect(next.indexById.get("c")).toBe(3);
  });

  it("does not modify the original document, and shares untouched entities", () => {
    const doc = makeDocument(["a", "b", "c"]);
    const before = doc.entities.slice();
    const next = mustApply(doc, addEntitiesChangeSet(doc, [makeLine("z")], "追加"));
    expect(doc.entities).toEqual(before);
    expect(doc.entities).toHaveLength(3);
    expect(doc.indexById.has("z")).toBe(false);
    for (let i = 0; i < 3; i++) expect(next.entities[i]).toBe(doc.entities[i]);
    expect(next.layers).toBe(doc.layers);
    expect(next.layerIndexByName).toBe(doc.layerIndexByName);
  });

  it("rejects a duplicate id, a missing layer and a bad position, changing nothing", () => {
    const doc = makeDocument(["a", "b"]);
    const dup = applyChangeSet(doc, { label: "x", changes: [{ kind: "add", entity: makeLine("a"), index: 2 }] });
    expect(dup.ok).toBe(false);
    const noLayer = applyChangeSet(doc, { label: "x", changes: [{ kind: "add", entity: makeLine("c", 0, "NOPE"), index: 2 }] });
    expect(noLayer.ok).toBe(false);
    if (!noLayer.ok) expect(noLayer.error).toContain("NOPE");
    for (const index of [3, -1, 1.5, Number.NaN]) {
      expect(applyChangeSet(doc, { label: "x", changes: [{ kind: "add", entity: makeLine("c"), index }] }).ok, String(index)).toBe(false);
    }
    expect(idsOf(doc)).toEqual(["a", "b"]);
  });

  it("rejects adding the same id twice in one change set", () => {
    const doc = makeDocument(["a"]);
    const result = applyChangeSet(doc, addEntitiesChangeSet(doc, [makeLine("n"), makeLine("n")], "x"));
    expect(result.ok).toBe(false);
  });
});

describe("applyChangeSet: remove", () => {
  it("removes by identity at the position, and the others keep their order", () => {
    const doc = makeDocument(["a", "b", "c", "d"]);
    const next = mustApply(doc, removeEntitiesChangeSet(doc, ["b", "d"], "削除"));
    expect(idsOf(next)).toEqual(["a", "c"]);
    expect(next.indexById.has("b")).toBe(false);
    expect(next.indexById.get("c")).toBe(1);
  });

  it("builds removals from the back, so positions stay valid; duplicated ids are removed once", () => {
    const doc = makeDocument(["a", "b", "c", "d"]);
    const changeSet = removeEntitiesChangeSet(doc, ["b", "c", "b"], "削除");
    expect(changeSet.changes.map((c) => (c.kind === "remove" ? c.index : -1))).toEqual([2, 1]);
    expect(idsOf(mustApply(doc, changeSet))).toEqual(["a", "d"]);
  });

  it("throws when asked to remove an unknown id (no silent ignore)", () => {
    const doc = makeDocument(["a"]);
    expect(() => removeEntitiesChangeSet(doc, ["zzz"], "x")).toThrow(/zzz/);
  });

  it("rejects a stale change: the entity at the position is not the one to remove", () => {
    const doc = makeDocument(["a", "b"]);
    const stale = { label: "x", changes: [{ kind: "remove" as const, entity: doc.entities[0], index: 1 }] };
    expect(applyChangeSet(doc, stale).ok).toBe(false);
    // 同じIDでも、別のオブジェクトなら一致しない(図面が別のものに変わっていた場合を検出する)
    const lookalike = { label: "x", changes: [{ kind: "remove" as const, entity: makeLine("a", 0), index: 0 }] };
    expect(applyChangeSet(doc, lookalike).ok).toBe(false);
    expect(idsOf(doc)).toEqual(["a", "b"]);
  });

  it("rejects an out of range position", () => {
    const doc = makeDocument(["a"]);
    expect(applyChangeSet(doc, { label: "x", changes: [{ kind: "remove", entity: doc.entities[0], index: 1 }] }).ok).toBe(false);
  });
});

describe("applyChangeSet: replace", () => {
  it("replaces in place, keeping id and draw-order position", () => {
    const doc = makeDocument(["a", "b", "c"]);
    const moved = { ...makeLine("b"), start: { x: 100, y: 100 } };
    const next = mustApply(doc, replaceEntitiesChangeSet(doc, [moved], "移動"));
    expect(idsOf(next)).toEqual(["a", "b", "c"]);
    expect(next.entities[1]).toBe(moved);
    expect(next.entities[0]).toBe(doc.entities[0]);
    expect(next.entities[2]).toBe(doc.entities[2]);
    expect(doc.entities[1]).not.toBe(moved);
  });

  it("can move an entity to another existing layer, but not to a missing one", () => {
    const doc = makeDocument(["a"]);
    expect(applyChangeSet(doc, replaceEntitiesChangeSet(doc, [makeLine("a", 0, "MACHINE")], "x")).ok).toBe(true);
    expect(applyChangeSet(doc, replaceEntitiesChangeSet(doc, [makeLine("a", 0, "NOPE")], "x")).ok).toBe(false);
  });

  it("rejects changing the id, a stale before, and a replacement of an unknown or repeated id", () => {
    const doc = makeDocument(["a", "b"]);
    const idChange = { label: "x", changes: [{ kind: "replace" as const, before: doc.entities[0], after: makeLine("other"), index: 0 }] };
    expect(applyChangeSet(doc, idChange).ok).toBe(false);
    const stale = { label: "x", changes: [{ kind: "replace" as const, before: makeLine("a"), after: makeLine("a", 5), index: 0 }] };
    expect(applyChangeSet(doc, stale).ok).toBe(false);
    expect(() => replaceEntitiesChangeSet(doc, [makeLine("zzz")], "x")).toThrow(/zzz/);
    expect(() => replaceEntitiesChangeSet(doc, [makeLine("a", 1), makeLine("a", 2)], "x")).toThrow(/2回/);
  });
});

describe("applyChangeSet: atomic and sequential", () => {
  it("applies nothing when a later change fails", () => {
    const doc = makeDocument(["a", "b"]);
    const result = applyChangeSet(doc, {
      label: "x",
      changes: [
        { kind: "add", entity: makeLine("c"), index: 2 },
        { kind: "remove", entity: makeLine("ghost"), index: 0 }, // 失敗する
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("2番目");
    expect(idsOf(doc)).toEqual(["a", "b"]);
  });

  it("rejects an empty change set", () => {
    const result = applyChangeSet(makeDocument(["a"]), { label: "x", changes: [] });
    expect(result.ok).toBe(false);
  });

  it("handles remove, add again and remove again of the same id in one change set", () => {
    const doc = makeDocument(["a", "b"]);
    const a = doc.entities[0];
    const again = makeLine("a", 7);
    const next = mustApply(doc, {
      label: "x",
      changes: [
        { kind: "remove", entity: a, index: 0 },
        { kind: "add", entity: again, index: 0 },
        { kind: "remove", entity: again, index: 0 },
      ],
    });
    expect(idsOf(next)).toEqual(["b"]);
    // 「いま存在しない」IDを、もう一度削除しようとすると失敗する
    const twice = applyChangeSet(doc, {
      label: "x",
      changes: [
        { kind: "remove", entity: a, index: 0 },
        { kind: "remove", entity: a, index: 0 },
      ],
    });
    expect(twice.ok).toBe(false);
  });
});

describe("applyChangeSet: new entity ids", () => {
  it("raises nextNewId past an added n<k> id so a later allocation does not collide", () => {
    const doc = makeDocument(["a"]);
    const next = mustApply(doc, addEntitiesChangeSet(doc, [makeLine("n5")], "x"));
    expect(next.nextNewId).toBe(6);
    expect(allocateEntityId(next).id).toBe("n6");
  });

  it("keeps nextNewId when the id is lower or not an n<k> id, and never lowers it (so Undo does not reuse ids)", () => {
    const base = makeDocument(["a"]);
    const { id, document } = allocateEntityId(base); // n0, nextNewId=1
    const addChange = addEntitiesChangeSet(document, [makeLine(id)], "追加");
    const added = mustApply(document, addChange);
    expect(added.nextNewId).toBe(1);
    // 追加を元に戻す(削除)しても、払い出し番号は戻らない(同じIDを別の図形に使い回さない)
    const removed = mustApply(added, invertChangeSet(addChange));
    expect(idsOf(removed)).toEqual(["a"]);
    expect(removed.nextNewId).toBe(1);
    expect(allocateEntityId(removed).id).toBe("n1");
    const imported = mustApply(removed, addEntitiesChangeSet(removed, [makeLine("e99")], "x"));
    expect(imported.nextNewId).toBe(1);
  });
});

describe("invertChangeSet", () => {
  it("swaps add/remove and replace sides, and reverses the order", () => {
    const doc = makeDocument(["a", "b"]);
    const after = makeLine("a", 3);
    const changeSet: ChangeSet = {
      label: "混合",
      changes: [
        { kind: "replace", before: doc.entities[0], after, index: 0 },
        { kind: "add", entity: makeLine("c"), index: 2 },
        { kind: "remove", entity: doc.entities[1], index: 1 },
      ],
    };
    const inverse = invertChangeSet(changeSet);
    expect(inverse.label).toBe("混合");
    expect(inverse.changes.map((c) => c.kind)).toEqual(["add", "remove", "replace"]);
    const replaced = inverse.changes[2];
    if (replaced.kind !== "replace") throw new Error("kind");
    expect(replaced.before).toBe(after);
    expect(replaced.after).toBe(doc.entities[0]);
    // 反転を2回すると元の内容に戻る
    expect(invertChangeSet(inverse).changes).toEqual(changeSet.changes);
  });

  it("applying a change set and then its inverse restores the exact same entities", () => {
    const doc = makeDocument(["a", "b", "c", "d", "e"]);
    const changeSet: ChangeSet = {
      label: "x",
      changes: [
        { kind: "remove", entity: doc.entities[3], index: 3 },
        { kind: "add", entity: makeLine("n0"), index: 0 },
        { kind: "replace", before: doc.entities[1], after: makeLine("b", 99), index: 2 },
      ],
    };
    const changed = mustApply(doc, changeSet);
    expect(idsOf(changed)).toEqual(["n0", "a", "b", "c", "e"]);
    const restored = mustApply(changed, invertChangeSet(changeSet));
    expect(expectSameDocument(restored, doc)).toBeNull();
  });
});

describe("createDocument interplay", () => {
  it("works with a document built from imported ids (e<k>) and several layers", () => {
    const doc = createDocument({ layers: TEST_LAYERS, entities: [makeLine("e0"), makeLine("e1", 5, "MACHINE")] });
    const next = mustApply(doc, removeEntitiesChangeSet(doc, ["e0"], "削除"));
    expect(idsOf(next)).toEqual(["e1"]);
    expect(next.layerIndexByName.get("MACHINE")).toBe(1);
  });
});
