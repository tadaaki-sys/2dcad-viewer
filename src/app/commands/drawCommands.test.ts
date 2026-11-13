import { describe, expect, it } from "vitest";
import type { CadLine, CadPolyline } from "../../types/cad";
import { createAppCommandSession } from "./builtinCommands";
import { makeContext } from "./testHelpers";
import type { AppRequest } from "./types";

function start(overrides = {}) {
  const context = makeContext(overrides);
  return { session: createAppCommandSession(() => context), context };
}

function addRequest(requests: readonly AppRequest[]) {
  const request = requests.find((r) => r.type === "addEntities");
  if (request === undefined || request.type !== "addEntities") throw new Error("addEntities request not found");
  return request;
}

describe("LINE", () => {
  it("draws connected lines from clicked points; Enter ends and returns one add request", () => {
    const { session } = start();
    const first = session.submitText("line");
    expect(first.active).toMatchObject({ name: "LINE", prompt: "始点を指示してください", keywords: [], acceptsEnter: true });
    session.submitPoint({ x: 0, y: 0 });
    session.submitPoint({ x: 100, y: 0 });
    session.submitPoint({ x: 100, y: 50 });
    const done = session.submitText("");
    const request = addRequest(done.requests);
    expect(request.label).toBe("線を追加(2本)");
    expect(request.entities).toHaveLength(2);
    const [a, b] = request.entities as CadLine[];
    expect(a).toMatchObject({ id: "n0", type: "LINE", layer: "0", color: "#ffffff", start: { x: 0, y: 0 }, end: { x: 100, y: 0 } });
    expect(b).toMatchObject({ id: "n1", start: { x: 100, y: 0 }, end: { x: 100, y: 50 } });
    expect(done.messages).toEqual(["2本の線を追加しました"]);
    expect(done.active).toBeNull();
  });

  it("accepts typed absolute, relative and polar points", () => {
    const { session } = start();
    session.submitText("l");
    session.submitText("1000,500");
    session.submitText("@500,0");
    session.submitText("@100<90");
    const request = addRequest(session.submitText("").requests);
    const lines = request.entities as CadLine[];
    expect(lines[0].end).toEqual({ x: 1500, y: 500 });
    expect(lines[1].start).toEqual({ x: 1500, y: 500 });
    expect(lines[1].end.x).toBeCloseTo(1500, 9);
    expect(lines[1].end.y).toBeCloseTo(600, 9);
  });

  it("a single segment has the plain label", () => {
    const { session } = start();
    session.submitText("line");
    session.submitPoint({ x: 0, y: 0 });
    session.submitPoint({ x: 5, y: 5 });
    expect(addRequest(session.submitText("").requests).label).toBe("線を追加");
  });

  it("Esc ends the command and keeps the lines drawn so far (one Undo step)", () => {
    const { session } = start();
    session.submitText("line");
    session.submitPoint({ x: 0, y: 0 });
    session.submitPoint({ x: 10, y: 0 });
    const result = session.cancel();
    expect(addRequest(result.requests).entities).toHaveLength(1);
    expect(result.active).toBeNull();
  });

  it("Enter or Esc with fewer than two points draws nothing", () => {
    const { session } = start();
    session.submitText("line");
    expect(session.submitText("").requests).toEqual([]);
    session.submitText("line");
    session.submitPoint({ x: 3, y: 3 });
    const result = session.cancel();
    expect(result.requests).toEqual([]);
    expect(result.messages).toEqual(["線は描かれませんでした"]);
  });

  it("U takes back the last point (and the base of relative input); C closes after three points", () => {
    const { session } = start();
    session.submitText("line");
    session.submitPoint({ x: 0, y: 0 });
    expect(session.active?.keywords).toEqual(["U"]);
    session.submitPoint({ x: 100, y: 0 });
    session.submitPoint({ x: 100, y: 100 });
    expect(session.active?.keywords).toEqual(["U", "C"]);
    session.submitText("u"); // (100,100) を取り消す
    expect(session.lastPointValue).toEqual({ x: 100, y: 0 });
    session.submitText("@0,50");
    const closed = session.submitText("c");
    const request = addRequest(closed.requests);
    expect(request.label).toBe("線を追加(3本)");
    const lines = request.entities as CadLine[];
    expect(lines[1].end).toEqual({ x: 100, y: 50 });
    expect(lines[2].start).toEqual({ x: 100, y: 50 }); // 閉じる線: 最後の点 → 始点
    expect(lines[2].end).toEqual({ x: 0, y: 0 });
  });

  it("C is not available with only two points (it is read as a coordinate and refused)", () => {
    const { session } = start();
    session.submitText("line");
    session.submitPoint({ x: 0, y: 0 });
    session.submitPoint({ x: 1, y: 1 });
    const result = session.submitText("c");
    expect(result.requests).toEqual([]);
    expect(result.active?.name).toBe("LINE");
  });

  it("refuses the same point twice in a row and keeps waiting", () => {
    const { session } = start();
    session.submitText("line");
    session.submitPoint({ x: 5, y: 5 });
    const same = session.submitPoint({ x: 5, y: 5 });
    expect(same.messages[0]).toContain("同じ点");
    expect(same.active?.keywords).toEqual(["U"]); // まだ1点
    // 計算の誤差(@10<0 などの1e-15程度)の差も、同じ点として扱う
    const noisy = session.submitPoint({ x: 5 + 1e-12, y: 5 });
    expect(noisy.messages[0]).toContain("同じ点");
  });

  it("shows the drawn part and the rubber band as the preview", () => {
    const { session } = start();
    session.submitText("line");
    expect(session.previewAt({ x: 9, y: 9 })).toEqual([]);
    session.submitPoint({ x: 0, y: 0 });
    session.submitPoint({ x: 10, y: 0 });
    expect(session.previewAt({ x: 10, y: 10 })).toEqual([
      { kind: "polyline", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], closed: false },
    ]);
  });

  it("uses the layer and color of the draw target", () => {
    const { session } = start({ drawTarget: { ok: true, layer: "MACHINE", color: "#00ff00" } });
    session.submitText("line");
    session.submitPoint({ x: 0, y: 0 });
    session.submitPoint({ x: 10, y: 0 });
    const line = addRequest(session.submitText("").requests).entities[0] as CadLine;
    expect(line).toMatchObject({ layer: "MACHINE", color: "#00ff00" });
  });

  it("does not start when no document is open or the layer cannot be drawn on", () => {
    const closed = start({ isDocumentOpen: false });
    expect(closed.session.submitText("line").messages).toEqual(["図面が開かれていません"]);
    const hidden = start({ drawTarget: { ok: false, reason: "現在のレイヤーは非表示です" } });
    const result = hidden.session.submitText("line");
    expect(result.messages).toEqual(["現在のレイヤーは非表示です"]);
    expect(result.active).toBeNull();
    expect(hidden.context.allocated).toEqual([]);
  });

  it("does not allocate ids until the command finishes (cancelling by reset allocates nothing)", () => {
    const { session, context } = start();
    session.submitText("line");
    session.submitPoint({ x: 0, y: 0 });
    session.submitPoint({ x: 1, y: 0 });
    expect(context.allocated).toEqual([]);
    session.reset();
    expect(context.allocated).toEqual([]);
  });
});

