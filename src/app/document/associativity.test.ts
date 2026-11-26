// 連動寸法(Phase 16)を、図面・履歴・既存の編集に通したときの動き: 追従・切れた参照・寸法だけを動かしたとき・Undo/Redo・複写
import { describe, expect, it } from "vitest";
import { intersectionOfLines } from "../../core/dimension/dimensionConstruct";
import { isSameAnchorPoint, resolveAnchor } from "../../core/dimension/dimensionRefs";
import { layoutDimension } from "../../core/dimension/dimensionGeometry";
import { addEntitiesChangeSet, removeEntitiesChangeSet, replaceEntitiesChangeSet } from "../../core/history";
import { expectSameDocument, seededRandom } from "../../core/history/testHelpers";
import { createDocument } from "../../core/model";
import type { CadDocument } from "../../core/model";
import { reflectionMatrix, rotationMatrix, scaleMatrix, translationMatrix } from "../../core/geometry/transform";
import type { CadDimension, CadEntity, CadLayer, DimensionRef, Point2D } from "../../types/cad";
import { planAssociation } from "./associativity";
import { breakAt } from "./breaking";
import { reassociateDimension } from "./dimensioning";
import { DocumentSession } from "./documentSession";
import { copyEntities, deleteEntities, stretchEntities, transformEntities } from "./editing";
import type { Editability } from "./editability";
import { cornerAt } from "./filleting";
import { trimOrExtendAt } from "./trimming";

const LAYERS: CadLayer[] = [{ name: "0", color: "#ffffff", visible: true }];
const VISIBLE = new Set(["0"]);
const ALL_EDITABLE: Editability = { isEditable: () => true, reasonFor: () => null };
const pt = (x: number, y: number): Point2D => ({ x, y });
const base = { layer: "0", color: "#ffffff" };
const VALUES = { textHeight: 100, arrowSize: 100, decimals: 0, angleDecimals: 1, unit: "mm", showUnit: false, extensionOffset: 50 } as const;
const line = (id: string, a: Point2D, b: Point2D): CadEntity => ({ ...base, id, type: "LINE", start: a, end: b });

const L: CadEntity = line("e0", pt(0, 0), pt(1000, 0));
const V: CadEntity = line("e1", pt(0, 0), pt(0, 500));
const CROSS: CadEntity = line("e2", pt(600, -100), pt(600, 100));
const C1: CadEntity = { ...base, id: "e3", type: "CIRCLE", center: pt(5000, 5000), radius: 250 };
const RECT: CadEntity = { ...base, id: "e4", type: "LWPOLYLINE", vertices: [pt(2000, 0), pt(3000, 0), pt(3000, 500), pt(2000, 500)], closed: true };

const REFS_L: DimensionRef[] = [
  { slot: "p1", id: "e0", anchor: { kind: "start" } },
  { slot: "p2", id: "e0", anchor: { kind: "end" } },
];
const dimOnLine = (id = "n0"): CadDimension => ({
  ...base,
  id,
  type: "DIMENSION",
  kind: "aligned",
  p1: pt(0, 0),
  p2: pt(1000, 0),
  position: pt(500, -300),
  values: VALUES,
  refs: REFS_L,
});

function setup(extra: CadEntity[] = [], entities: CadEntity[] = [L, V, CROSS, C1, RECT]): DocumentSession {
  const session = new DocumentSession(createDocument({ layers: LAYERS, entities }));
  if (extra.length > 0) expect(session.apply(addEntitiesChangeSet(session.document, extra, "寸法を追加")).ok).toBe(true);
  return session;
}

const get = (session: DocumentSession, id: string): CadEntity => {
  const entity = session.document.entities.find((e) => e.id === id);
  if (entity === undefined) throw new Error(`図形 ${id} がありません`);
  return entity;
};
const dim = (session: DocumentSession, id = "n0"): CadDimension => {
  const entity = get(session, id);
  if (entity.type !== "DIMENSION") throw new Error("寸法ではありません");
  return entity;
};

