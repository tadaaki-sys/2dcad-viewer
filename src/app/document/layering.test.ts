// レイヤーの編集(Phase 17): 作成・色/線種/線の太さの変更(ByLayer の図形の追従)・名前変更・削除・図形の移動・全体の線種尺度
import { describe, expect, it } from "vitest";
import { createDocument } from "../../core/model";
import { createDashFactory, buildLineTypeTable } from "../../core/style/lineTypes";
import type { CadDimension, CadEntity, CadLayer, CadLine, EntityExtras, Point2D } from "../../types/cad";
import { createEditability } from "./editability";
import { DocumentSession } from "./documentSession";
import type { DocumentChange } from "./documentSession";
import { createLayer, deleteLayer, editLayer, moveToLayer, renameLayer, setLineTypeScale } from "./layering";

const pt = (x: number, y: number): Point2D => ({ x, y });
const LAYERS: CadLayer[] = [
  { name: "0", color: "#ffffff", visible: true },
  { name: "A", color: "#ff0000", visible: true },
  { name: "B", color: "#00ff00", visible: true, lineType: "HIDDEN", lineWeight: 50 },
];
const dashes = createDashFactory(buildLineTypeTable([]), 1);

const line = (id: string, layer: string, extra: Partial<CadLine & EntityExtras> = {}): CadEntity => ({
  id,
  type: "LINE",
  layer,
  color: LAYERS.find((l) => l.name === layer)!.color,
  start: pt(0, 0),
  end: pt(100, 0),
  ...extra,
});

function setup(entities: CadEntity[] = []) {
  const base: CadEntity[] = [
    line("n0", "A", { byLayer: 7 }),
    line("n1", "A", { color: "#123456", byLayer: 6 }), // 色は図形自身の指定
    line("n2", "B", { byLayer: 7, lineDash: dashes.make("HIDDEN", 1)!, lineWeight: 50 }),
    line("n3", "0", { byLayer: 7, color: "#ffffff" }),
    ...entities,
  ];
  const session = new DocumentSession(createDocument({ layers: LAYERS, entities: base }));
  return { session, editability: createEditability(null) };
}
const get = (session: DocumentSession, id: string): CadLine => session.document.entities.find((e) => e.id === id) as CadLine;
const layerOf = (session: DocumentSession, name: string): CadLayer => session.document.layers.find((l) => l.name === name)!;

describe("createLayer", () => {
  it("adds a layer with the given settings as ONE undo step; Undo removes it", () => {
    const { session } = setup();
    const result = createLayer(session, { name: "  Walls ", color: "#0000FF", lineType: "dashed", lineWeight: 35 });
    expect(result.ok).toBe(true);
    expect(layerOf(session, "Walls")).toEqual({ name: "Walls", color: "#0000ff", visible: true, lineType: "DASHED", lineWeight: 35 });
    expect(session.document.layers).toHaveLength(4);
    expect(session.undo().type).toBe("done");
    expect(session.document.layers.map((l) => l.name)).toEqual(["0", "A", "B"]);
    expect(session.redo().type).toBe("done");
    expect(layerOf(session, "Walls").lineWeight).toBe(35);
  });

  it("defaults to a white, solid layer without a weight, and treats CONTINUOUS as no linetype", () => {
    const { session } = setup();
    createLayer(session, { name: "X", lineType: "Continuous" });
    expect(layerOf(session, "X")).toEqual({ name: "X", color: "#ffffff", visible: true });
  });

  it("refuses bad input and changes nothing (no undo step)", () => {
    const { session } = setup();
    const before = session.document;
    for (const input of [{ name: "" }, { name: "a" }, { name: "A" }, { name: "x", color: "red" }, { name: "x", lineType: "NOPE" }, { name: "x", lineWeight: 26 }, { name: "a:b" }]) {
      const result = createLayer(session, input);
      // 名前 "a" は、"A" と大文字小文字だけが違うので断られる
      expect(result.ok, JSON.stringify(input)).toBe(false);
    }
    expect(session.document).toBe(before);
    expect(session.canUndo).toBe(false);
  });
});