describe("PLINE", () => {
  it("draws one open polyline entity from the points", () => {
    const { session } = start();
    session.submitText("pl");
    session.submitPoint({ x: 0, y: 0 });
    session.submitPoint({ x: 100, y: 0 });
    session.submitPoint({ x: 100, y: 100 });
    const done = session.submitText("");
    const request = addRequest(done.requests);
    expect(request.label).toBe("ポリラインを追加");
    expect(request.entities).toHaveLength(1);
    const polyline = request.entities[0] as CadPolyline;
    expect(polyline).toMatchObject({ id: "n0", type: "LWPOLYLINE", closed: false, layer: "0", color: "#ffffff" });
    expect(polyline.vertices).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]);
    expect(done.messages).toEqual(["ポリラインを追加しました(3点)"]);
  });

  it("C closes the polyline (three points or more)", () => {
    const { session } = start();
    session.submitText("pline");
    for (const p of [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]) session.submitPoint(p);
    const polyline = addRequest(session.submitText("c").requests).entities[0] as CadPolyline;
    expect(polyline.closed).toBe(true);
    expect(polyline.vertices).toHaveLength(3);
  });

  it("Esc keeps the polyline; fewer than two points draws nothing", () => {
    const { session } = start();
    session.submitText("pl");
    session.submitPoint({ x: 0, y: 0 });
    session.submitPoint({ x: 10, y: 0 });
    expect(addRequest(session.cancel().requests).entities).toHaveLength(1);
    session.submitText("pl");
    session.submitPoint({ x: 0, y: 0 });
    expect(session.cancel().requests).toEqual([]);
  });

  it("U works, and the same point twice is refused", () => {
    const { session } = start();
    session.submitText("pl");
    session.submitPoint({ x: 0, y: 0 });
    session.submitPoint({ x: 10, y: 0 });
    session.submitPoint({ x: 10, y: 10 });
    session.submitText("u");
    expect(session.submitPoint({ x: 10, y: 0 }).messages[0]).toContain("同じ点");
    const polyline = addRequest(session.submitText("").requests).entities[0] as CadPolyline;
    expect(polyline.vertices).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
  });
});