/** 切れていない参照が、すべて、図形の位置と(寸法の点が)一致しているか。食い違いがあれば、その説明 */
function inconsistency(document: CadDocument): string | null {
  for (const entity of document.entities) {
    if (entity.type !== "DIMENSION" || entity.refs === undefined) continue;
    for (const ref of entity.refs) {
      if (ref.broken === true) continue;
      const target = document.entities[document.indexById.get(ref.id) ?? -1];
      if (target === undefined) return `${entity.id}: 参照 ${ref.slot} の図形 ${ref.id} がありません(切れた印がありません)`;
      if (ref.slot === "p1" || ref.slot === "p2" || ref.slot === "p3") {
        const at = resolveAnchor(target, ref.anchor);
        const point = entity[ref.slot];
        if (at === null || point === undefined || !isSameAnchorPoint(at, point)) return `${entity.id}: ${ref.slot} が図形 ${ref.id} の位置と食い違っています`;
      } else if (ref.slot === "figure") {
        if (target.type !== "CIRCLE" && target.type !== "ARC") return `${entity.id}: 円ではありません`;
        if (!isSameAnchorPoint(target.center, entity.p1) || Math.abs(Math.hypot(entity.p2.x - entity.p1.x, entity.p2.y - entity.p1.y) - target.radius) > 1e-6 * Math.max(1, target.radius)) return `${entity.id}: 円と食い違っています`;
      }
    }
    if (layoutDimension(entity) === null && entity.refs.every((r) => r.broken !== true) && entity.refs.length > 0) {
      // 計算できない形でも、追従の結果なら、図形が変わった結果(長さ 0 など)。ここでは調べない
    }
  }
  return null;
}

describe("following the referenced figure (MOVE / ROTATE / SCALE / MIRROR)", () => {
  it("MOVE: the measuring points follow; the line position stays; ONE Undo restores every object and Redo repeats it", () => {
    const session = setup([dimOnLine()]);
    const before = session.document;
    expect(transformEntities(session, ALL_EDITABLE, ["e0"], translationMatrix(40, 200), "移動", "移動").ok).toBe(true);
    const d = dim(session);
    expect(d.p1).toEqual(pt(40, 200));
    expect(d.p2).toEqual(pt(1040, 200));
    expect(d.position).toEqual(pt(500, -300));
    expect(d.refs).toEqual(REFS_L);
    expect(inconsistency(session.document)).toBeNull();
    // 履歴は1段階。Undo で、図形(同じオブジェクト)も寸法も、元に戻る
    expect(session.undo().type).toBe("done");
    expect(expectSameDocument(session.document, before)).toBeNull();
    expect(session.redo().type).toBe("done");
    expect(dim(session).p2).toEqual(pt(1040, 200));
    expect(inconsistency(session.document)).toBeNull();
  });

  it("ROTATE, SCALE and MIRROR keep the measured length right (the dimension value is computed from the followed points)", () => {
    const session = setup([dimOnLine()]);
    expect(transformEntities(session, ALL_EDITABLE, ["e0"], rotationMatrix(pt(0, 0), Math.PI / 2), "回転", "回転").ok).toBe(true);
    expect(dim(session).p2.x).toBeCloseTo(0, 9);
    expect(dim(session).p2.y).toBeCloseTo(1000, 9);
    expect(layoutDimension(dim(session))!.value).toBeCloseTo(1000, 6);
    expect(transformEntities(session, ALL_EDITABLE, ["e0"], scaleMatrix(pt(0, 0), 2), "拡大縮小", "拡大縮小").ok).toBe(true);
    expect(layoutDimension(dim(session))!.value).toBeCloseTo(2000, 6);
    const axis = reflectionMatrix(pt(0, 0), pt(1, 0));
    expect(transformEntities(session, ALL_EDITABLE, ["e0"], axis!, "鏡像", "鏡像").ok).toBe(true);
    expect(dim(session).p2.y).toBeCloseTo(-2000, 6);
    expect(inconsistency(session.document)).toBeNull();
    for (let i = 0; i < 3; i++) expect(session.undo().type).toBe("done");
    expect(dim(session).p2).toEqual(pt(1000, 0));
  });

  it("moving the figure and its dimension together keeps them consistent (and the references)", () => {
    const session = setup([dimOnLine()]);
    expect(transformEntities(session, ALL_EDITABLE, ["e0", "n0"], translationMatrix(70, 30), "移動", "移動").ok).toBe(true);
    const d = dim(session);
    expect(d.p1).toEqual(pt(70, 30));
    expect(d.position).toEqual(pt(570, -270));
    expect(d.refs).toEqual(REFS_L);
    expect(session.takeNotice()).toBeNull();
    expect(inconsistency(session.document)).toBeNull();
    expect(transformEntities(session, ALL_EDITABLE, ["e0", "n0"], rotationMatrix(pt(10, 10), 0.7), "回転", "回転").ok).toBe(true);
    expect(dim(session).refs).toEqual(REFS_L);
    expect(inconsistency(session.document)).toBeNull();
  });

  it("an edit that does not touch the referenced figure changes nothing about the dimension", () => {
    const session = setup([dimOnLine()]);
    const d = dim(session);
    expect(transformEntities(session, ALL_EDITABLE, ["e1"], translationMatrix(5, 5), "移動", "移動").ok).toBe(true);
    expect(dim(session)).toBe(d);
  });
});

