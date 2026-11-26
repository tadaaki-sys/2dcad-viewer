// レイヤー表・全体の線種尺度の変更(Phase 17): 適用・反転・原子性・Undo の順序
import { describe, expect, it } from "vitest";
import type { CadLayer } from "../../types/cad";
import { createDocument } from "../model/document";
import type { CadDocument } from "../model/document";
import { applyChangeSet, applyChangeSetSequentially } from "./apply";
import { invertChangeSet } from "./changeSet";
import type { Change, ChangeSet } from "./changeSet";
import { makeLine, seededRandom } from "./testHelpers";

const layers: CadLayer[] = [
  { name: "0", color: "#ffffff", visible: true },
  { name: "A", color: "#ff0000", visible: true },
];
const docWith = (...lines: Array<[string, string]>): CadDocument =>
  createDocument({ layers, entities: lines.map(([id, layer], i) => makeLine(id, i * 20, layer)) });

const ok = (document: CadDocument, changeSet: ChangeSet): CadDocument => {
  const result = applyChangeSet(document, changeSet);
  if (!result.ok) throw new Error(result.error);
  return result.document;
};
const defOf = (l: CadLayer) => ({ ...l, visible: undefined });

describe("layerAdd / layerRemove", () => {
  it("adds a layer at a position, updates the name index, and leaves the figures alone", () => {
    const doc = docWith(["e1", "0"]);
    const next = ok(doc, { label: "add", changes: [{ kind: "layerAdd", layer: { name: "B", color: "#00ff00", visible: true }, index: 1 }] });
    expect(next.layers.map((l) => l.name)).toEqual(["0", "B", "A"]);
    expect(next.layerIndexByName.get("A")).toBe(2);
    expect(next.layerIndexByName.get("B")).toBe(1);
    expect(next.entities).toHaveLength(1);
    expect(next.entities[0]).toBe(doc.entities[0]); // 図形そのものは、そのまま
  });

  it("removes an unused layer; Undo (the inverted change) brings it back at the same position", () => {
    const doc = docWith(["e1", "0"]);
    const change: ChangeSet = { label: "rm", changes: [{ kind: "layerRemove", layer: layers[1], index: 1 }] };
    const removed = ok(doc, change);
    expect(removed.layers.map((l) => l.name)).toEqual(["0"]);
    const back = ok(removed, invertChangeSet(change));
    expect(back.layers.map(defOf)).toEqual(doc.layers.map(defOf));
    expect(back.layerIndexByName.get("A")).toBe(1);
  });

  it("refuses to add a layer whose name already exists, and a bad position (nothing changes)", () => {
    const doc = docWith(["e1", "0"]);
    expect(applyChangeSet(doc, { label: "x", changes: [{ kind: "layerAdd", layer: { name: "A", color: "#000000", visible: true }, index: 0 }] }).ok).toBe(false);
    expect(applyChangeSet(doc, { label: "x", changes: [{ kind: "layerAdd", layer: { name: "Z", color: "#000000", visible: true }, index: 5 }] }).ok).toBe(false);
    expect(applyChangeSet(doc, { label: "x", changes: [{ kind: "layerAdd", layer: { name: "Z", color: "#000000", visible: true }, index: -1 }] }).ok).toBe(false);
  });

  it("refuses to remove a layer that figures still use, or one that does not match the table (atomic: nothing else is applied either)", () => {
    const doc = docWith(["e1", "A"], ["e2", "0"]);
    const used = applyChangeSet(doc, { label: "x", changes: [{ kind: "replace", before: doc.entities[1], after: { ...doc.entities[1], color: "#123456" }, index: 1 }, { kind: "layerRemove", layer: layers[1], index: 1 }] });
    expect(used.ok).toBe(false);
    if (!used.ok) expect(used.error).toContain("存在しないレイヤー");
    const wrong = applyChangeSet(docWith(["e1", "0"]), { label: "x", changes: [{ kind: "layerRemove", layer: { ...layers[1], color: "#999999" }, index: 1 }] });
    expect(wrong.ok).toBe(false);
  });
});

