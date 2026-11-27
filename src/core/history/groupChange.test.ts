// グループ表の変更・グループの整合・描画順の入れ替え(Phase 19): 適用・反転・原子性・高速な経路
import { describe, expect, it } from "vitest";
import type { CadGroup, CadLayer } from "../../types/cad";
import { createDocument } from "../model/document";
import type { CadDocument } from "../model/document";
import { applyChangeSet, applyChangeSetSequentially, sameLayerDefinition } from "./apply";
import { drawOrderChangeSet, invertChangeSet, removeEntitiesChangeSet } from "./changeSet";
import type { ChangeSet } from "./changeSet";
import { makeLine, seededRandom } from "./testHelpers";

const layers: CadLayer[] = [{ name: "0", color: "#ffffff", visible: true }];
const doc = (ids: string[], groups: CadGroup[] = []): CadDocument => createDocument({ layers, entities: ids.map((id, i) => makeLine(id, i * 20)), groups });
const ok = (document: CadDocument, changeSet: ChangeSet): CadDocument => {
  const result = applyChangeSet(document, changeSet);
  if (!result.ok) throw new Error(result.error);
  return result.document;
};
const order = (document: CadDocument) => document.entities.map((e) => e.id);

describe("group changes", () => {
  it("adds, replaces and removes a group; the inverse restores it", () => {
    const d = doc(["a", "b", "c"]);
    const add: ChangeSet = { label: "g", changes: [{ kind: "groupAdd", group: { name: "G1", ids: ["a", "b"] }, index: 0 }] };
    const added = ok(d, add);
    expect(added.groups).toEqual([{ name: "G1", ids: ["a", "b"] }]);
    expect(added.entities).toEqual(d.entities);
    const replace: ChangeSet = { label: "r", changes: [{ kind: "groupReplace", before: added.groups[0], after: { name: "G2", ids: ["c"] }, index: 0 }] };
    const replaced = ok(added, replace);
    expect(replaced.groups).toEqual([{ name: "G2", ids: ["c"] }]);
    expect(ok(replaced, invertChangeSet(replace)).groups).toEqual(added.groups);
    expect(ok(added, invertChangeSet(add)).groups).toEqual([]);
  });

  it("refuses a duplicate name, an empty group, a stale before, an id that is not in the drawing, and one figure in two groups", () => {
    const d = doc(["a", "b", "c"], [{ name: "G1", ids: ["a"] }]);
    const bad = (changes: ChangeSet["changes"]) => applyChangeSet(d, { label: "x", changes }).ok;
    expect(bad([{ kind: "groupAdd", group: { name: "G1", ids: ["b"] }, index: 1 }])).toBe(false);
    expect(bad([{ kind: "groupAdd", group: { name: "G2", ids: [] }, index: 1 }])).toBe(false);
    expect(bad([{ kind: "groupAdd", group: { name: "G2", ids: ["zz"] }, index: 1 }])).toBe(false);
    expect(bad([{ kind: "groupAdd", group: { name: "G2", ids: ["a"] }, index: 1 }])).toBe(false);
    expect(bad([{ kind: "groupRemove", group: { name: "G1", ids: ["b"] }, index: 0 }])).toBe(false);
    expect(bad([{ kind: "groupReplace", before: { name: "G1", ids: ["a"] }, after: { name: "G1", ids: [] }, index: 0 }])).toBe(false);
    // 置き換えの before が、いまのグループと違う(古い変更)
    expect(bad([{ kind: "groupReplace", before: { name: "G1", ids: ["b"] }, after: { name: "G1", ids: ["c"] }, index: 0 }])).toBe(false);
    expect(bad([{ kind: "groupReplace", before: { name: "G1", ids: ["a"] }, after: { name: "G1", ids: ["c"] }, index: 0 }])).toBe(true);
    expect(bad([{ kind: "groupAdd", group: { name: "G2", ids: ["b"] }, index: 1 }])).toBe(true);
  });

  it("group names are unique ignoring case (as GROUPEDIT looks them up); changing only the case of a group's own name is allowed", () => {
    const d = doc(["a", "b", "c"], [{ name: "G1", ids: ["a"] }, { name: "H", ids: ["b"] }]);
    const okay = (changes: ChangeSet["changes"]) => applyChangeSet(d, { label: "x", changes }).ok;
    expect(okay([{ kind: "groupAdd", group: { name: "g1", ids: ["c"] }, index: 2 }])).toBe(false);
    expect(okay([{ kind: "groupReplace", before: d.groups[1], after: { name: "g1", ids: ["b"] }, index: 1 }])).toBe(false);
    expect(okay([{ kind: "groupReplace", before: d.groups[0], after: { name: "g1", ids: ["a"] }, index: 0 }])).toBe(true);
  });

  it("deleting a grouped figure without updating the group is refused (the group would point at nothing); with the update it works", () => {
    const d = doc(["a", "b", "c"], [{ name: "G1", ids: ["a", "b"] }]);
    const plain = removeEntitiesChangeSet(d, ["a"], "削除");
    const refused = applyChangeSet(d, plain);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toContain("G1");
    const withGroup: ChangeSet = { label: "削除", changes: [...plain.changes, { kind: "groupReplace", before: d.groups[0], after: { name: "G1", ids: ["b"] }, index: 0 }] };
    const after = ok(d, withGroup);
    expect(order(after)).toEqual(["b", "c"]);
    expect(after.groups[0].ids).toEqual(["b"]);
    const back = ok(after, invertChangeSet(withGroup));
    expect(order(back)).toEqual(["a", "b", "c"]);
    expect(back.groups).toEqual(d.groups);
  });

  it("the lock flag is part of a layer definition (a stale lock is a stale change)", () => {
    expect(sameLayerDefinition(layers[0], { ...layers[0], locked: true })).toBe(false);
    expect(sameLayerDefinition({ ...layers[0], locked: false } as CadLayer, layers[0])).toBe(true);
  });
});