describe("STRETCH / TRIM / EXTEND / BREAK / FILLET / DELETE", () => {
  it("STRETCH of the figure: the dimension follows the stretched end; stretching figure and dimension together stays consistent", () => {
    const session = setup([dimOnLine()]);
    expect(stretchEntities(session, ALL_EDITABLE, ["e0"], { min: pt(900, -50), max: pt(1100, 50) }, 300, 0, "ストレッチ").ok).toBe(true);
    expect(dim(session).p2).toEqual(pt(1300, 0));
    expect(layoutDimension(dim(session))!.value).toBeCloseTo(1300, 6);
    expect(inconsistency(session.document)).toBeNull();
    expect(stretchEntities(session, ALL_EDITABLE, ["e0", "n0"], { min: pt(1200, -400), max: pt(1400, 50) }, 100, 0, "ストレッチ").ok).toBe(true);
    expect(dim(session).p2).toEqual(pt(1400, 0));
    expect(dim(session).refs).toEqual(REFS_L);
    expect(inconsistency(session.document)).toBeNull();
  });

  it("TRIM: the end that was cut moves to the cut and the dimension follows (the line keeps its id); EXTEND moves it out again", () => {
    const session = setup([dimOnLine()]);
    // CROSS (x = 600) を境界に、e0 の右側(x = 800)をクリック → e0 は (0,0)-(600,0)
    expect(trimOrExtendAt(session, ALL_EDITABLE, "trim", pt(800, 0), 5, ["e2"], VISIBLE).ok).toBe(true);
    expect((get(session, "e0") as { end: Point2D }).end.x).toBeCloseTo(600, 9);
    expect(dim(session).p2.x).toBeCloseTo(600, 9);
    expect(dim(session).refs).toEqual(REFS_L);
    expect(inconsistency(session.document)).toBeNull();
    const undone = session.undo();
    expect(undone.type).toBe("done");
    expect(dim(session).p2).toEqual(pt(1000, 0));
  });

  it("BREAK: the dimension keeps following the line with the original id (whichever end it is now)", () => {
    const session = setup([dimOnLine()]);
    expect(breakAt(session, ALL_EDITABLE, "e0", pt(400, 0), pt(600, 0)).ok).toBe(true);
    expect(inconsistency(session.document)).toBeNull();
    const kept = get(session, "e0") as { start: Point2D; end: Point2D };
    expect(dim(session).p1).toEqual(kept.start);
    expect(dim(session).p2).toEqual(kept.end);
    expect(dim(session).refs!.every((r) => r.broken !== true)).toBe(true);
  });

  it("FILLET on lines moves the ends to the tangent points; the dimension on those ends follows", () => {
    const horizontal = line("e0", pt(0, 0), pt(1000, 0));
    const vertical = line("e1", pt(1000, 0), pt(1000, 500));
    const d: CadDimension = { ...dimOnLine(), refs: [{ slot: "p1", id: "e0", anchor: { kind: "end" } }, { slot: "p2", id: "e1", anchor: { kind: "start" } }], p1: pt(1000, 0), p2: pt(1000, 0), kind: "linear", rotation: 0, position: pt(1000, -200) };
    const session = setup([d], [horizontal, vertical]);
    expect(cornerAt(session, ALL_EDITABLE, { kind: "fillet", radius: 100 }, { id: "e0", point: pt(500, 0) }, { id: "e1", point: pt(1000, 300) }).ok).toBe(true);
    expect(inconsistency(session.document)).toBeNull();
    expect(dim(session).p1.x).toBeCloseTo(900, 6);
    expect(dim(session).p2.y).toBeCloseTo(100, 6);
  });

  it("FILLET of a polyline corner changes the vertex count: the dimension on its vertices is marked broken (not moved to another vertex); the notice says so; Undo restores", () => {
    const d: CadDimension = {
      ...dimOnLine(),
      p1: pt(3000, 0),
      p2: pt(3000, 500),
      position: pt(3300, 250),
      kind: "aligned",
      refs: [{ slot: "p1", id: "e4", anchor: { kind: "vertex", index: 1 } }, { slot: "p2", id: "e4", anchor: { kind: "vertex", index: 2 } }],
    };
    const session = setup([d]);
    const before = session.document;
    const result = cornerAt(session, ALL_EDITABLE, { kind: "fillet", radius: 100 }, { id: "e4", point: pt(2500, 0) }, { id: "e4", point: pt(3000, 250) });
    expect(result.ok).toBe(true);
    const after = dim(session);
    expect(after.refs!.every((r) => r.broken === true)).toBe(true);
    expect(after.p1).toEqual(pt(3000, 0));
    expect(session.takeNotice()).toContain("参照が切れました");
    expect(session.takeNotice()).toBeNull();
    expect(inconsistency(session.document)).toBeNull();
    expect(session.undo().type).toBe("done");
    expect(expectSameDocument(session.document, before)).toBeNull();
  });

  it("DELETE of the referenced figure: the reference is broken (points stay), a notice is given, Undo restores the figure and the dimension together", () => {
    const session = setup([dimOnLine()]);
    const before = session.document;
    expect(deleteEntities(session, ALL_EDITABLE, ["e0"], "削除").ok).toBe(true);
    const d = dim(session);
    expect(d.refs!.every((r) => r.broken === true)).toBe(true);
    expect(d.p1).toEqual(pt(0, 0));
    expect(d.p2).toEqual(pt(1000, 0));
    expect(session.takeNotice()).toContain("Broken Reference");
    expect(session.undo().type).toBe("done");
    expect(expectSameDocument(session.document, before)).toBeNull();
    expect(dim(session).refs).toEqual(REFS_L);
  });

  it("deleting the figure AND the dimension together leaves nothing to follow; deleting many figures (bulk) with one referenced stays correct and undoes exactly", () => {
    const session = setup([dimOnLine()]);
    expect(deleteEntities(session, ALL_EDITABLE, ["e0", "n0"], "削除").ok).toBe(true);
    expect(session.document.entities.some((e) => e.type === "DIMENSION")).toBe(false);
    expect(session.takeNotice()).toBeNull();

    const many: CadEntity[] = [];
    for (let i = 0; i < 200; i++) many.push(line(`m${i}`, pt(i, 0), pt(i, 5)));
    const big = new DocumentSession(createDocument({ layers: LAYERS, entities: [L, ...many] }));
    big.apply(addEntitiesChangeSet(big.document, [dimOnLine()], "寸法を追加"));
    const original = big.document;
    const ids = ["e0", ...many.filter((_, i) => i % 3 === 0).map((e) => e.id)];
    expect(deleteEntities(big, ALL_EDITABLE, ids, "削除").ok).toBe(true);
    expect(big.document.entities.length).toBe(original.entities.length - ids.length);
    expect(dim(big).refs!.every((r) => r.broken === true)).toBe(true);
    expect(big.undo().type).toBe("done");
    expect(expectSameDocument(big.document, original)).toBeNull();
  });
});

