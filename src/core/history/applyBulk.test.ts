// 削除だけ・追加だけの変更の高速経路(applyBulk)が、1件ずつの適用(applyChangeSetSequentially)と、
// 結果もエラーの文言も同じであることを、ランダムな変更で確かめる(データ破損防止のため)。
import { describe, expect, it } from "vitest";
import { applyChangeSet, applyChangeSetSequentially } from "./apply";
import type { ApplyResult } from "./apply";
import { invertChangeSet, removeEntitiesChangeSet } from "./changeSet";
import type { ChangeSet, EntityChange } from "./changeSet";
import { expectSameDocument, idsOf, makeDocument, makeLine, seededRandom } from "./testHelpers";

function expectSameResult(fast: ApplyResult, slow: ApplyResult, label: string): void {
  expect(fast.ok, label).toBe(slow.ok);
  if (fast.ok && slow.ok) {
    expect(expectSameDocument(fast.document, slow.document), label).toBeNull();
    expect(fast.document.nextNewId, label).toBe(slow.document.nextNewId);
  } else if (!fast.ok && !slow.ok) {
    expect(fast.error, label).toBe(slow.error);
  }
}

function sequentialIds(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `e${i}`);
}

describe("applyChangeSet: bulk remove / add equals the one-by-one application", () => {
  it("random removals, and their undo (inverse = bulk add), match the sequential result and restore the original", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const random = seededRandom(seed);
      const count = 1 + Math.floor(random() * 40);
      const doc = makeDocument(sequentialIds(count));
      const picked = sequentialIds(count).filter(() => random() < 0.4);
      if (picked.length === 0) continue;
      const change = removeEntitiesChangeSet(doc, picked, "削除");
      const fast = applyChangeSet(doc, change);
      const slow = applyChangeSetSequentially(doc, change);
      expectSameResult(fast, slow, `remove seed ${seed}`);
      if (!fast.ok) throw new Error(fast.error);
      expect(fast.document.entities.length).toBe(count - new Set(picked).size);

      // Undo(逆の変更 = 位置が小さい順の追加)で、元と同じ図形(同じオブジェクト)・同じ順に戻る
      const inverse = invertChangeSet(change);
      const undoFast = applyChangeSet(fast.document, inverse);
      const undoSlow = applyChangeSetSequentially(fast.document, inverse);
      expectSameResult(undoFast, undoSlow, `undo seed ${seed}`);
      if (!undoFast.ok) throw new Error(undoFast.error);
      expect(expectSameDocument(undoFast.document, doc), `restored seed ${seed}`).toBeNull();
    }
  });

  it("random insertions at ascending positions match the sequential result", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const random = seededRandom(1000 + seed);
      const count = Math.floor(random() * 30);
      const doc = makeDocument(sequentialIds(count));
      const adds = 1 + Math.floor(random() * 10);
      const total = count + adds;
      // 最終的な位置を、小さい順に、重ならないよう選ぶ
      const positions = new Set<number>();
      while (positions.size < adds) positions.add(Math.floor(random() * total));
      const changes: EntityChange[] = [...positions].sort((a, b) => a - b).map((index, i) => ({ kind: "add" as const, entity: makeLine(`n${i + 1}`, i), index }));
      const change: ChangeSet = { label: "追加", changes };
      const fast = applyChangeSet(doc, change);
      const slow = applyChangeSetSequentially(doc, change);
      expectSameResult(fast, slow, `add seed ${seed}`);
      expect(fast.ok, `add seed ${seed} is valid`).toBe(true);
      if (fast.ok) {
        expect(fast.document.entities.length).toBe(total);
        expect(fast.document.nextNewId).toBe(adds + 1);
      }
    }
  });

  it("garbled change sets (wrong order, wrong positions, wrong targets, duplicates, missing layer) give the same outcome and error text", () => {
    for (let seed = 1; seed <= 400; seed++) {
      const random = seededRandom(5000 + seed);
      const count = 1 + Math.floor(random() * 12);
      const doc = makeDocument(sequentialIds(count));
      const kind = random() < 0.5 ? "remove" : "add";
      const length = 1 + Math.floor(random() * 5);
      const changes: EntityChange[] = [];
      for (let i = 0; i < length; i++) {
        const index = Math.floor(random() * (count + 3)) - (random() < 0.1 ? 2 : 0);
        if (kind === "remove") {
          // 対象が、その位置の図形のこともあれば、別の図形・存在しない図形のこともある
          const entity = random() < 0.6 ? (doc.entities[index] ?? makeLine("ghost")) : doc.entities[Math.floor(random() * count)];
          changes.push({ kind: "remove", entity, index });
        } else {
          const id = random() < 0.15 ? `e${Math.floor(random() * count)}` : random() < 0.15 ? "n1" : `n${i + 1}`;
          const layer = random() < 0.1 ? "NOPE" : "0";
          changes.push({ kind: "add", entity: makeLine(id, i, layer), index });
        }
      }
      const change: ChangeSet = { label: "でたらめ", changes };
      expectSameResult(applyChangeSet(doc, change), applyChangeSetSequentially(doc, change), `garbled seed ${seed} (${kind})`);
    }
  });

  it("a sorted valid removal order is what makes the fast path safe: the same targets in ascending order still apply correctly (via the sequential path)", () => {
    const doc = makeDocument(sequentialIds(6));
    // 位置が小さい順の削除は、後の位置がずれるので、元の位置どおりには照合できない(逐次の適用が判断する)
    const ascending: ChangeSet = {
      label: "x",
      changes: [
        { kind: "remove", entity: doc.entities[1], index: 1 },
        { kind: "remove", entity: doc.entities[3], index: 3 },
      ],
    };
    expectSameResult(applyChangeSet(doc, ascending), applyChangeSetSequentially(doc, ascending), "ascending removal");
    const result = applyChangeSet(doc, ascending);
    // 1件目の削除で、元の3番の図形は2番にずれるので、位置3の図形(元の4番)と一致せず、拒否される
    expect(result.ok).toBe(false);
  });

  it("is fast for a large scattered removal and its undo (the real-drawing scale that used to take tens of seconds)", () => {
    const count = 120_000;
    const doc = makeDocument(sequentialIds(count));
    const picked = sequentialIds(count).filter((_, i) => i % 2 === 0);
    const change = removeEntitiesChangeSet(doc, picked, "削除");
    const started = performance.now();
    const removed = applyChangeSet(doc, change);
    if (!removed.ok) throw new Error(removed.error);
    const undone = applyChangeSet(removed.document, invertChangeSet(change));
    if (!undone.ok) throw new Error(undone.error);
    const elapsed = performance.now() - started;
    expect(removed.document.entities.length).toBe(count / 2);
    expect(idsOf(undone.document).length).toBe(count);
    expect(expectSameDocument(undone.document, doc)).toBeNull();
    // 以前の方式(1件ごとの splice)では、この規模で数十秒かかった。余裕を見て 5 秒を上限にする(速いPCでは数十ミリ秒)
    expect(elapsed).toBeLessThan(5000);
  });
});

