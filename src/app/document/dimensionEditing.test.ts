// 寸法を、図面・履歴・既存の編集コマンドに通したときの動き(Phase 15): 追加・移動・複写・ストレッチ・Undo、対象外の編集、スナップ
import { describe, expect, it } from "vitest";
import { addEntitiesChangeSet } from "../../core/history";
import { createDocument } from "../../core/model";
import { layoutDimension } from "../../core/dimension/dimensionGeometry";
import { rotationMatrix, translationMatrix } from "../../core/geometry/transform";
import { findSnapPoint } from "../../core/snap/SnapEngine";
import { OBJECT_SNAP_TYPES } from "../../core/snap/snapTypes";
import type { CadDimension, CadEntity, CadLayer, Point2D } from "../../types/cad";
import { breakAt } from "./breaking";
import { createEditability } from "./editability";
import { DocumentSession } from "./documentSession";
import { copyEntities, deleteEntities, stretchEntities, transformEntities } from "./editing";
import { cornerAt } from "./filleting";
import { offsetAt } from "./offsetting";
import { pickEntityAt, pickTargetOf } from "./picking";
import { trimOrExtendAt } from "./trimming";

const LAYERS: CadLayer[] = [{ name: "0", color: "#ffffff", visible: true }];
const pt = (x: number, y: number): Point2D => ({ x, y });
const VALUES = { textHeight: 100, arrowSize: 100, decimals: 0, angleDecimals: 1, unit: "mm", showUnit: false, extensionOffset: 50 } as const;
const VISIBLE = new Set(["0"]);

const horizontal: CadDimension = {
  id: "n0",
  type: "DIMENSION",
  layer: "0",
  color: "#ffffff",
  kind: "linear",
  rotation: 0,
  p1: pt(0, 0),
  p2: pt(1000, 0),
  position: pt(500, 600),
  values: VALUES,
  styleName: "Standard",
};

function setup() {
  const imported: CadEntity[] = [
    { id: "e0", type: "LINE", layer: "0", color: "#ffffff", start: pt(-500, 300), end: pt(2000, 300) },
    { id: "e1", type: "CIRCLE", layer: "0", color: "#ffffff", center: pt(3000, 0), radius: 100 },
  ];
  const session = new DocumentSession(createDocument({ layers: LAYERS, entities: imported }));
  const editability = createEditability({
    importedIndexById: new Map(imported.map((entity, index) => [entity.id, index])),
    nested: Uint8Array.from([0, 0]),
    parserIndex: Int32Array.from([0, 1]),
  });
  return { session, editability };
}

function withDimension(entity: CadDimension = horizontal) {
  const state = setup();
  const outcome = state.session.apply(addEntitiesChangeSet(state.session.document, [entity], "寸法を追加"));
  expect(outcome.ok).toBe(true);
  return state;
}

const get = (session: DocumentSession, id: string): CadDimension => {
  const entity = session.document.entities.find((e) => e.id === id);
  if (entity === undefined || entity.type !== "DIMENSION") throw new Error(`寸法 ${id} がありません`);
  return entity;
};

describe("adding a dimension", () => {
  it("is ONE Undo step; Undo removes it and Redo brings back the same object", () => {
    const { session } = setup();
    const before = session.document.entities.length;
    session.apply(addEntitiesChangeSet(session.document, [horizontal], "寸法を追加"));
    expect(session.document.entities.length).toBe(before + 1);
    expect(session.document.entities.at(-1)).toBe(horizontal);
    expect(session.undo().type).toBe("done");
    expect(session.document.entities.length).toBe(before);
    expect(session.canUndo).toBe(false);
    expect(session.redo().type).toBe("done");
    expect(session.document.entities.at(-1)).toBe(horizontal);
  });
});