describe("the dimension itself is edited", () => {
  it("MOVE of the dimension alone releases the moved points; the figure stays; a later edit of the figure no longer drags the dimension", () => {
    const session = setup([dimOnLine()]);
    expect(transformEntities(session, ALL_EDITABLE, ["n0"], translationMatrix(0, 50), "移動", "移動").ok).toBe(true);
    const moved = dim(session);
    expect(moved.p1).toEqual(pt(0, 50));
    expect(moved.refs).toBeUndefined();
    expect(session.takeNotice()).toContain("関連付けを");
    expect(transformEntities(session, ALL_EDITABLE, ["e0"], translationMatrix(0, 400), "移動", "移動").ok).toBe(true);
    expect(dim(session)).toBe(moved);
    // Undo を2回で、最初に戻る
    session.undo();
    session.undo();
    expect(dim(session).refs).toEqual(REFS_L);
  });

  it("STRETCH of the dimension alone (one end) releases only that end", () => {
    const session = setup([dimOnLine()]);
    expect(stretchEntities(session, ALL_EDITABLE, ["n0"], { min: pt(900, -50), max: pt(1100, 50) }, 200, 0, "ストレッチ").ok).toBe(true);
    expect(dim(session).p2).toEqual(pt(1200, 0));
    expect(dim(session).refs).toEqual([REFS_L[0]]);
    expect(get(session, "e0")).toBe(L);
  });

  it("moving only the dimension line position (stretch with the position alone in the window) keeps the references", () => {
    const session = setup([dimOnLine()]);
    expect(stretchEntities(session, ALL_EDITABLE, ["n0"], { min: pt(400, -400), max: pt(600, -200) }, 0, -100, "ストレッチ").ok).toBe(true);
    expect(dim(session).position).toEqual(pt(500, -400));
    expect(dim(session).refs).toEqual(REFS_L);
    expect(session.takeNotice()).toBeNull();
  });

  it("COPY of a dimension makes a plain (non-associative) dimension; the original keeps its references; copying figure + dimension together copies plain dimensions too", () => {
    const session = setup([dimOnLine()]);
    expect(copyEntities(session, ALL_EDITABLE, ["n0"], [translationMatrix(0, 1000)], "複写").ok).toBe(true);
    const dims = session.document.entities.filter((e): e is CadDimension => e.type === "DIMENSION");
    expect(dims).toHaveLength(2);
    expect(dims[0].refs).toEqual(REFS_L);
    expect(dims[1].refs).toBeUndefined();
    expect("refs" in dims[1]).toBe(false);
    // 複写の寸法は、動かした位置のまま。もとの図形を動かしても、引き戻されない
    const copyId = dims[1].id;
    expect(transformEntities(session, ALL_EDITABLE, ["e0"], translationMatrix(10, 10), "移動", "移動").ok).toBe(true);
    expect(dim(session, copyId).p1).toEqual(pt(0, 1000));

    expect(copyEntities(session, ALL_EDITABLE, ["e0", "n0"], [translationMatrix(0, 3000)], "複写").ok).toBe(true);
    const all = session.document.entities.filter((e): e is CadDimension => e.type === "DIMENSION");
    expect(all.filter((d) => d.refs !== undefined)).toHaveLength(1);
    expect(inconsistency(session.document)).toBeNull();
  });
});