describe("drawOrderChangeSet", () => {
  const d = doc(["a", "b", "c", "d", "e"]);
  const apply = (ids: string[], placement: Parameters<typeof drawOrderChangeSet>[2]) => {
    const changeSet = drawOrderChangeSet(d, ids, placement, "x");
    return changeSet === null ? null : order(ok(d, changeSet));
  };

  it("front / back keep the relative order of the moved figures", () => {
    expect(apply(["d", "b"], { kind: "front" })).toEqual(["a", "c", "e", "b", "d"]);
    expect(apply(["d", "b"], { kind: "back" })).toEqual(["b", "d", "a", "c", "e"]);
  });

  it("above / below a reference figure (on either side of it)", () => {
    expect(apply(["a"], { kind: "above", referenceId: "c" })).toEqual(["b", "c", "a", "d", "e"]);
    expect(apply(["e"], { kind: "below", referenceId: "c" })).toEqual(["a", "b", "e", "c", "d"]);
    expect(apply(["a", "e"], { kind: "above", referenceId: "c" })).toEqual(["b", "c", "a", "e", "d"]);
    expect(apply(["a", "e"], { kind: "below", referenceId: "b" })).toEqual(["a", "e", "b", "c", "d"]);
  });

  it("returns null when nothing would move; refuses an unknown reference or a reference among the moved figures", () => {
    expect(drawOrderChangeSet(d, ["d", "e"], { kind: "front" }, "x")).toBeNull();
    expect(drawOrderChangeSet(d, ["a"], { kind: "back" }, "x")).toBeNull();
    expect(drawOrderChangeSet(d, ["b"], { kind: "below", referenceId: "c" }, "x")).toBeNull();
    expect(drawOrderChangeSet(d, ["d"], { kind: "above", referenceId: "c" }, "x")).toBeNull();
    expect(() => drawOrderChangeSet(d, ["a"], { kind: "above", referenceId: "zz" }, "x")).toThrow();
    expect(() => drawOrderChangeSet(d, ["a", "c"], { kind: "above", referenceId: "c" }, "x")).toThrow();
    expect(() => drawOrderChangeSet(d, ["zz"], { kind: "front" }, "x")).toThrow();
  });

  it("keeps the same objects, and the inverse restores the order exactly", () => {
    const changeSet = drawOrderChangeSet(d, ["b", "d"], { kind: "above", referenceId: "e" }, "x")!;
    const moved = ok(d, changeSet);
    expect(moved.entities.every((e) => d.entities.includes(e))).toBe(true);
    const back = ok(moved, invertChangeSet(changeSet));
    expect(back.entities.every((e, i) => e === d.entities[i])).toBe(true);
  });

  it("random draw orders: the fast path and one-by-one application agree, and Undo restores", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const random = seededRandom(seed);
      const ids = Array.from({ length: 30 }, (_, i) => `e${i}`);
      const base = doc(ids);
      const moving = ids.filter(() => random() < 0.3);
      if (moving.length === 0) continue;
      const rest = ids.filter((id) => !moving.includes(id));
      const kinds = ["front", "back", "above", "below"] as const;
      const kind = kinds[Math.floor(random() * 4)];
      const placement = kind === "front" || kind === "back" ? { kind } : { kind, referenceId: rest[Math.floor(random() * rest.length)] };
      const changeSet = drawOrderChangeSet(base, moving, placement, "x");
      if (changeSet === null) continue;
      const fast = applyChangeSet(base, changeSet);
      const slow = applyChangeSetSequentially(base, changeSet);
      expect(fast.ok && slow.ok).toBe(true);
      if (!fast.ok || !slow.ok) return;
      expect(order(fast.document)).toEqual(order(slow.document));
      const back = applyChangeSet(fast.document, invertChangeSet(changeSet));
      expect(back.ok && order(back.document)).toEqual(ids);
    }
  });

  it("moves 50,000 of 100,000 figures quickly (one pass each for taking out and putting back)", () => {
    const ids = Array.from({ length: 100_000 }, (_, i) => `e${i}`);
    const big = doc(ids);
    const moving = ids.filter((_, i) => i % 2 === 0);
    const started = Date.now();
    const changeSet = drawOrderChangeSet(big, moving, { kind: "front" }, "x")!;
    const moved = applyChangeSet(big, changeSet);
    expect(moved.ok).toBe(true);
    expect(Date.now() - started).toBeLessThan(3000);
    if (moved.ok) expect(moved.document.entities[99_999].id).toBe("e99998");
  });
});