describe("applyChangeSet: bulk path edge cases give the same outcome as the sequential path", () => {
  const cases: Array<[string, (doc: ReturnType<typeof makeDocument>) => EntityChange[]]> = [
    ["add at a NaN position", () => [{ kind: "add", entity: makeLine("n1"), index: Number.NaN }]],
    ["add at a fractional position", () => [{ kind: "add", entity: makeLine("n1"), index: 1.5 }]],
    ["two adds at the same position", () => [{ kind: "add", entity: makeLine("n1"), index: 2 }, { kind: "add", entity: makeLine("n2"), index: 2 }]],
    ["adds in descending order", () => [{ kind: "add", entity: makeLine("n1"), index: 3 }, { kind: "add", entity: makeLine("n2"), index: 1 }]],
    ["add past the end", () => [{ kind: "add", entity: makeLine("n1"), index: 99 }]],
    ["add with a negative position", () => [{ kind: "add", entity: makeLine("n1"), index: -1 }]],
    ["add with a used id", () => [{ kind: "add", entity: makeLine("e1"), index: 0 }]],
    ["remove at a NaN position", (doc) => [{ kind: "remove", entity: doc.entities[1], index: Number.NaN }]],
    ["remove the same entity twice", (doc) => [{ kind: "remove", entity: doc.entities[2], index: 2 }, { kind: "remove", entity: doc.entities[2], index: 2 }]],
    ["remove with a wrong target", (doc) => [{ kind: "remove", entity: doc.entities[0], index: 3 }]],
    ["remove past the end", (doc) => [{ kind: "remove", entity: doc.entities[0], index: 50 }]],
  ];
  for (const [name, make] of cases) {
    it(name, () => {
      const doc = makeDocument(sequentialIds(5));
      const change: ChangeSet = { label: name, changes: make(doc) };
      expectSameResult(applyChangeSet(doc, change), applyChangeSetSequentially(doc, change), name);
    });
  }
});