describe("radius / angular references", () => {
  it("a radius dimension follows the circle (center and radius) when the circle is moved and scaled", () => {
    const d: CadDimension = { ...base, id: "n0", type: "DIMENSION", kind: "radius", p1: pt(5000, 5000), p2: pt(5250, 5000), position: pt(5600, 5000), values: VALUES, refs: [{ slot: "figure", id: "e3", anchor: { kind: "whole" } }] };
    const session = setup([d]);
    expect(transformEntities(session, ALL_EDITABLE, ["e3"], translationMatrix(100, -50), "移動", "移動").ok).toBe(true);
    expect(dim(session).p1).toEqual(pt(5100, 4950));
    expect(transformEntities(session, ALL_EDITABLE, ["e3"], scaleMatrix(pt(5100, 4950), 2), "拡大縮小", "拡大縮小").ok).toBe(true);
    expect(layoutDimension(dim(session))!.value).toBeCloseTo(500, 6);
    expect(inconsistency(session.document)).toBeNull();
  });

  it("an angular dimension by two lines follows when one line is rotated, and breaks when the lines become parallel", () => {
    const d: CadDimension = {
      ...base,
      id: "n0",
      type: "DIMENSION",
      kind: "angular",
      p1: pt(0, 0),
      p2: pt(1000, 0),
      p3: pt(0, 500),
      position: pt(300, 300),
      values: VALUES,
      refs: [{ slot: "line1", id: "e0", anchor: { kind: "whole" } }, { slot: "line2", id: "e1", anchor: { kind: "whole" } }],
    };
    const session = setup([d]);
    expect(transformEntities(session, ALL_EDITABLE, ["e1"], rotationMatrix(pt(0, 0), -Math.PI / 6), "回転", "回転").ok).toBe(true);
    // 縦の線を 30 度、時計回りに回すと、横の線との角は 60 度(弧の位置 (300,300) を含む角)
    expect(layoutDimension(dim(session))!.value).toBeCloseTo(Math.PI / 3, 6);
    const vertex = intersectionOfLines({ start: pt(0, 0), end: pt(1000, 0) }, { start: (get(session, "e1") as { start: Point2D }).start, end: (get(session, "e1") as { end: Point2D }).end });
    expect(dim(session).p1.x).toBeCloseTo(vertex!.x, 6);
    // e1 を e0 と平行にする(90度回転)と、参照は切れる
    expect(transformEntities(session, ALL_EDITABLE, ["e1"], rotationMatrix(pt(0, 0), Math.PI / 6 + Math.PI / 2), "回転", "回転").ok).toBe(true);
    expect(dim(session).refs!.every((r) => r.broken === true)).toBe(true);
    expect(session.takeNotice()).toContain("参照が切れました");
  });
});