describe("RECT", () => {
  it("draws a closed four-vertex polyline from two clicked corners", () => {
    const { session } = start();
    const first = session.submitText("rect");
    expect(first.active).toMatchObject({ name: "RECT", expect: "point", acceptsEnter: false, hasPreview: false });
    const second = session.submitPoint({ x: 100, y: 100 });
    expect(second.active).toMatchObject({ prompt: "対角の点を指示してください(例: @500,300)", hasPreview: true });
    const done = session.submitPoint({ x: 600, y: 400 });
    const request = addRequest(done.requests);
    expect(request.label).toBe("長方形を追加");
    const rect = request.entities[0] as CadPolyline;
    expect(rect).toMatchObject({ id: "n0", type: "LWPOLYLINE", closed: true });
    expect(rect.vertices).toEqual([{ x: 100, y: 100 }, { x: 600, y: 100 }, { x: 600, y: 400 }, { x: 100, y: 400 }]);
    expect(done.messages).toEqual(["長方形を追加しました(500.000 × 300.000)"]);
    expect(done.active).toBeNull();
  });

  it("takes the second corner as relative input (@500,300), and works toward any direction", () => {
    const { session } = start();
    session.submitText("rec");
    session.submitText("1000,1000");
    const done = session.submitText("@-500,-300");
    const rect = addRequest(done.requests).entities[0] as CadPolyline;
    expect(rect.vertices).toEqual([{ x: 1000, y: 1000 }, { x: 500, y: 1000 }, { x: 500, y: 700 }, { x: 1000, y: 700 }]);
    expect(done.messages[0]).toContain("500.000 × 300.000");
  });

  it("refuses a zero width or height, and keeps waiting for another corner", () => {
    const { session } = start();
    session.submitText("rect");
    session.submitPoint({ x: 10, y: 10 });
    const flat = session.submitPoint({ x: 50, y: 10 });
    expect(flat.requests).toEqual([]);
    expect(flat.messages[0]).toContain("0の長方形");
    expect(flat.active?.name).toBe("RECT");
    const ok = session.submitPoint({ x: 50, y: 40 });
    expect(addRequest(ok.requests).entities).toHaveLength(1);
  });

  it("previews the rectangle (nothing while degenerate), and Esc draws nothing", () => {
    const { session } = start();
    session.submitText("rect");
    session.submitPoint({ x: 0, y: 0 });
    expect(session.previewAt({ x: 10, y: 0 })).toEqual([]);
    expect(session.previewAt({ x: 10, y: 5 })).toEqual([
      { kind: "polyline", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 0, y: 5 }], closed: true },
    ]);
    const cancelled = session.cancel();
    expect(cancelled.requests).toEqual([]);
    expect(cancelled.messages).toEqual(["RECT を取り消しました"]);
  });

  it("does not start without a document or a drawable layer", () => {
    expect(start({ isDocumentOpen: false }).session.submitText("rect").messages).toEqual(["図面が開かれていません"]);
    const hidden = start({ drawTarget: { ok: false, reason: "非表示" } });
    expect(hidden.session.submitText("rect").messages).toEqual(["非表示"]);
  });
});

describe("a toolbar command replacing a drawing in progress", () => {
  it("keeps what was drawn (the requests of the ended command are not lost)", () => {
    const { session } = start();
    session.submitText("line");
    session.submitPoint({ x: 0, y: 0 });
    session.submitPoint({ x: 5, y: 5 });
    const result = session.run("RECT");
    expect(result.requests.map((r) => r.type)).toEqual(["addEntities"]);
    expect(result.active?.name).toBe("RECT");
  });
});