describe("fast paths with group changes appended", () => {
  it("deleting many scattered grouped figures (with the group update appended) is fast and equals one-by-one application", () => {
    const ids = Array.from({ length: 100_000 }, (_, i) => `e${i}`);
    const members = ids.filter((_, i) => i % 3 === 0).slice(0, 10_000);
    const big = doc(ids, [{ name: "G", ids: members }]);
    const removing = members.slice(0, 5_000);
    const plain = removeEntitiesChangeSet(big, removing, "削除");
    const changeSet: ChangeSet = { label: "削除", changes: [...plain.changes, { kind: "groupReplace", before: big.groups[0], after: { name: "G", ids: members.slice(5_000) }, index: 0 }] };
    const started = Date.now();
    const fast = applyChangeSet(big, changeSet);
    const elapsed = Date.now() - started;
    expect(fast.ok).toBe(true);
    expect(elapsed).toBeLessThan(2000);
    const small = doc(ids.slice(0, 300), [{ name: "G", ids: ids.slice(0, 300).filter((_, i) => i % 3 === 0) }]);
    const smallRemove = removeEntitiesChangeSet(small, small.groups[0].ids.slice(0, 50), "削除");
    const smallChange: ChangeSet = { label: "削除", changes: [...smallRemove.changes, { kind: "groupReplace", before: small.groups[0], after: { name: "G", ids: small.groups[0].ids.slice(50) }, index: 0 }] };
    const a = applyChangeSet(small, smallChange);
    const b = applyChangeSetSequentially(small, smallChange);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(order(a.document)).toEqual(order(b.document));
      expect(a.document.groups).toEqual(b.document.groups);
    }
  });
});