describe("existing edits applied to a dimension", () => {
  it("MOVE shifts the defining points; no source record is attached to a new figure; Undo restores the same object", () => {
    const { session, editability } = withDimension();
    expect(transformEntities(session, editability, ["n0"], translationMatrix(100, 50), "移動", "移動").ok).toBe(true);
    const moved = get(session, "n0");
    expect(moved.p1).toEqual(pt(100, 50));
    expect(moved.position).toEqual(pt(600, 650));
    expect("sourceRecord" in moved).toBe(false);
    expect(layoutDimension(moved)?.value).toBeCloseTo(1000);
    session.undo();
    expect(get(session, "n0")).toBe(horizontal);
  });

  it("ROTATE keeps the measured length and turns the direction", () => {
    const { session, editability } = withDimension();
    expect(transformEntities(session, editability, ["n0"], rotationMatrix(pt(0, 0), Math.PI / 2), "回転", "回転").ok).toBe(true);
    const turned = get(session, "n0");
    expect(turned.rotation).toBeCloseTo(Math.PI / 2);
    expect(layoutDimension(turned)?.value).toBeCloseTo(1000);
  });

  it("COPY adds a new dimension with a new id; the original stays", () => {
    const { session, editability } = withDimension();
    expect(copyEntities(session, editability, ["n0"], [translationMatrix(0, 1000)], "複写").ok).toBe(true);
    const copies = session.document.entities.filter((e) => e.type === "DIMENSION");
    expect(copies).toHaveLength(2);
    expect(copies[0]).toBe(horizontal);
    const copy = copies[1] as CadDimension;
    expect(copy.id).not.toBe("n0");
    expect(copy.p1).toEqual(pt(0, 1000));
    expect("sourceRecord" in copy).toBe(false);
  });

  it("STRETCH changes the measured length when only one origin is in the window; one Undo step restores it", () => {
    const { session, editability } = withDimension();
    const result = stretchEntities(session, editability, ["n0"], { min: pt(900, -100), max: pt(1100, 100) }, 250, 0, "ストレッチ");
    expect(result.ok).toBe(true);
    expect(layoutDimension(get(session, "n0"))?.value).toBeCloseTo(1250);
    expect("sourceRecord" in get(session, "n0")).toBe(false);
    session.undo();
    expect(get(session, "n0")).toBe(horizontal);
    expect(session.canUndo).toBe(true);
  });

  it("STRETCH skips a radius dimension that is only partly in the window and says so", () => {
    const radius: CadDimension = { ...horizontal, kind: "radius", rotation: undefined, p1: pt(0, 0), p2: pt(100, 0), position: pt(400, 0) };
    delete (radius as { rotation?: number }).rotation;
    const { session, editability } = withDimension(radius);
    const result = stretchEntities(session, editability, ["n0"], { min: pt(-10, -10), max: pt(150, 10) }, 5, 0, "ストレッチ");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("円弧・楕円・寸法 1 個");
    expect(get(session, "n0")).toBe(radius);
  });

  it("DELETE removes it; Undo brings it back", () => {
    const { session, editability } = withDimension();
    expect(deleteEntities(session, editability, ["n0"], "削除").ok).toBe(true);
    expect(session.document.entities.some((e) => e.id === "n0")).toBe(false);
    session.undo();
    expect(get(session, "n0")).toBe(horizontal);
  });

  it("a transform that would overflow is refused and changes nothing", () => {
    const huge: CadDimension = { ...horizontal, p1: pt(1e308, 0), p2: pt(1e308, 1), position: pt(1e308, 5) };
    const { session, editability } = withDimension(huge);
    const history = session.canUndo;
    const result = transformEntities(session, editability, ["n0"], translationMatrix(1e308, 0), "移動", "移動");
    expect(result.ok).toBe(false);
    expect(get(session, "n0")).toBe(huge);
    expect(session.canUndo).toBe(history);
  });
});