describe("applyChangeSet: a bulk remove / add followed by replaces (the follow-up of a connected dimension)", () => {
  it("random removals / additions with trailing replaces match the one-by-one result, and the inverse restores the original", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const random = seededRandom(5000 + seed);
      const count = 3 + Math.floor(random() * 40);
      const doc = makeDocument(sequentialIds(count));
      const picked = sequentialIds(count).filter(() => random() < 0.3);
      if (picked.length === 0 || picked.length === count) continue;
      const removal = removeEntitiesChangeSet(doc, picked, "削除");
      const after = applyChangeSet(doc, removal);
      if (!after.ok) throw new Error(after.error);
      // 残った図形のいくつかを、置き換える(位置は、削除の後の配列での位置)
      const replaces: EntityChange[] = [];
      after.document.entities.forEach((entity, index) => {
        if (random() < 0.3) replaces.push({ kind: "replace", before: entity, after: { ...entity, color: "#abcdef" }, index });
      });
      const change: ChangeSet = { label: "削除と置き換え", changes: [...removal.changes, ...replaces] };
      const fast = applyChangeSet(doc, change);
      const slow = applyChangeSetSequentially(doc, change);
      expectSameResult(fast, slow, `remove+replace seed ${seed}`);
      if (!fast.ok) throw new Error(fast.error);
      const undo = applyChangeSet(fast.document, invertChangeSet(change));
      if (!undo.ok) throw new Error(undo.error);
      expect(expectSameDocument(undo.document, doc), `restored seed ${seed}`).toBeNull();
    }
  });

  it("random insertions with trailing replaces match the one-by-one result", () => {
    for (let seed = 1; seed <= 100; seed++) {
      const random = seededRandom(9000 + seed);
      const count = 2 + Math.floor(random() * 20);
      const doc = makeDocument(sequentialIds(count));
      const adds = 1 + Math.floor(random() * 5);
      const total = count + adds;
      const positions = new Set<number>();
      while (positions.size < adds) positions.add(Math.floor(random() * total));
      const addChanges: EntityChange[] = [...positions].sort((a, b) => a - b).map((index, i) => ({ kind: "add" as const, entity: makeLine(`n${i + 1}`, i), index }));
      const afterAdd = applyChangeSet(doc, { label: "追加", changes: addChanges });
      if (!afterAdd.ok) throw new Error(afterAdd.error);
      const replace: EntityChange = { kind: "replace", before: afterAdd.document.entities[0], after: { ...afterAdd.document.entities[0], color: "#123456" }, index: 0 };
      const change: ChangeSet = { label: "追加と置き換え", changes: [...addChanges, replace] };
      expectSameResult(applyChangeSet(doc, change), applyChangeSetSequentially(doc, change), `add+replace seed ${seed}`);
    }
  });

  it("an invalid tail gives the same error as the one-by-one application, and changes nothing", () => {
    const doc = makeDocument(sequentialIds(10));
    const removal = removeEntitiesChangeSet(doc, ["e1", "e3"], "削除");
    const bad: EntityChange = { kind: "replace", before: doc.entities[0], after: { ...doc.entities[0], color: "#000" }, index: 99 };
    const change: ChangeSet = { label: "不正", changes: [...removal.changes, bad] };
    expectSameResult(applyChangeSet(doc, change), applyChangeSetSequentially(doc, change), "invalid tail");
    expect(applyChangeSet(doc, change).ok).toBe(false);
  });

  it("deleting 100,000 scattered figures with a trailing replace stays on the fast path (not the one-by-one path)", () => {
    const ids = sequentialIds(200_000);
    const doc = makeDocument(ids);
    const picked = ids.filter((_, i) => i % 2 === 0);
    const removal = removeEntitiesChangeSet(doc, picked, "削除");
    const first = doc.entities[1];
    const change: ChangeSet = { label: "削除と置き換え", changes: [...removal.changes, { kind: "replace", before: first, after: { ...first, color: "#abcdef" }, index: 0 }] };
    const started = Date.now();
    const result = applyChangeSet(doc, change);
    expect(result.ok).toBe(true);
    // 1件ずつの経路では、数十秒かかる(図形数 × 削除数)。高速経路なら、数百ミリ秒
    expect(Date.now() - started).toBeLessThan(5000);
  });
});