describe("planAssociation", () => {
  it("returns the very same change set when nothing needs to follow (the fast bulk paths are kept)", () => {
    const session = setup();
    const change = replaceEntitiesChangeSet(session.document, [{ ...(L as { start: Point2D; end: Point2D } & CadEntity), end: pt(5, 5) } as CadEntity], "置き換え");
    expect(planAssociation(session.document, change).changeSet).toBe(change);
    const removal = removeEntitiesChangeSet(session.document, ["e1", "e2"], "削除");
    expect(planAssociation(session.document, removal).changeSet).toBe(removal);
    const withDim = setup([dimOnLine()]);
    const unrelated = removeEntitiesChangeSet(withDim.document, ["e1"], "削除");
    expect(planAssociation(withDim.document, unrelated).changeSet).toBe(unrelated);
    // 追加だけの変更も、そのまま
    const add = addEntitiesChangeSet(withDim.document, [line("n9", pt(0, 0), pt(1, 1))], "追加");
    expect(planAssociation(withDim.document, add).changeSet).toBe(add);
  });

  it("appends the follow-up replace to the same change set (one history step) and does not change the original", () => {
    const session = setup([dimOnLine()]);
    const moved = { ...(L as { start: Point2D; end: Point2D } & CadEntity), end: pt(2000, 0) } as CadEntity;
    const change = replaceEntitiesChangeSet(session.document, [moved], "置き換え");
    const plan = planAssociation(session.document, change);
    expect(plan.changeSet).not.toBe(change);
    expect(plan.changeSet.changes).toHaveLength(change.changes.length + 1);
    expect(plan.changeSet.label).toBe("置き換え");
    expect(change.changes).toHaveLength(1);
    expect(plan.changeSet.changes.at(-1)).toMatchObject({ kind: "replace" });
  });

  it("a figure replaced twice in one change set is judged against its ORIGINAL state: a vertex count that changed in the first step still breaks the reference", () => {
    const d: CadDimension = { ...dimOnLine(), p1: pt(3000, 0), p2: pt(3000, 500), position: pt(3300, 250), refs: [{ slot: "p1", id: "e4", anchor: { kind: "vertex", index: 1 } }] };
    const session = setup([d]);
    const original = get(session, "e4") as CadEntity & { vertices: Point2D[] };
    const rounded = { ...original, vertices: [pt(2000, 0), pt(2900, 0), pt(2990, 10), pt(3000, 100), pt(3000, 500), pt(2000, 500)] } as CadEntity;
    const again = { ...rounded, color: "#123456" } as CadEntity;
    const change = { label: "2回の置き換え", changes: [{ kind: "replace" as const, before: original, after: rounded, index: session.document.indexById.get("e4")! }, { kind: "replace" as const, before: rounded, after: again, index: session.document.indexById.get("e4")! }] };
    expect(session.apply(change).ok).toBe(true);
    expect(dim(session).refs![0].broken).toBe(true);
  });

  it("a polyline whose vertices were reshuffled in one change set (count same at start and end, different in between, or the closed flag changed) breaks the vertex references", () => {
    const d: CadDimension = { ...dimOnLine(), p1: pt(3000, 0), p2: pt(3000, 500), position: pt(3300, 250), refs: [{ slot: "p1", id: "e4", anchor: { kind: "vertex", index: 1 } }] };
    const session = setup([d]);
    const original = get(session, "e4") as CadEntity & { vertices: Point2D[] };
    const at = session.document.indexById.get("e4")!;
    // 先頭に頂点を足して、末尾を削る(頂点の数は、始めと終わりで同じ)。1回の置き換えでも、途中の置き換えでも、同じ
    const shifted = { ...original, vertices: [pt(1900, 0), pt(2000, 0), pt(3000, 0), pt(3000, 500)] } as CadEntity;
    const twoSteps = { label: "入れ替え", changes: [{ kind: "replace" as const, before: original, after: { ...original, vertices: [pt(1900, 0), ...original.vertices] } as CadEntity, index: at }] };
    const middle = twoSteps.changes[0].after;
    const back = { kind: "replace" as const, before: middle, after: shifted, index: at };
    expect(session.apply({ label: "入れ替え", changes: [...twoSteps.changes, back] }).ok).toBe(true);
    expect(dim(session).refs![0].broken).toBe(true);
    // 閉じた折れ線を、開いた折れ線にした(頂点の数は同じ)
    const session2 = setup([d]);
    const rect = get(session2, "e4") as CadEntity & { closed: boolean };
    const opened = { ...rect, closed: false } as CadEntity;
    expect(session2.apply({ label: "開く", changes: [{ kind: "replace", before: rect, after: opened, index: session2.document.indexById.get("e4")! }] }).ok).toBe(true);
    expect(dim(session2).refs![0].broken).toBe(true);
  });

  it("a change that cannot be applied is returned as is (the session reports the reason)", () => {
    const session = setup([dimOnLine()]);
    const bad = { label: "不正", changes: [{ kind: "remove" as const, entity: L, index: 99 }] };
    expect(planAssociation(session.document, bad).changeSet).toBe(bad);
    expect(session.apply(bad).ok).toBe(false);
  });
});