describe("editLayer", () => {
  it("a color change makes the ByLayer-color figures follow in the SAME undo step; own-color figures do not; other layers do not", () => {
    const { session } = setup();
    const n1 = get(session, "n1");
    const n2 = get(session, "n2");
    const result = editLayer(session, "A", { color: "#0000ff" });
    expect(result).toMatchObject({ ok: true });
    expect(result.message).toContain("1 個が追従");
    expect(layerOf(session, "A").color).toBe("#0000ff");
    expect(get(session, "n0").color).toBe("#0000ff");
    expect(get(session, "n1")).toBe(n1);
    expect(get(session, "n2")).toBe(n2);
    expect(session.isDirty).toBe(true);
    // 1回の Undo で、レイヤーも図形も戻る
    session.undo();
    expect(layerOf(session, "A").color).toBe("#ff0000");
    expect(get(session, "n0").color).toBe("#ff0000");
    expect(session.canUndo).toBe(false);
    expect(session.isDirty).toBe(false);
  });

  it("a linetype change gives ByLayer-linetype figures a dash from the new linetype (and back to solid for CONTINUOUS)", () => {
    const ownDash = dashes.make("PHANTOM", 1)!;
    const { session } = setup([line("n6", "A", { byLayer: 1 | 4, lineDash: ownDash })]);
    editLayer(session, "A", { lineType: "CENTER" });
    expect(get(session, "n0").lineDash?.name).toBe("CENTER");
    expect(get(session, "n1").lineDash?.name).toBe("CENTER"); // byLayer=6: 色は自身の指定だが、線種は ByLayer
    expect(get(session, "n6").lineDash).toBe(ownDash); // 線種が図形自身の指定(ByObject)のものは、そのまま
    editLayer(session, "A", { lineType: null });
    expect(get(session, "n0").lineDash).toBeUndefined();
    expect(get(session, "n6").lineDash).toBe(ownDash);
    expect(layerOf(session, "A").lineType).toBeUndefined();
    session.undo();
    session.undo();
    expect(session.canUndo).toBe(false);
  });

  it("a weight change follows (thin weights are not stored on the figure) and the figure's color is untouched by it", () => {
    const { session } = setup();
    editLayer(session, "A", { lineWeight: 100 });
    expect(get(session, "n0").lineWeight).toBe(100);
    expect(get(session, "n0").color).toBe("#ff0000");
    editLayer(session, "A", { lineWeight: 25 });
    expect(get(session, "n0").lineWeight).toBeUndefined();
    expect(layerOf(session, "A").lineWeight).toBe(25);
    editLayer(session, "A", { lineWeight: null });
    expect(layerOf(session, "A").lineWeight).toBeUndefined();
  });

  it("changing the color does not touch the linetype of figures (only the changed attribute is re-evaluated)", () => {
    const { session } = setup();
    const n2 = get(session, "n2");
    editLayer(session, "B", { color: "#abcdef" });
    expect(get(session, "n2").color).toBe("#abcdef");
    expect(get(session, "n2").lineDash).toBe(n2.lineDash);
    expect(get(session, "n2").lineWeight).toBe(50);
  });

  it("changing several attributes at once is one step", () => {
    const { session } = setup();
    editLayer(session, "A", { color: "#111111", lineType: "DASHDOT", lineWeight: 70 });
    const n0 = get(session, "n0");
    expect([n0.color, n0.lineDash?.name, n0.lineWeight]).toEqual(["#111111", "DASHDOT", 70]);
    session.undo();
    expect(session.canUndo).toBe(false);
    expect(get(session, "n0").lineWeight).toBeUndefined();
  });

  it("says why nothing follows when no figure on the layer follows it (own attributes, e.g. converted from DWG); no note for an empty layer", () => {
    const own = [line("n7", "B", { color: "#abcdef" }), line("n8", "B", { color: "#abcdef" })];
    const session = new DocumentSession(createDocument({ layers: LAYERS, entities: own }));
    const outcome = editLayer(session, "B", { color: "#111111" });
    expect(outcome.ok).toBe(true);
    expect(outcome.message).toContain("追従する図形はありません");
    expect(outcome.message).toContain("2 個");
    expect(outcome.message).toContain("DWG");
    expect(session.document.entities.map((e) => e.color)).toEqual(["#abcdef", "#abcdef"]);
    const empty = editLayer(session, "A", { color: "#222222" });
    expect(empty.ok).toBe(true);
    expect(empty.message).not.toContain("追従");
  });

  it("when ByLayer figures exist but their look does not change (thin → thin weight), it does not claim they are own-specified", () => {
    const { session } = setup([line("n9", "A", { byLayer: 7 })]);
    editLayer(session, "A", { lineWeight: 13 });
    const outcome = editLayer(session, "A", { lineWeight: 18 });
    expect(outcome.ok).toBe(true);
    expect(outcome.message).toContain("見た目が変わりません");
    expect(outcome.message).not.toContain("自身で指定");
  });

  it("setting the linetype or the weight the layer already has changes nothing (says so, no undo step)", () => {
    const { session } = setup();
    expect(editLayer(session, "B", { lineType: "hidden" }).message).toContain("変更がありません");
    expect(editLayer(session, "B", { lineWeight: 50 }).message).toContain("変更がありません");
    expect(editLayer(session, "A", { lineType: "Continuous" }).message).toContain("変更がありません");
    expect(editLayer(session, "A", { lineType: null, lineWeight: null }).message).toContain("変更がありません");
    expect(session.canUndo).toBe(false);
  });

  it("a color change leaves a ByLayer figure's linetype and weight alone even when they differ from the layer's (only the changed attribute is re-evaluated)", () => {
    // 線種・線の太さも ByLayer だが、いまの値は、レイヤー B の設定(HIDDEN・0.50)と違う(取り込んだ図面に、線種の定義が無かった場合など)
    const odd = line("n9", "B", { byLayer: 7 });
    const { session } = setup([odd]);
    editLayer(session, "B", { color: "#abcdef" });
    const after = get(session, "n9");
    expect(after.color).toBe("#abcdef");
    expect(after.lineDash).toBeUndefined();
    expect(after.lineWeight).toBeUndefined();
  });

  it("refuses an unknown layer, bad values, and a change that changes nothing", () => {
    const { session } = setup();
    expect(editLayer(session, "NOPE", { color: "#000000" }).ok).toBe(false);
    expect(editLayer(session, "A", { color: "blue" }).ok).toBe(false);
    expect(editLayer(session, "A", { lineType: "NOPE" }).ok).toBe(false);
    expect(editLayer(session, "A", { lineWeight: 26 }).ok).toBe(false);
    expect(editLayer(session, "A", { color: "#FF0000" }).message).toContain("変更がありません");
    expect(editLayer(session, "A", {}).ok).toBe(false);
    expect(session.canUndo).toBe(false);
  });

  it("keeps the layer's visibility (a view setting) when its settings change and when the change is undone", () => {
    const { session } = setup();
    session.setLayerVisible("A", false);
    editLayer(session, "A", { color: "#222222" });
    expect(layerOf(session, "A").visible).toBe(false);
    session.undo();
    expect(layerOf(session, "A").visible).toBe(false);
  });

  it("a connected dimension on the layer follows its color without breaking its references", () => {
    const dimension: CadDimension & EntityExtras = {
      id: "n4",
      type: "DIMENSION",
      layer: "A",
      color: "#ff0000",
      byLayer: 1,
      kind: "linear",
      rotation: 0,
      p1: pt(0, 0),
      p2: pt(100, 0),
      position: pt(50, 40),
      values: { textHeight: 10, arrowSize: 10, decimals: 0, angleDecimals: 1, unit: "mm", showUnit: false, extensionOffset: 5 },
      refs: [{ slot: "p1", id: "n0", anchor: { kind: "start" } }],
    };
    const { session } = setup([dimension]);
    const outcome = editLayer(session, "A", { color: "#00aa00" });
    expect(outcome.ok).toBe(true);
    const next = session.document.entities.find((e) => e.id === "n4") as CadDimension;
    expect(next.color).toBe("#00aa00");
    expect(next.refs).toEqual(dimension.refs);
    expect(session.takeNotice()).toBeNull();
  });
});