describe("layerReplace", () => {
  it("changes a layer's color / linetype / weight in place; the visibility already in the document is kept (it is a view setting)", () => {
    const doc = docWith(["e1", "A"]);
    const hidden: CadDocument = { ...doc, layers: [doc.layers[0], { ...doc.layers[1], visible: false }] };
    const next = ok(hidden, { label: "c", changes: [{ kind: "layerReplace", before: layers[1], after: { ...layers[1], color: "#0000ff", lineType: "HIDDEN", lineWeight: 50 }, index: 1 }] });
    expect(next.layers[1]).toEqual({ name: "A", color: "#0000ff", visible: false, lineType: "HIDDEN", lineWeight: 50 });
  });

  it("a rename plus the figures' layer replaced in the same change works, and Undo (inverse order) works too", () => {
    const doc = docWith(["e1", "A"], ["e2", "0"], ["e3", "A"]);
    const change: ChangeSet = {
      label: "rename",
      changes: [
        { kind: "layerReplace", before: layers[1], after: { ...layers[1], name: "B" }, index: 1 },
        { kind: "replace", before: doc.entities[0], after: { ...doc.entities[0], layer: "B" }, index: 0 },
        { kind: "replace", before: doc.entities[2], after: { ...doc.entities[2], layer: "B" }, index: 2 },
      ],
    };
    const renamed = ok(doc, change);
    expect(renamed.layers.map((l) => l.name)).toEqual(["0", "B"]);
    expect(renamed.entities.map((e) => e.layer)).toEqual(["B", "0", "B"]);
    expect(renamed.layerIndexByName.has("A")).toBe(false);
    // Undo: 図形の置き換え(B → A)が、レイヤー表の変更より先に来るが、最後にまとめて確かめるので、成功する
    const back = ok(renamed, invertChangeSet(change));
    expect(back.entities).toEqual(doc.entities);
    expect(back.layers.map(defOf)).toEqual(doc.layers.map(defOf));
  });

  it("refuses a rename onto an existing name even when no figure is left behind (the duplicate check itself)", () => {
    const doc = docWith(["e1", "0"]); // レイヤー A に図形が無い: 名前の重複だけが理由になる
    const result = applyChangeSet(doc, { label: "x", changes: [{ kind: "layerReplace", before: layers[1], after: { ...layers[1], name: "0" }, index: 1 }] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("すでに使われています");
  });

  it("matches a layer by color, linetype AND weight (a table that differs in only one of them is a stale change)", () => {
    const styled: CadLayer = { name: "S", color: "#101010", visible: true, lineType: "HIDDEN", lineWeight: 50 };
    const doc = createDocument({ layers: [layers[0], styled], entities: [makeLine("e1", 0, "0")] });
    for (const stale of [{ ...styled, lineType: "DASHED" }, { ...styled, lineType: undefined }, { ...styled, lineWeight: 70 }, { ...styled, lineWeight: undefined }]) {
      expect(applyChangeSet(doc, { label: "x", changes: [{ kind: "layerRemove", layer: stale, index: 1 }] }).ok).toBe(false);
      expect(applyChangeSet(doc, { label: "x", changes: [{ kind: "layerReplace", before: stale, after: { ...styled, color: "#202020" }, index: 1 }] }).ok).toBe(false);
    }
    expect(applyChangeSet(doc, { label: "x", changes: [{ kind: "layerRemove", layer: styled, index: 1 }] }).ok).toBe(true);
  });

  it("refuses a rename onto an existing name, a stale `before`, and a figure left on the old name", () => {
    const doc = docWith(["e1", "A"]);
    expect(applyChangeSet(doc, { label: "x", changes: [{ kind: "layerReplace", before: layers[1], after: { ...layers[1], name: "0" }, index: 1 }] }).ok).toBe(false);
    expect(applyChangeSet(doc, { label: "x", changes: [{ kind: "layerReplace", before: { ...layers[1], color: "#111111" }, after: layers[1], index: 1 }] }).ok).toBe(false);
    // 図形を付け替えずに名前だけ変えると、図形が、存在しないレイヤーを指す
    const orphan = applyChangeSet(doc, { label: "x", changes: [{ kind: "layerReplace", before: layers[1], after: { ...layers[1], name: "B" }, index: 1 }] });
    expect(orphan.ok).toBe(false);
  });

  it("figures added or replaced onto a layer added in the same change are accepted; onto a missing layer they are not", () => {
    const doc = docWith(["e1", "0"]);
    const withLayer = ok(doc, {
      label: "x",
      changes: [
        { kind: "layerAdd", layer: { name: "B", color: "#00ff00", visible: true }, index: 2 },
        { kind: "add", entity: makeLine("n0", 100, "B"), index: 1 },
      ],
    });
    expect(withLayer.entities[1].layer).toBe("B");
    const missing = applyChangeSet(doc, {
      label: "x",
      changes: [
        { kind: "layerAdd", layer: { name: "B", color: "#00ff00", visible: true }, index: 2 },
        { kind: "add", entity: makeLine("n0", 100, "NOPE"), index: 1 },
      ],
    });
    expect(missing.ok).toBe(false);
  });

  it("without any layer-name change, the old per-figure error (with the step number) is still the one given", () => {
    const doc = docWith(["e1", "0"]);
    const result = applyChangeSet(doc, { label: "x", changes: [{ kind: "add", entity: makeLine("n0", 100, "NOPE"), index: 1 }] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("1番目の変更(add): レイヤーが存在しません: NOPE");
  });
});

describe("ltScale", () => {
  it("changes the global linetype scale, and the inverse restores it", () => {
    const doc = docWith(["e1", "0"]);
    const change: ChangeSet = { label: "s", changes: [{ kind: "ltScale", before: 1, after: 2.5 }] };
    const next = ok(doc, change);
    expect(next.ltScale).toBe(2.5);
    expect(ok(next, invertChangeSet(change)).ltScale).toBe(1);
  });

  it("refuses a stale before, and a bad after (zero, negative, NaN, infinite)", () => {
    const doc = docWith(["e1", "0"]);
    expect(applyChangeSet(doc, { label: "s", changes: [{ kind: "ltScale", before: 3, after: 2 }] }).ok).toBe(false);
    for (const bad of [0, -1, Number.NaN, Infinity]) expect(applyChangeSet(doc, { label: "s", changes: [{ kind: "ltScale", before: 1, after: bad }] }).ok).toBe(false);
  });
});

describe("random sequences of layer + figure changes: Undo of every step restores exactly", () => {
  for (let seed = 1; seed <= 40; seed++) {
    it(`seed ${seed}`, () => {
      const random = seededRandom(seed);
      let doc = docWith(["e1", "0"], ["e2", "A"], ["e3", "A"], ["e4", "0"]);
      const history: Array<{ before: CadDocument; changeSet: ChangeSet }> = [];
      let counter = 0;
      for (let step = 0; step < 25; step++) {
        const names = doc.layers.map((l) => l.name);
        const pick = random();
        let changes: Change[] = [];
        if (pick < 0.25) {
          const name = `L${counter++}`;
          changes = [{ kind: "layerAdd", layer: { name, color: "#00ff00", visible: true }, index: Math.floor(random() * (doc.layers.length + 1)) }];
        } else if (pick < 0.5) {
          const index = Math.floor(random() * doc.layers.length);
          const layer = doc.layers[index];
          const name = `R${counter++}`;
          changes = [{ kind: "layerReplace", before: layer, after: { ...layer, name }, index }];
          doc.entities.forEach((entity, i) => {
            if (entity.layer === layer.name) changes.push({ kind: "replace", before: entity, after: { ...entity, layer: name }, index: i });
          });
        } else if (pick < 0.7) {
          const index = Math.floor(random() * doc.layers.length);
          const layer = doc.layers[index];
          changes = [{ kind: "layerReplace", before: layer, after: { ...layer, color: random() < 0.5 ? "#101010" : "#202020" }, index }];
        } else if (pick < 0.85) {
          const unused = doc.layers.map((l, index) => ({ l, index })).filter(({ l }) => !doc.entities.some((e) => e.layer === l.name));
          if (unused.length === 0) continue;
          const { l, index } = unused[Math.floor(random() * unused.length)];
          changes = [{ kind: "layerRemove", layer: l, index }];
        } else {
          const entityIndex = Math.floor(random() * doc.entities.length);
          const entity = doc.entities[entityIndex];
          changes = [{ kind: "replace", before: entity, after: { ...entity, layer: names[Math.floor(random() * names.length)] }, index: entityIndex }];
        }
        const changeSet: ChangeSet = { label: `step${step}`, changes };
        const result = applyChangeSet(doc, changeSet);
        expect(result.ok, `${step}: ${!result.ok ? result.error : ""}`).toBe(true);
        if (!result.ok) return;
        // 高速経路と、1件ずつの適用の結果が同じ
        const sequential = applyChangeSetSequentially(doc, changeSet);
        expect(sequential.ok).toBe(true);
        if (sequential.ok) {
          expect(sequential.document.layers.map(defOf)).toEqual(result.document.layers.map(defOf));
          expect(sequential.document.entities).toEqual(result.document.entities);
        }
        history.push({ before: doc, changeSet });
        doc = result.document;
      }
      for (let i = history.length - 1; i >= 0; i--) {
        const undone = applyChangeSet(doc, invertChangeSet(history[i].changeSet));
        expect(undone.ok).toBe(true);
        if (!undone.ok) return;
        doc = undone.document;
        expect(doc.layers.map(defOf)).toEqual(history[i].before.layers.map(defOf));
        expect(doc.entities).toEqual(history[i].before.entities);
        expect([...doc.layerIndexByName.entries()]).toEqual(doc.layers.map((l, n) => [l.name, n]));
      }
    });
  }
});
