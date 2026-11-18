// MIRROR・SCALE・STRETCH のコマンドの進み方(Phase 10)
import { describe, expect, it } from "vitest";
import { createSelectionPreview, createStretchPreview } from "../../core/commands/entityPreview";
import { boundsTouchWindow } from "../../core/geometry/stretch";
import { reflectionMatrix, scaleMatrix } from "../../core/geometry/transform";
import { computeAllEntityBounds } from "../../core/spatial/entityBounds";
import type { CadEntity } from "../../types/cad";
import { createEditability, resolveEditTargets } from "../document/editability";
import { createAppCommandSession } from "./builtinCommands";
import { makeContext } from "./testHelpers";
import { MAX_SCALE_FACTOR, MIN_SCALE_FACTOR } from "./transformCommands";
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
  const editing: AppEditing = {
    ready: true,
    getSelection: () => selection,
    resolveTargets: (ids) => resolveEditTargets(editability, ids),
    createPreview: (ids) => createSelectionPreview(ENTITIES.filter((entity) => ids.includes(entity.id))),
    findInWindow: (window) => {
      const touching = ENTITIES.filter((entity) => boundsTouchWindow(computeAllEntityBounds([entity]), 0, window)).map((entity) => entity.id);
      return resolveEditTargets(editability, touching);
    },
    createStretchPreview: (ids, window) => createStretchPreview(ENTITIES.filter((entity) => ids.includes(entity.id)), window),
    pickEntity: NO_EDITING.pickEntity,
    createOffsetPreview: NO_EDITING.createOffsetPreview,
    createBreakPreview: NO_EDITING.createBreakPreview,
    ...overrides,
  };
  return createAppCommandSession(() => makeContext({ editing }));
}

function only(requests: readonly AppRequest[]): AppRequest {
  if (requests.length !== 1) throw new Error(`依頼が1つではありません: ${requests.length}`);
  return requests[0];
}

describe("aliases and starting", () => {
  it("MI, SC and S are the short names", () => {
    for (const [alias, prompt] of [["mi", "鏡像軸の1点目"], ["sc", "基点"], ["s", "窓の1点目"]] as const) {
      const session = start(["e0"]);
      const result = session.submitText(alias);
      expect(result.active?.prompt, alias).toContain(prompt);
    }
  });

  it("without a document or while loading, nothing starts; without a selection MIRROR and SCALE ask for one, STRETCH does not need one", () => {
    const closed = createAppCommandSession(() => makeContext({ isDocumentOpen: false }));
    for (const name of ["mirror", "scale", "stretch"]) expect(closed.submitText(name).messages[0]).toContain("図面が開かれていません");
    const loading = start(["e0"], { ready: false });
    for (const name of ["mirror", "scale", "stretch"]) expect(loading.submitText(name).messages[0]).toContain("準備中");
    for (const name of ["mirror", "scale"]) {
      const session = start([]);
      expect(session.submitText(name).active).toMatchObject({ expect: "selection" });
    }
    expect(start([]).submitText("stretch").active).toMatchObject({ expect: "point", prompt: expect.stringContaining("窓の1点目") });
  });

  it("read-only entities in the selection are left out with a notice; only read-only ones refuse to start", () => {
    const mixed = start(["e0", "e2"]);
    const result = mixed.submitText("mirror");
    expect(result.messages.join("\n")).toContain("編集できない図形 1 個は除きました");
    const readOnly = start(["e2"]).submitText("scale");
    expect(readOnly.active).toBeNull();
    expect(readOnly.messages[0]).toContain("編集できる図形が選択されていません");
  });
});