describe("renameLayer", () => {
  it("renames the layer and moves its figures onto the new name in one step; Undo restores everything", () => {
    const { session } = setup();
    const originals = session.document.entities;
    const result = renameLayer(session, "A", "Walls");
    expect(result).toMatchObject({ ok: true });
    expect(result.message).toContain("2 個");
    expect(session.document.layers.map((l) => l.name)).toEqual(["0", "Walls", "B"]);
    expect(session.document.entities.filter((e) => e.layer === "Walls").map((e) => e.id)).toEqual(["n0", "n1"]);
    expect(session.document.layerIndexByName.has("A")).toBe(false);
    session.undo();
    expect(session.document.layers.map((l) => l.name)).toEqual(["0", "A", "B"]);
    expect(session.document.entities).toEqual(originals);
    expect(session.canUndo).toBe(false);
  });

  it("allows a case-only rename, and refuses layer 0, a used name, a bad name, the same name and an unknown layer", () => {
    const { session } = setup();
    expect(renameLayer(session, "A", "a").ok).toBe(true);
    expect(renameLayer(session, "0", "Zero").message).toContain("レイヤー 0");
    expect(renameLayer(session, "a", "B").ok).toBe(false);
    expect(renameLayer(session, "a", "x/y").ok).toBe(false);
    expect(renameLayer(session, "a", "a").message).toContain("同じ");
    expect(renameLayer(session, "NOPE", "x").ok).toBe(false);
  });
});

