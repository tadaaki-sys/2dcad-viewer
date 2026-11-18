import { describe, expect, it } from "vitest";
import { createSelectionPreview } from "../../core/commands/entityPreview";
import type { CadEntity } from "../../types/cad";
import { createEditability, resolveEditTargets } from "../document/editability";
import { createAppCommandSession } from "./builtinCommands";
import { makeContext } from "./testHelpers";
import { NO_EDITING } from "./types";
import type { AppEditing, AppRequest } from "./types";

const base = { layer: "0", color: "#ffffff" };
const ENTITIES: CadEntity[] = [
  { ...base, id: "e0", type: "LINE", start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
  { ...base, id: "e1", type: "CIRCLE", center: { x: 50, y: 50 }, radius: 20 },
  { ...base, id: "e2", type: "LINE", start: { x: 0, y: 10 }, end: { x: 100, y: 10 } }, // ブロックの中身(読み取り専用)
];
const editability = createEditability({
  importedIndexById: new Map(ENTITIES.map((entity, index) => [entity.id, index])),
  nested: Uint8Array.from([0, 0, 1]),
  parserIndex: Int32Array.from([0, 1, 2]),
});

function start(selection: string[], overrides: Partial<AppEditing> = {}) {
  let current = selection;
  const editing: AppEditing = {
    ready: true,
    getSelection: () => current,
    resolveTargets: (ids) => resolveEditTargets(editability, ids),
    createPreview: (ids) => createSelectionPreview(ENTITIES.filter((entity) => ids.includes(entity.id))),
    findInWindow: NO_EDITING.findInWindow,
    createStretchPreview: NO_EDITING.createStretchPreview,
    pickEntity: NO_EDITING.pickEntity,
    createOffsetPreview: NO_EDITING.createOffsetPreview,
    createBreakPreview: NO_EDITING.createBreakPreview,
    ...overrides,
  };
  const context = makeContext({ editing });
  return { session: createAppCommandSession(() => context), setSelection: (ids: string[]) => (current = ids) };
}

function request(requests: readonly AppRequest[]): AppRequest {
  if (requests.length !== 1) throw new Error(`依頼が1つではありません: ${requests.length}`);
  return requests[0];
}

describe("starting an edit command", () => {
  it("with a selection it goes straight to the base point", () => {
    const { session } = start(["e0", "e1"]);
    const result = session.submitText("move");
    expect(result.active).toMatchObject({ name: "MOVE", prompt: "基点を指示してください", expect: "point" });
    expect(result.requests).toEqual([]);
  });

  it("without a selection it waits for a selection and Enter (the usual selection gestures are used)", () => {
    const { session } = start([]);
    const result = session.submitText("move");
    expect(result.active).toMatchObject({ name: "MOVE", expect: "selection", acceptsEnter: false });
    expect(result.active?.prompt).toContain("選択して");
    // 点の指示は、受け付けない。文字を打っても、案内が出て、同じ段階のまま
    expect(session.submitPoint({ x: 1, y: 1 }).active?.expect).toBe("selection");
    const typed = session.submitText("1,1");
    expect(typed.messages[0]).toContain("図形を選択してから");
    expect(typed.active?.expect).toBe("selection");
  });

  it("an empty selection at Enter keeps waiting with a message; a selection moves on to the base point", () => {
    const { session } = start([]);
    session.submitText("move");
    const empty = session.submitSelection([]);
    expect(empty.active?.expect).toBe("selection");
    expect(empty.messages[0]).toContain("図形が選択されていません");
    const chosen = session.submitSelection(["e0"]);
    expect(chosen.active).toMatchObject({ prompt: "基点を指示してください", expect: "point" });
  });

  it("a selection of only read-only entities is refused with the reason, and nothing is asked further", () => {
    const { session } = start(["e2"]);
    const result = session.submitText("move");
    expect(result.active).toBeNull();
    expect(result.messages[0]).toContain("編集できる図形が選択されていません");
    expect(result.messages[0]).toContain("読み取り専用");
  });

  it("read-only entities mixed in are dropped with a notice, and the rest is used", () => {
    const { session } = start(["e0", "e2"]);
    const result = session.submitText("move");
    expect(result.active?.prompt).toBe("基点を指示してください");
    expect(result.messages.join(" ")).toContain("編集できない図形 1 個は除きました");
    session.submitPoint({ x: 0, y: 0 });
    const done = session.submitPoint({ x: 10, y: 5 });
    expect(request(done.requests)).toMatchObject({ type: "transformEntities", ids: ["e0"] });
  });

  it("refuses without a drawing and while the document is not ready", () => {
    expect(start([], {}).session.submitText("move").active).not.toBeNull(); // 準備できていれば、始まる
    const notOpen = createAppCommandSession(() => makeContext({ isDocumentOpen: false }));
    expect(notOpen.submitText("move").messages).toEqual(["図面が開かれていません"]);
    const notReady = start(["e0"], { ready: false });
    const result = notReady.session.submitText("move");
    expect(result.active).toBeNull();
    expect(result.messages[0]).toContain("準備中");
  });

  it("aliases: MO, CO, CP, RO, E, DEL (M stays MEASURE)", () => {
    for (const [alias, name] of [["mo", "MOVE"], ["co", "COPY"], ["cp", "COPY"], ["ro", "ROTATE"]] as const) {
      expect(start(["e0"]).session.submitText(alias).active?.name).toBe(name);
    }
    expect(start(["e0"]).session.submitText("e").requests[0]).toMatchObject({ type: "deleteEntities" });
    expect(start(["e0"]).session.submitText("del").requests[0]).toMatchObject({ type: "deleteEntities" });
    expect(start(["e0"]).session.submitText("m").requests[0]).toMatchObject({ type: "toggleMeasurement" });
  });
});

describe("MOVE", () => {
  it("base point, then target point: one request with the translation and the ids", () => {
    const { session } = start(["e0", "e1"]);
    session.submitText("move");
    const second = session.submitPoint({ x: 10, y: 10 });
    expect(second.active).toMatchObject({ prompt: "移動先の点を指示してください", basePoint: { x: 10, y: 10 }, acceptsEnter: true, hasPreview: true });
    const done = session.submitPoint({ x: 110, y: 40 });
    expect(request(done.requests)).toEqual({
      type: "transformEntities",
      ids: ["e0", "e1"],
      matrix: [1, 0, 0, 1, 100, 30],
      label: "2個の図形を移動",
      noun: "移動",
    });
    expect(done.active).toBeNull();
  });

  it("typed coordinates: absolute base, relative target (@500,0)", () => {
    const { session } = start(["e0"]);
    session.submitText("move");
    session.submitText("100,100");
    const done = session.submitText("@500,0");
    expect(request(done.requests)).toMatchObject({ matrix: [1, 0, 0, 1, 500, 0], label: "図形を移動" });
  });

  it("the same point as the base is refused and the command keeps waiting; Enter and Esc end without a request", () => {
    const { session } = start(["e0"]);
    session.submitText("move");
    session.submitPoint({ x: 5, y: 5 });
    const same = session.submitPoint({ x: 5, y: 5 });
    expect(same.requests).toEqual([]);
    expect(same.messages[0]).toContain("移動量が0です");
    expect(same.active?.prompt).toBe("移動先の点を指示してください");
    expect(session.submitText("").requests).toEqual([]);
    expect(session.active).toBeNull();
    session.submitText("move");
    expect(session.cancel().requests).toEqual([]);
  });

  it("the preview shows the moved shape and a guide line from the base point", () => {
    const { session } = start(["e0"]);
    session.submitText("move");
    session.submitPoint({ x: 0, y: 0 });
    const shapes = session.previewAt({ x: 20, y: 30 });
    expect(shapes).toEqual([
      { kind: "polyline", points: [{ x: 20, y: 30 }, { x: 120, y: 30 }], closed: false },
      { kind: "polyline", points: [{ x: 0, y: 0 }, { x: 20, y: 30 }], closed: false },
    ]);
    // 基点の指示の段階では、仮表示は無い
    const first = start(["e0"]);
    first.session.submitText("move");
    expect(first.session.previewAt({ x: 1, y: 1 })).toEqual([]);
  });
});

describe("COPY", () => {
  it("repeats: every target point is kept, Enter ends and sends ONE request with all the offsets", () => {
    const { session } = start(["e0"]);
    session.submitText("copy");
    session.submitPoint({ x: 0, y: 0 });
    const first = session.submitPoint({ x: 0, y: 50 });
    expect(first.active).toMatchObject({ prompt: expect.stringContaining("次のコピー先"), keywords: ["U"], hasPendingChanges: true, acceptsEnter: true });
    expect(first.requests).toEqual([]);
    session.submitPoint({ x: 0, y: 100 });
    const done = session.submitText("");
    expect(request(done.requests)).toEqual({
      type: "copyEntities",
      ids: ["e0"],
      matrices: [[1, 0, 0, 1, 0, 50], [1, 0, 0, 1, 0, 100]],
      label: "図形をコピー(2回)",
    });
    expect(done.active).toBeNull();
  });

  it("Esc also confirms what was copied; U takes back the last copy; nothing copied says so", () => {
    const { session } = start(["e0", "e1"]);
    session.submitText("copy");
    session.submitPoint({ x: 0, y: 0 });
    session.submitPoint({ x: 10, y: 0 });
    session.submitPoint({ x: 20, y: 0 });
    session.submitText("u"); // 2つ目を取り消す
    const done = session.cancel();
    expect(request(done.requests)).toMatchObject({ type: "copyEntities", matrices: [[1, 0, 0, 1, 10, 0]], label: "2個の図形をコピー" });

    const empty = start(["e0"]);
    empty.session.submitText("copy");
    empty.session.submitPoint({ x: 0, y: 0 });
    const ended = empty.session.submitText("");
    expect(ended.requests).toEqual([]);
    expect(ended.messages[0]).toContain("コピーは作られませんでした");
  });

  it("the preview also shows the copies already placed", () => {
    const { session } = start(["e0"]);
    session.submitText("copy");
    session.submitPoint({ x: 0, y: 0 });
    session.submitPoint({ x: 0, y: 50 });
    const shapes = session.previewAt({ x: 0, y: 100 });
    const lines = shapes.filter((shape) => shape.kind === "polyline" && shape.points.length === 2 && shape.points[0].x === 0 && shape.points[1].x === 100);
    expect(lines.map((shape) => (shape.kind === "polyline" ? shape.points[0].y : null))).toEqual([50, 100]);
  });

  it("the same point as the base is refused", () => {
    const { session } = start(["e0"]);
    session.submitText("copy");
    session.submitPoint({ x: 3, y: 3 });
    const same = session.submitPoint({ x: 3, y: 3 });
    expect(same.messages[0]).toContain("移動量が0です");
    expect(same.active?.hasPendingChanges).toBe(false);
  });
});

describe("ROTATE", () => {
  it("a typed number is the angle in degrees (counter-clockwise); 90 gives an exact quarter turn", () => {
    const { session } = start(["e0"]);
    session.submitText("rotate");
    const angleStep = session.submitPoint({ x: 10, y: 20 });
    expect(angleStep.active).toMatchObject({ acceptsDistance: true, numberMeaning: "angle", basePoint: { x: 10, y: 20 }, hasPreview: true });
    const done = session.submitText("90");
    const sent = request(done.requests);
    expect(sent).toMatchObject({ type: "transformEntities", ids: ["e0"], noun: "回転", label: "図形を回転(90.0度)" });
    // 基点 (10,20) まわりに 90度: x' = -(y-20) + 10, y' = (x-10) + 20 → 行列の成分は、正確
    expect((sent as unknown as { matrix: number[] }).matrix).toEqual([0, 1, -1, 0, 30, 10]);
  });

  it("a click gives the angle of the direction from the base point; negative and over-360 numbers fold into 0 - 360", () => {
    const { session } = start(["e0"]);
    session.submitText("ro");
    session.submitPoint({ x: 0, y: 0 });
    const done = session.submitPoint({ x: 0, y: 100 }); // 真上: 90度
    expect(request(done.requests)).toMatchObject({ label: "図形を回転(90.0度)" });
    const negative = start(["e0"]);
    negative.session.submitText("ro");
    negative.session.submitPoint({ x: 0, y: 0 });
    expect(request(negative.session.submitText("-90").requests)).toMatchObject({ label: "図形を回転(270.0度)" });
  });

  it("0 degrees (also 360), the base point itself and Enter are not rotations", () => {
    const { session } = start(["e0"]);
    session.submitText("rotate");
    session.submitPoint({ x: 0, y: 0 });
    for (const text of ["0", "360", "-720"]) {
      const result = session.submitText(text);
      expect(result.requests, text).toEqual([]);
      expect(result.messages[0]).toContain("回転角が0度です");
      expect(result.active).not.toBeNull();
    }
    const same = session.submitPoint({ x: 0, y: 0 });
    expect(same.messages[0]).toContain("基点と同じ点");
    expect(same.requests).toEqual([]);
    const enter = session.submitText("");
    expect(enter.requests).toEqual([]);
    expect(enter.active).toBeNull();
  });

  it("the preview shows the rotated shape, nothing while the cursor is on the base point", () => {
    const { session } = start(["e0"]);
    session.submitText("rotate");
    session.submitPoint({ x: 0, y: 0 });
    expect(session.previewAt({ x: 0, y: 0 })).toEqual([]);
    const shapes = session.previewAt({ x: 0, y: 50 }); // 90度
    expect(shapes[0]).toEqual({ kind: "polyline", points: [{ x: 0, y: 0 }, { x: 0, y: 100 }], closed: false });
  });
});

describe("DELETE", () => {
  it("with a selection it sends one request at once", () => {
    const { session } = start(["e0", "e1"]);
    const result = session.submitText("delete");
    expect(request(result.requests)).toEqual({ type: "deleteEntities", ids: ["e0", "e1"], label: "2個の図形を削除" });
    expect(result.active).toBeNull();
  });

  it("without a selection it asks for one, then deletes", () => {
    const { session } = start([]);
    session.submitText("delete");
    const result = session.submitSelection(["e1"]);
    expect(request(result.requests)).toEqual({ type: "deleteEntities", ids: ["e1"], label: "図形を削除" });
  });

  it("read-only entities only: refused with the reason", () => {
    const { session } = start(["e2"]);
    const result = session.submitText("delete");
    expect(result.requests).toEqual([]);
    expect(result.messages[0]).toContain("読み取り専用");
  });
});

describe("the selection step and dynamic input", () => {
  it("a selection step has no dynamic input; the base/target steps of MOVE do (polar from the base point)", () => {
    const { session } = start([]);
    session.submitText("move");
    expect(session.active?.expect).toBe("selection");
    session.submitSelection(["e0"]);
    session.submitPoint({ x: 0, y: 0 });
    expect(session.active?.basePoint).toEqual({ x: 0, y: 0 });
  });
});

describe("a large selection", () => {
  it("MOVE of more than 300 entities previews only the bounding box (cheap), as a closed rectangle", () => {
    const many: CadEntity[] = Array.from({ length: 1000 }, (_, i) => ({ ...base, id: `e${i}`, type: "LINE", start: { x: i, y: 0 }, end: { x: i + 1, y: 10 } }) as CadEntity);
    const manyEditability = createEditability({
      importedIndexById: new Map(many.map((entity, index) => [entity.id, index])),
      nested: new Uint8Array(many.length),
      parserIndex: Int32Array.from(many, (_, i) => i),
    });
    const editing: AppEditing = {
      ready: true,
      getSelection: () => many.map((entity) => entity.id),
      resolveTargets: (ids) => resolveEditTargets(manyEditability, ids),
      createPreview: (ids) => createSelectionPreview(many.filter((entity) => ids.includes(entity.id))),
      findInWindow: NO_EDITING.findInWindow,
      createStretchPreview: NO_EDITING.createStretchPreview,
      pickEntity: NO_EDITING.pickEntity,
      createOffsetPreview: NO_EDITING.createOffsetPreview,
      createBreakPreview: NO_EDITING.createBreakPreview,
    };
    const session = createAppCommandSession(() => makeContext({ editing }));
    session.submitText("move");
    session.submitPoint({ x: 0, y: 0 });
    const shapes = session.previewAt({ x: 5, y: 7 });
    const boxes = shapes.filter((shape) => shape.kind === "polyline" && shape.closed);
    expect(boxes).toHaveLength(1);
    expect(boxes[0]).toMatchObject({ points: [{ x: 5, y: 7 }, { x: 1005, y: 7 }, { x: 1005, y: 17 }, { x: 5, y: 17 }] });
    const done = session.submitPoint({ x: 5, y: 7 });
    expect(done.requests).toHaveLength(1);
  });
});

describe("ROTATE: precision of the angle", () => {
  it("a small angle (0.000001 degrees) is a rotation, not rounded to 0; 450 and 90 give the same exact matrix", () => {
    const tiny = start(["e0"]);
    tiny.session.submitText("rotate");
    tiny.session.submitPoint({ x: 0, y: 0 });
    const sent = request(tiny.session.submitText("0.000001").requests) as unknown as { matrix: number[] };
    expect(sent.matrix[1]).toBeGreaterThan(0);

    const a = start(["e0"]);
    a.session.submitText("rotate");
    a.session.submitPoint({ x: 0, y: 0 });
    const b = start(["e0"]);
    b.session.submitText("rotate");
    b.session.submitPoint({ x: 0, y: 0 });
    const m90 = (request(a.session.submitText("90").requests) as unknown as { matrix: number[] }).matrix;
    const m450 = (request(b.session.submitText("450").requests) as unknown as { matrix: number[] }).matrix;
    expect(m450).toEqual(m90);
    expect(m90).toEqual([0, 1, -1, 0, 0, 0]);
  });

  it("a huge number of degrees is folded by 360 first (exact), so it does not lose the angle", () => {
    const { session } = start(["e0"]);
    session.submitText("rotate");
    session.submitPoint({ x: 0, y: 0 });
    const sent = request(session.submitText("3600000090").requests) as unknown as { matrix: number[]; label: string };
    expect(sent.matrix).toEqual([0, 1, -1, 0, 0, 0]);
    expect(sent.label).toContain("90.0度");
  });
});

describe("COPY: the preview of the copies already placed is built once per step", () => {
  it("only the cursor's own copy is rebuilt on every cursor move", () => {
    const calls: number[] = [];
    const { session } = start(["e0"], {
      createPreview: (ids) => {
        const inner = createSelectionPreview(ENTITIES.filter((entity) => ids.includes(entity.id)));
        return (matrices) => {
          calls.push(matrices.length);
          return inner(matrices);
        };
      },
    });
    session.submitText("copy");
    session.submitPoint({ x: 0, y: 0 });
    session.submitPoint({ x: 0, y: 10 });
    session.submitPoint({ x: 0, y: 20 });
    calls.length = 0;
    session.previewAt({ x: 0, y: 30 });
    session.previewAt({ x: 0, y: 40 });
    session.previewAt({ x: 0, y: 50 });
    expect(calls).toEqual([2, 1, 1, 1]); // 指示済みの2つは1回だけ。カーソルの分は、毎回
  });
});