describe("MIRROR", () => {
  const axis = reflectionMatrix({ x: 0, y: 0 }, { x: 0, y: 100 })!;

  function toQuestion(selection = ["e0"]) {
    const session = start(selection);
    session.submitText("mirror");
    session.submitPoint({ x: 0, y: 0 });
    const asked = session.submitPoint({ x: 0, y: 100 });
    return { session, asked };
  }

  it("the second axis point shows the mirrored shape as a preview", () => {
    const session = start(["e0"]);
    session.submitText("mirror");
    session.submitPoint({ x: 0, y: 0 });
    const shapes = session.previewAt({ x: 0, y: 100 });
    expect(shapes[0]).toEqual({ kind: "polyline", points: [{ x: 0, y: 0 }, { x: -100, y: 0 }], closed: false });
    expect(shapes[1]).toEqual({ kind: "polyline", points: [{ x: 0, y: 0 }, { x: 0, y: 100 }], closed: false }); // 軸の案内線
    expect(session.previewAt({ x: 0, y: 0 }).filter((shape) => shape.kind === "polyline" && shape.points[1].x === -100)).toEqual([]); // 軸が決まらない点では、鏡像は出さない
  });

  it("asks whether to delete the originals, in text (no dynamic input, no clicks)", () => {
    const { asked } = toQuestion();
    expect(asked.active).toMatchObject({ expect: "text", prompt: expect.stringContaining("元の図形を削除しますか?") });
    expect(asked.requests).toEqual([]);
  });

  it("Enter, N, no: mirrored copies (the originals stay); one request, with the matrix", () => {
    for (const answer of ["", "n", "N", "no", "いいえ"]) {
      const { session } = toQuestion(["e0", "e1"]);
      const done = session.submitText(answer);
      expect(only(done.requests), answer).toEqual({ type: "copyEntities", ids: ["e0", "e1"], matrices: [axis], label: "2個の図形を鏡像コピー" });
      expect(done.active).toBeNull();
    }
  });

  it("Y, yes, はい: the originals become the mirror images (an in-place transform)", () => {
    for (const answer of ["y", "Y", "yes", "はい"]) {
      const { session } = toQuestion();
      const done = session.submitText(answer);
      expect(only(done.requests), answer).toEqual({ type: "transformEntities", ids: ["e0"], matrix: axis, label: "図形を鏡像化", noun: "鏡像化" });
    }
  });

  it("any other answer keeps asking", () => {
    const { session } = toQuestion();
    const result = session.submitText("maybe");
    expect(result.requests).toEqual([]);
    expect(result.messages[0]).toContain("Y(はい)か N(いいえ)");
    expect(result.active?.expect).toBe("text");
  });

  it("the same two points are refused (no axis); Enter and Esc end without a request", () => {
    const session = start(["e0"]);
    session.submitText("mirror");
    session.submitPoint({ x: 5, y: 5 });
    const same = session.submitPoint({ x: 5, y: 5 });
    expect(same.messages[0]).toContain("鏡像軸が決まりません");
    expect(same.active?.prompt).toContain("2点目");
    const ended = session.submitText("");
    expect(ended.requests).toEqual([]);
    expect(ended.active).toBeNull();

    const cancelled = toQuestion().session.cancel();
    expect(cancelled.requests).toEqual([]);
    expect(cancelled.active).toBeNull();
  });
});