describe("deleteLayer", () => {
  it("deletes an empty layer; Undo restores it at the same position", () => {
    const { session } = setup();
    createLayer(session, { name: "Empty", color: "#123123" });
    expect(deleteLayer(session, "Empty", "0").ok).toBe(true);
    expect(session.document.layers.map((l) => l.name)).toEqual(["0", "A", "B"]);
    session.undo();
    expect(session.document.layers.map((l) => l.name)).toEqual(["0", "A", "B", "Empty"]);
  });

  it("refuses layer 0, the current layer, a layer with figures (says how many), the last layer, and an unknown layer", () => {
    const { session } = setup();
    // レイヤー 0 に図形が無くても、削除できない(図形があることが理由ではない)
    const bare = new DocumentSession(createDocument({ layers: LAYERS, entities: [] }));
    expect(deleteLayer(bare, "0", "A").message).toContain("レイヤー 0");
    expect(bare.document.layers).toHaveLength(3);
    createLayer(session, { name: "Cur" });
    expect(deleteLayer(session, "Cur", "Cur").message).toContain("現在のレイヤー");
    expect(deleteLayer(session, "A", "0").message).toContain("2 個");
    expect(deleteLayer(session, "NOPE", "0").ok).toBe(false);
    const single = new DocumentSession(createDocument({ layers: [{ name: "Only", color: "#ffffff", visible: true }], entities: [] }));
    expect(deleteLayer(single, "Only", "0").message).toContain("最後");
  });
});