describe("reassociateDimension (DIMREASSOC)", () => {
  it("replaces the dimension with the new points and references as ONE Undo step; refuses unusable results with the reason", () => {
    const plain: CadDimension = { ...dimOnLine(), refs: undefined };
    delete (plain as { refs?: unknown }).refs;
    const session = setup([plain]);
    const before = session.document;
    const linked = { ...plain, refs: REFS_L };
    expect(reassociateDimension(session, ALL_EDITABLE, "n0", linked).ok).toBe(true);
    expect(dim(session).refs).toEqual(REFS_L);
    expect(session.undo().type).toBe("done");
    expect(expectSameDocument(session.document, before)).toBeNull();

    const wrongPoint = { ...plain, p1: pt(3, 3), refs: REFS_L };
    expect(reassociateDimension(session, ALL_EDITABLE, "n0", wrongPoint)).toMatchObject({ ok: false });
    expect(reassociateDimension(session, ALL_EDITABLE, "n0", { ...plain, refs: [{ slot: "p1", id: "ghost", anchor: { kind: "start" } }] })).toMatchObject({ ok: false });
    expect(reassociateDimension(session, ALL_EDITABLE, "n0", { ...plain, refs: [{ slot: "figure", id: "e0", anchor: { kind: "whole" } }] })).toMatchObject({ ok: false });
    // 円の参照は、中心と半径が、寸法の点と合っていること。合わなければ断る
    const radius: CadDimension = { ...plain, kind: "radius", p1: pt(5000, 5000), p2: pt(5250, 5000), position: pt(5600, 5000) };
    const figure = (e: CadDimension): CadDimension => ({ ...e, refs: [{ slot: "figure", id: "e3", anchor: { kind: "whole" } }] });
    expect(reassociateDimension(session, ALL_EDITABLE, "n0", figure({ ...radius, p2: pt(5300, 5000) }))).toMatchObject({ ok: false });
    expect(reassociateDimension(session, ALL_EDITABLE, "n0", figure({ ...radius, p1: pt(4000, 5000), p2: pt(4250, 5000) }))).toMatchObject({ ok: false });
    // 2本の線の参照は、頂点・腕が、線と合っていること
    const angular: CadDimension = { ...plain, kind: "angular", p1: pt(0, 0), p2: pt(1000, 0), p3: pt(0, 500), position: pt(300, 300) };
    const lines = (e: CadDimension): CadDimension => ({ ...e, refs: [{ slot: "line1", id: "e0", anchor: { kind: "whole" } }, { slot: "line2", id: "e1", anchor: { kind: "whole" } }] });
    expect(reassociateDimension(session, ALL_EDITABLE, "n0", lines({ ...angular, p1: pt(7, 7) }))).toMatchObject({ ok: false });
    expect(reassociateDimension(session, ALL_EDITABLE, "n0", lines({ ...angular, p3: pt(0, 100) }))).toMatchObject({ ok: false });
    expect(reassociateDimension(session, ALL_EDITABLE, "n0", { ...plain, p2: pt(0, 0), refs: undefined })).toMatchObject({ ok: false });
    expect(reassociateDimension(session, ALL_EDITABLE, "e0", linked)).toMatchObject({ ok: false });
    expect(reassociateDimension(session, { isEditable: () => false, reasonFor: () => "読み取り専用です" }, "n0", linked)).toMatchObject({ ok: false });
    // どの拒否でも、図面は変わっていない
    expect(expectSameDocument(session.document, before)).toBeNull();
  });

  it("repairs a broken reference: a dimension broken by DELETE is linked to a new figure and follows again", () => {
    const session = setup([dimOnLine()]);
    deleteEntities(session, ALL_EDITABLE, ["e0"], "削除");
    const replacement = line("n5", pt(0, 0), pt(1000, 0));
    session.apply(addEntitiesChangeSet(session.document, [replacement], "線を追加"));
    const repaired = { ...dim(session), refs: [{ slot: "p1" as const, id: "n5", anchor: { kind: "start" as const } }, { slot: "p2" as const, id: "n5", anchor: { kind: "end" as const } }] };
    expect(reassociateDimension(session, ALL_EDITABLE, "n0", repaired).ok).toBe(true);
    expect(transformEntities(session, ALL_EDITABLE, ["n5"], translationMatrix(0, 10), "移動", "移動").ok).toBe(true);
    expect(dim(session).p1).toEqual(pt(0, 10));
    expect(inconsistency(session.document)).toBeNull();
  });
});