describe("SCALE", () => {
  function toFactor(base = { x: 10, y: 20 }) {
    const session = start(["e0"]);
    session.submitText("scale");
    const asked = session.submitPoint(base);
    return { session, asked, base };
  }

  it("the factor step takes a plain number (no dynamic input) and offers R", () => {
    const { asked } = toFactor();
    expect(asked.active).toMatchObject({ expect: "point", acceptsDistance: true, numberMeaning: "plain", keywords: ["R"], acceptsEnter: true });
  });

  it("a typed factor scales about the base point: one request, label with the factor", () => {
    const { session, base } = toFactor();
    const done = session.submitText("2");
    expect(only(done.requests)).toEqual({ type: "transformEntities", ids: ["e0"], matrix: scaleMatrix(base, 2), label: "図形を拡大縮小(×2)", noun: "拡大縮小" });
    expect(done.active).toBeNull();
    const half = toFactor().session.submitText("0.5");
    expect(only(half.requests)).toMatchObject({ label: "図形を拡大縮小(×0.5)" });
  });

  it("a factor that is 1, not positive, or out of range keeps asking with the reason", () => {
    for (const [text, reason] of [["1", "倍率が1です"], ["0", "0より大きい"], ["-2", "0より大きい"], ["0.0000001", `${MIN_SCALE_FACTOR}`], ["10000000", `${MAX_SCALE_FACTOR}`]] as const) {
      const { session } = toFactor();
      const result = session.submitText(text);
      expect(result.requests, text).toEqual([]);
      expect(result.messages[0], text).toContain(reason);
      expect(result.active?.prompt, text).toContain("倍率");
    }
  });

  it("a click is not a factor (it asks for a number); a coordinate pair is refused too", () => {
    const { session } = toFactor();
    const click = session.submitPoint({ x: 300, y: 300 });
    expect(click.requests).toEqual([]);
    expect(click.messages[0]).toContain("数値で入力");
    const pair = session.submitText("3,4");
    expect(pair.requests).toEqual([]);
  });

  it("R: a typed reference length, then a new length: factor = new / reference", () => {
    const { session, base } = toFactor();
    const reference = session.submitText("r");
    expect(reference.active).toMatchObject({ prompt: expect.stringContaining("参照の長さ"), numberMeaning: "plain", acceptsDistance: true });
    const asked = session.submitText("100");
    expect(asked.active).toMatchObject({ prompt: expect.stringContaining("新しい長さ"), numberMeaning: "length", acceptsDistance: true, basePoint: base });
    const done = session.submitText("250");
    expect(only(done.requests)).toMatchObject({ matrix: scaleMatrix(base, 2.5), label: "図形を拡大縮小(×2.5)" });
  });

  it("R: the reference length by two points, the new length by a click at that distance from the base point", () => {
    const { session, base } = toFactor({ x: 0, y: 0 });
    session.submitText("R");
    session.submitPoint({ x: 100, y: 100 });
    const second = session.submitPoint({ x: 100, y: 200 }); // 参照の長さ 100
    expect(second.active?.prompt).toContain("新しい長さ");
    const done = session.submitPoint({ x: 0, y: 300 }); // 基点から 300
    expect(only(done.requests)).toMatchObject({ matrix: scaleMatrix(base, 3) });
  });

  it("R: a zero reference length or the same two points are refused", () => {
    const { session } = toFactor();
    session.submitText("r");
    expect(session.submitText("0").messages[0]).toContain("0より大きい");
    session.submitPoint({ x: 5, y: 5 });
    const same = session.submitPoint({ x: 5, y: 5 });
    expect(same.messages[0]).toContain("参照の長さが0です");
    expect(same.active?.prompt).toContain("2点目");
  });

  it("R: while choosing the new length, the preview follows the cursor (scale = distance / reference), nothing for an unusable factor", () => {
    const { session, base } = toFactor({ x: 0, y: 0 });
    session.submitText("r");
    session.submitText("50");
    const shapes = session.previewAt({ x: 0, y: 100 }); // 倍率 2
    expect(shapes[0]).toEqual({ kind: "polyline", points: [{ x: 0, y: 0 }, { x: 200, y: 0 }], closed: false });
    expect(shapes.at(-1)).toEqual({ kind: "polyline", points: [base, { x: 0, y: 100 }], closed: false });
    expect(session.previewAt({ x: 0, y: 50 })).toHaveLength(1); // 倍率 1: 形は出さず、案内線だけ
    expect(session.previewAt({ x: 0, y: 0 })).toHaveLength(1); // 倍率 0
  });

  it("Enter ends at every step without a request", () => {
    for (const steps of [[], ["r"], ["r", "100"]]) {
      const { session } = toFactor();
      for (const text of steps) session.submitText(text);
      const ended = session.submitText("");
      expect(ended.requests).toEqual([]);
      expect(ended.active).toBeNull();
    }
  });
});

describe("STRETCH", () => {
  function toBase() {
    const session = start([]);
    session.submitText("stretch");
    session.submitPoint({ x: -10, y: -10 });
    const window = session.submitPoint({ x: 60, y: 60 });
    return { session, window };
  }

  it("the second corner previews the window as a closed rectangle", () => {
    const session = start([]);
    session.submitText("stretch");
    session.submitPoint({ x: 0, y: 0 });
    expect(session.previewAt({ x: 40, y: 30 })).toEqual([
      { kind: "polyline", points: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 30 }, { x: 0, y: 30 }], closed: true },
    ]);
  });

  it("the same corner twice is refused (no window)", () => {
    const session = start([]);
    session.submitText("stretch");
    session.submitPoint({ x: 5, y: 5 });
    const same = session.submitPoint({ x: 5, y: 5 });
    expect(same.messages[0]).toContain("窓の大きさが0です");
    expect(same.active?.prompt).toContain("対角");
  });

  it("a window with nothing editable ends the command and says so; the read-only block contents are counted out", () => {
    const session = start([]);
    session.submitText("stretch");
    session.submitPoint({ x: 500, y: 500 });
    const none = session.submitPoint({ x: 600, y: 600 });
    expect(none.active).toBeNull();
    expect(none.messages[0]).toContain("編集できる図形がありません");
  });

  it("tells how many entities the window touches (read-only ones are left out), then asks for the base point", () => {
    const { window } = toBase();
    // 窓 (-10,-10)〜(60,60): e0(線)・e1(円)・e2(読み取り専用の線)にかかる
    expect(window.active?.prompt).toContain("基点");
    expect(window.messages.join("\n")).toContain("窓にかかる図形: 2個");
    expect(window.messages.join("\n")).toContain("編集できない図形 1 個は除きました");
  });

  it("base point then target point: one request with the window, the candidates and the offset", () => {
    const { session } = toBase();
    session.submitPoint({ x: 0, y: 0 });
    const done = session.submitPoint({ x: 30, y: -5 });
    expect(only(done.requests)).toEqual({
      type: "stretchEntities",
      ids: ["e0", "e1"],
      window: { min: { x: -10, y: -10 }, max: { x: 60, y: 60 } },
      dx: 30,
      dy: -5,
      label: "ストレッチ",
    });
    expect(done.active).toBeNull();
  });

  it("the target step previews the stretched shape (only the vertices inside move)", () => {
    const { session } = toBase();
    session.submitPoint({ x: 0, y: 0 });
    const shapes = session.previewAt({ x: 0, y: 20 }); // 上に 20
    // 線 e0 は、始点 (0,0) だけ窓の中: 始点が (0,20) に動いた線
    expect(shapes).toContainEqual({ kind: "polyline", points: [{ x: 0, y: 20 }, { x: 100, y: 0 }], closed: false });
    // 円 e1 は、中心が窓の中: 図形ごと動く
    expect(shapes).toContainEqual({ kind: "circle", center: { x: 50, y: 70 }, radius: 20 });
  });

  it("the same point as the base is refused; Enter and Esc end without a request", () => {
    const { session } = toBase();
    session.submitPoint({ x: 7, y: 7 });
    const same = session.submitPoint({ x: 7, y: 7 });
    expect(same.messages[0]).toContain("移動量が0です");
    expect(same.requests).toEqual([]);
    const ended = session.cancel();
    expect(ended.requests).toEqual([]);
    // 基点の段階の Enter も、依頼を出さずに終了する
    const atBase = toBase().session.submitText("");
    expect(atBase.requests).toEqual([]);
    expect(atBase.active).toBeNull();
  });
});