describe("moveToLayer", () => {
  it("moves figures to the layer; ByLayer attributes follow the new layer, own attributes stay; one step", () => {
    const { session, editability } = setup();
    const result = moveToLayer(session, editability, ["n0", "n1"], "B");
    expect(result).toMatchObject({ ok: true });
    const n0 = get(session, "n0");
    expect([n0.layer, n0.color, n0.lineDash?.name, n0.lineWeight]).toEqual(["B", "#00ff00", "HIDDEN", 50]);
    const n1 = get(session, "n1");
    expect([n1.layer, n1.color]).toEqual(["B", "#123456"]); // 色は図形自身の指定のまま
    expect(n1.lineDash?.name).toBe("HIDDEN"); // byLayer=6(線種と太さ)は、移した先に従う
    expect(n1.lineWeight).toBe(50);
    session.undo();
    expect(get(session, "n0").layer).toBe("A");
    expect(get(session, "n0").lineDash).toBeUndefined();
    expect(session.canUndo).toBe(false);
  });

  it("skips figures already on the layer (and says so), and reports when there is nothing to move", () => {
    const { session, editability } = setup();
    expect(moveToLayer(session, editability, ["n0", "n2"], "B").message).toContain("1 個は、すでにそのレイヤー");
    expect(moveToLayer(session, editability, ["n2"], "B").message).toContain("すでに");
    expect(moveToLayer(session, editability, [], "B").message).toContain("移せる図形がありません");
  });

  it("refuses an unknown layer, and leaves read-only figures out (imported figures of an unmapped drawing)", () => {
    const { session, editability } = setup([line("e9", "A", { byLayer: 7 })]);
    expect(moveToLayer(session, editability, ["n0"], "NOPE").ok).toBe(false);
    const result = moveToLayer(session, editability, ["e9"], "B"); // n で始まらない ID は、取り込んだ図形(対応なし=編集不可)
    expect(result.ok).toBe(false);
    expect(get(session, "e9").layer).toBe("A");
    const mixed = moveToLayer(session, editability, ["n0", "e9"], "B");
    expect(mixed.ok).toBe(true);
    expect(mixed.message).toContain("除きました");
  });

  it("warns when the target layer is hidden", () => {
    const { session, editability } = setup();
    session.setLayerVisible("B", false);
    expect(moveToLayer(session, editability, ["n0"], "B").message).toContain("非表示");
  });
});

describe("setLineTypeScale", () => {
  it("rescales dashed figures (keeping their own scale), is one step, and Undo restores the scale and the dashes", () => {
    const own = createDashFactory(buildLineTypeTable([]), 1).make("DASHED", 3)!;
    const { session } = setup([line("n5", "0", { lineDash: own })]);
    const n2 = get(session, "n2");
    const result = setLineTypeScale(session, 2);
    expect(result).toMatchObject({ ok: true });
    expect(session.document.ltScale).toBe(2);
    expect(get(session, "n5").lineDash?.key).toBe("DASHED@6");
    expect(get(session, "n2").lineDash?.key).toBe("HIDDEN@2");
    expect(get(session, "n2").lineDash?.pattern).toEqual(n2.lineDash!.pattern.map((v) => v * 2));
    expect(get(session, "n0").lineDash).toBeUndefined();
    session.undo();
    expect(session.document.ltScale).toBe(1);
    expect(get(session, "n2")).toBe(n2);
    expect(session.canUndo).toBe(false);
  });

  it("new dashes made after the change use the new scale (layer edits use the document's scale)", () => {
    const { session } = setup();
    setLineTypeScale(session, 4);
    editLayer(session, "A", { lineType: "DASHED" });
    expect(get(session, "n0").lineDash?.key).toBe("DASHED@4");
  });

  it("refuses the same value, zero, negative, NaN, infinite, and out of range values", () => {
    const { session } = setup();
    for (const bad of [1, 0, -2, Number.NaN, Infinity, 1e-7, 1e7]) expect(setLineTypeScale(session, bad).ok, String(bad)).toBe(false);
    expect(session.canUndo).toBe(false);
  });
});

describe("layer visibility is a view setting", () => {
  it("is not in the history and does not make the drawing dirty, but listeners are told (kind: view) and the document layers change", () => {
    const { session } = setup();
    const seen: DocumentChange[] = [];
    session.subscribe((change) => seen.push(change));
    expect(session.setLayerVisible("A", false)).toBe(true);
    expect(layerOf(session, "A").visible).toBe(false);
    expect(session.canUndo).toBe(false);
    expect(session.isDirty).toBe(false);
    expect(seen.map((c) => c.kind)).toEqual(["view"]);
    // 同じ状態への切り替えは、知らせない。無いレイヤーは false
    session.setLayerVisible("A", false);
    expect(seen).toHaveLength(1);
    expect(session.setLayerVisible("NOPE", true)).toBe(false);
  });

  it("does not replace the entities array (so figure-dependent caches stay valid)", () => {
    const { session } = setup();
    const entities = session.document.entities;
    session.setLayerVisible("A", false);
    expect(session.document.entities).toBe(entities);
  });
});