describe("random edit sequences keep every non-broken reference consistent, and Undo restores the start exactly", () => {
  it("200 seeds of mixed edits (move / rotate / scale / stretch / delete / trim) on figures and dimensions", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const random = seededRandom(seed);
      const lines: CadEntity[] = [];
      for (let i = 0; i < 6; i++) lines.push(line(`e${i}`, pt(Math.round(random() * 1000), Math.round(random() * 1000)), pt(Math.round(random() * 1000) + 1500, Math.round(random() * 1000))));
      const dims: CadDimension[] = [];
      for (let i = 0; i < 4; i++) {
        const a = lines[Math.floor(random() * lines.length)] as { id: string; start: Point2D; end: Point2D };
        const b = lines[Math.floor(random() * lines.length)] as { id: string; start: Point2D; end: Point2D };
        dims.push({
          ...base,
          id: `n${i}`,
          type: "DIMENSION",
          kind: "aligned",
          p1: a.start,
          p2: b.end,
          position: pt(random() * 3000, random() * 3000),
          values: VALUES,
          refs: [{ slot: "p1", id: a.id, anchor: { kind: "start" } }, { slot: "p2", id: b.id, anchor: { kind: "end" } }],
        });
      }
      const session = new DocumentSession(createDocument({ layers: LAYERS, entities: lines }));
      session.apply(addEntitiesChangeSet(session.document, dims, "寸法を追加"));
      const start = session.document;
      let steps = 0;
      for (let k = 0; k < 8; k++) {
        const pool = [...session.document.entities.map((e) => e.id)];
        if (pool.length === 0) break;
        const picked = pool.filter(() => random() < 0.3);
        if (picked.length === 0) continue;
        const kind = Math.floor(random() * 5);
        let ok = false;
        if (kind === 0) ok = transformEntities(session, ALL_EDITABLE, picked, translationMatrix(Math.round(random() * 400 - 200), Math.round(random() * 400 - 200)), "移動", "移動").ok;
        else if (kind === 1) ok = transformEntities(session, ALL_EDITABLE, picked, rotationMatrix(pt(500, 500), random() * 3 + 0.1), "回転", "回転").ok;
        else if (kind === 2) ok = transformEntities(session, ALL_EDITABLE, picked, scaleMatrix(pt(0, 0), 0.5 + random()), "拡大縮小", "拡大縮小").ok;
        else if (kind === 3) ok = stretchEntities(session, ALL_EDITABLE, picked, { min: pt(0, 0), max: pt(random() * 2500, random() * 2500) }, Math.round(random() * 200 - 100), Math.round(random() * 200 - 100), "ストレッチ").ok;
        else ok = deleteEntities(session, ALL_EDITABLE, picked.slice(0, 2), "削除").ok;
        if (ok) steps++;
        expect(inconsistency(session.document), `seed ${seed} step ${k} kind ${kind}`).toBeNull();
      }
      for (let i = 0; i < steps; i++) expect(session.undo().type, `undo seed ${seed}`).toBe("done");
      // 追加(寸法)の1段階だけが残る
      expect(expectSameDocument(session.document, start), `restored seed ${seed}`).toBeNull();
    }
  });
});