describe("the preview limit for STRETCH", () => {
  it("more than 300 candidates: only the moved window frame is previewed", () => {
    const many: CadEntity[] = Array.from({ length: 400 }, (_, i) => ({ ...base, id: `n${i}`, type: "LINE", start: { x: i % 50, y: 0 }, end: { x: 500, y: 5 } }) as CadEntity);
    const preview = createStretchPreview(many, { min: { x: 0, y: -1 }, max: { x: 60, y: 10 } });
    const shapes = preview(10, 20);
    expect(shapes).toHaveLength(1);
    expect(shapes[0]).toEqual({ kind: "polyline", points: [{ x: 10, y: 19 }, { x: 70, y: 19 }, { x: 70, y: 30 }, { x: 10, y: 30 }], closed: true });
  });
});

describe("Codex review fixes (Phase 10)", () => {
  it("R: two reference points too far apart (the distance overflows) are refused and the step stays", () => {
    const session = start(["e0"]);
    session.submitText("scale");
    session.submitPoint({ x: 0, y: 0 });
    session.submitText("r");
    session.submitPoint({ x: -1e308, y: 0 });
    const far = session.submitPoint({ x: 1e308, y: 0 });
    expect(far.messages[0]).toContain("離れすぎて");
    expect(far.active?.prompt).toContain("2点目");
    // 同じ段階で、ふつうの点を指示すれば、先へ進める
    const ok = session.submitPoint({ x: 0, y: 0 }); // 距離 1e308(有限)
    expect(ok.active?.prompt).toContain("新しい長さ");
  });
});

describe("the preview budget by vertices (Codex review)", () => {
  const huge = { ...base, id: "n0", type: "LWPOLYLINE", vertices: Array.from({ length: 30_000 }, (_, i) => ({ x: i, y: i % 7 })), closed: false } as unknown as CadEntity;

  it("one huge polyline: the selection preview is only the bounding box, and so is the stretch preview", () => {
    const selection = createSelectionPreview([huge])([[1, 0, 0, 1, 5, 5]]);
    expect(selection).toHaveLength(1);
    expect(selection[0]).toMatchObject({ kind: "polyline", closed: true });
    const stretch = createStretchPreview([huge], { min: { x: 0, y: 0 }, max: { x: 100, y: 10 } })(5, 5);
    expect(stretch).toHaveLength(1);
    expect(stretch[0]).toMatchObject({ kind: "polyline", closed: true });
  });

  it("a polyline under the budget is still previewed as it is", () => {
    const small = { ...huge, vertices: huge.type === "LWPOLYLINE" ? huge.vertices.slice(0, 100) : [] } as CadEntity;
    const shapes = createSelectionPreview([small])([[1, 0, 0, 1, 5, 5]]);
    expect(shapes).toHaveLength(1);
    expect(shapes[0].kind === "polyline" && shapes[0].points.length).toBe(100);
  });
});