describe("figures a dimension is not a target of", () => {
  const TOLERANCE = 5;

  it("clicking a dimension for TRIM / OFFSET / BREAK / FILLET says what can be done", () => {
    const { session, editability } = withDimension();
    const trimmed = trimOrExtendAt(session, editability, "trim", pt(300, 600), TOLERANCE, null, VISIBLE);
    expect(trimmed.ok).toBe(false);
    // 寸法線の上をクリックしても、寸法は対象にならない(寸法線の上に、ほかの図形も無い)
    expect(trimmed.message).toContain("DIMENSION");
    expect(trimmed.message).toContain("できません");
    expect(offsetAt(session, editability, "n0", 10, pt(300, 700)).ok).toBe(false);
    expect(breakAt(session, editability, "n0", pt(100, 600), pt(400, 600)).ok).toBe(false);
    expect(cornerAt(session, editability, { kind: "fillet", radius: 10 }, { id: "n0", point: pt(100, 600) }, { id: "e0", point: pt(100, 300) }).ok).toBe(false);
    expect(get(session, "n0")).toBe(horizontal);
  });

  it("is not a TRIM boundary: a line crossing its extension lines is not cut by them", () => {
    const { session, editability } = withDimension();
    // e0 は y = 300 の横線で、寸法補助線(x = 0 と x = 1000、y = 50〜650)と交わる
    const result = trimOrExtendAt(session, editability, "trim", pt(500, 300), TOLERANCE, null, VISIBLE);
    expect(result.ok).toBe(false);
    expect(session.document.entities.find((e) => e.id === "e0")?.type).toBe("LINE");
  });

  it("the dimension kinds for the commands pick only the figures they measure", () => {
    const { session, editability } = withDimension();
    const circular = pickTargetOf("circular");
    expect(pickEntityAt(session, editability, pt(3100, 0), TOLERANCE, VISIBLE, circular.types, "寸法", undefined, circular.label)).toMatchObject({ ok: true });
    const line = pickTargetOf("line");
    expect(pickEntityAt(session, editability, pt(3100, 0), TOLERANCE, VISIBLE, line.types, "寸法", undefined, line.label)).toMatchObject({ ok: false });
    expect(pickEntityAt(session, editability, pt(300, 300), TOLERANCE, VISIBLE, line.types, "寸法", undefined, line.label)).toMatchObject({ ok: true });
    // 寸法そのものは、どちらにも指せない。円・円弧の指定では、線(e0)は指せない
    expect(pickEntityAt(session, editability, pt(300, 600), TOLERANCE, VISIBLE, circular.types, "寸法", undefined, circular.label)).toMatchObject({ ok: false });
    const onLine = pickEntityAt(session, editability, pt(300, 300), TOLERANCE, VISIBLE, circular.types, "寸法", undefined, circular.label);
    expect(onLine).toMatchObject({ ok: false });
    expect(onLine.ok ? "" : onLine.message).toContain("円・円弧");
  });
});

describe("snapping", () => {
  const all = new Set(OBJECT_SNAP_TYPES);
  const snap = (entities: readonly CadEntity[], at: Point2D) =>
    findSnapPoint(entities, VISIBLE, at, 20, null, { enabledTypes: new Set([...all, "nearest" as const]), nearestToleranceWorld: 20, extensionAcquireWorld: 20, fromPoint: pt(5000, 5000) });

  it("a dimension offers no snap point: not its extension line ends, arrow tips, line middle or nearest point", () => {
    for (const at of [pt(0, 50), pt(0, 650), pt(1000, 650), pt(0, 600), pt(500, 600), pt(250, 600), pt(1000, 350), pt(0, 300)]) {
      expect(snap([horizontal], at)).toBeNull();
    }
  });

  it("the other figures still snap as before (a dimension next to them changes nothing)", () => {
    const line: CadEntity = { id: "e0", type: "LINE", layer: "0", color: "#ffffff", start: pt(-500, 300), end: pt(2000, 300) };
    expect(snap([line], pt(-500, 300))?.type).toBe("endpoint");
    expect(snap([line, horizontal], pt(-500, 300))?.type).toBe("endpoint");
    // 寸法補助線と交わる位置(0, 300)にも、交点は出さない
    const candidate = snap([line, horizontal], pt(0, 300));
    expect(candidate?.type).not.toBe("intersection");
  });
});
