// OFFSET・BREAK のコマンドの進み方(Phase 12)
import { describe, expect, it } from "vitest";
import { dynamicModeOf } from "../../core/commands/dynamicInput";
import { createAppCommandSession } from "./builtinCommands";
import { makeContext } from "./testHelpers";
import { NO_EDITING } from "./types";
import type { AppEditing, AppRequest } from "./types";

/** 点をクリックすると、図形 "e0" を指したことになる(x が 1000 未満のとき)。それ以外は、図形が無い */
function start(overrides: Partial<AppEditing> = {}) {
  const picks: Array<{ point: { x: number; y: number }; name: string }> = [];
  const editing: AppEditing = {
    ...NO_EDITING,
    ready: true,
    pickEntity: (point, name) => {
      picks.push({ point, name });
      return point.x < 1000 ? { ok: true, id: "e0" } : { ok: false, message: `${name}: クリックした所に図形がありません` };
    },
    createOffsetPreview: () => (distance, cursor) => [{ kind: "polyline", points: [{ x: distance ?? -1, y: 0 }, cursor], closed: false }],
    createBreakPreview: (_id, first) => (cursor) => [{ kind: "polyline", points: [first, cursor], closed: false }],
    ...overrides,
  };
  return { session: createAppCommandSession(() => makeContext({ editing })), picks };
}

function only(requests: readonly AppRequest[]): AppRequest {
  if (requests.length !== 1) throw new Error(`依頼が1つではありません: ${requests.length}`);
  return requests[0];
}

describe("starting", () => {
  it("O and BR are the short names", () => {
    expect(start().session.submitText("o").active).toMatchObject({ name: "OFFSET", expect: "distance", keywords: ["T"] });
    expect(start().session.submitText("offset").active).toMatchObject({ name: "OFFSET" });
    expect(start().session.submitText("br").active).toMatchObject({ name: "BREAK", expect: "point", rawPoints: true });
  });

  it("without a document, or while the drawing is loading, nothing starts", () => {
    const closed = createAppCommandSession(() => makeContext({ isDocumentOpen: false }));
    expect(closed.submitText("offset").messages[0]).toContain("図面が開かれていません");
    expect(closed.submitText("break").messages[0]).toContain("図面が開かれていません");
    expect(start({ ready: false }).session.submitText("o").messages[0]).toContain("準備中");
    expect(start({ ready: false }).session.submitText("br").messages[0]).toContain("準備中");
  });
});

describe("OFFSET", () => {
  it("distance → click the figure (not snapped) → click the side → one request; then back to picking a figure (repeat)", () => {
    const { session, picks } = start();
    session.submitText("offset");
    const picking = session.submitText("10");
    expect(picking.active).toMatchObject({ expect: "point", rawPoints: true, acceptsEnter: true, prompt: expect.stringContaining("写す図形をクリック") });
    expect(dynamicModeOf(picking.active)).toBeNull(); // 図形を指すクリックには、ダイナミック入力を出さない

    const side = session.submitPoint({ x: 50, y: 1 });
    expect(picks).toEqual([{ point: { x: 50, y: 1 }, name: "オフセット" }]);
    expect(side.active).toMatchObject({ expect: "point", rawPoints: true, prompt: expect.stringContaining("写す側") });
    expect(side.requests).toEqual([]);

    const done = session.submitPoint({ x: 50, y: 30 });
    expect(only(done.requests)).toEqual({ type: "offsetEntity", id: "e0", distance: 10, point: { x: 50, y: 30 } });
    // 続けて、次の図形を指せる
    expect(done.active).toMatchObject({ name: "OFFSET", prompt: expect.stringContaining("写す図形をクリック") });
    const again = session.submitPoint({ x: 50, y: 1 });
    expect(again.active?.prompt).toContain("写す側");
    expect(session.submitText("").active).toBeNull();
  });

  it("the preview follows the cursor with the distance; Enter ends without a request", () => {
    const { session } = start();
    session.submitText("offset");
    session.submitText("12.5");
    session.submitPoint({ x: 5, y: 5 });
    expect(session.previewAt({ x: 7, y: 8 })).toEqual([{ kind: "polyline", points: [{ x: 12.5, y: 0 }, { x: 7, y: 8 }], closed: false }]);
    const ended = session.submitText("");
    expect(ended.requests).toEqual([]);
    expect(ended.active).toBeNull();
    expect(ended.messages.join("\n")).toContain("OFFSET を終了しました");
  });

  it("T (through a point): the next click is the through point, which may be snapped; the request has distance null", () => {
    const { session } = start();
    session.submitText("offset");
    session.submitText("t");
    session.submitPoint({ x: 50, y: 1 });
    expect(session.active).toMatchObject({ prompt: expect.stringContaining("通過点"), rawPoints: false });
    // 通過点の段階の仮表示は、距離 null(通過点)で作る
    expect(session.previewAt({ x: 1, y: 2 })).toEqual([{ kind: "polyline", points: [{ x: -1, y: 0 }, { x: 1, y: 2 }], closed: false }]);
    const done = session.submitPoint({ x: 80, y: 40 });
    expect(only(done.requests)).toEqual({ type: "offsetEntity", id: "e0", distance: null, point: { x: 80, y: 40 } });
  });

  it("a bad distance is refused and asked again (0, negative); Enter at the distance ends", () => {
    for (const text of ["0", "-5"]) {
      const { session } = start();
      session.submitText("offset");
      const result = session.submitText(text);
      expect(result.active, text).toMatchObject({ expect: "distance" });
      expect(result.messages.join("\n"), text).toContain("0 より大きい数");
    }
    const { session } = start();
    session.submitText("offset");
    const ended = session.submitText("");
    expect(ended.active).toBeNull();
    expect(ended.messages.join("\n")).toContain("OFFSET を終了しました");
  });

  it("clicking where there is no figure shows the reason and keeps waiting for a figure", () => {
    const { session } = start();
    session.submitText("offset");
    session.submitText("10");
    const result = session.submitPoint({ x: 5000, y: 0 });
    expect(result.messages.join("\n")).toContain("クリックした所に図形がありません");
    expect(result.active?.prompt).toContain("写す図形をクリック");
    expect(result.requests).toEqual([]);
  });

  it("Esc cancels with no request", () => {
    const { session } = start();
    session.submitText("offset");
    session.submitText("10");
    session.submitPoint({ x: 5, y: 1 });
    const cancelled = session.cancel();
    expect(cancelled.requests).toEqual([]);
    expect(cancelled.active).toBeNull();
  });
});

describe("BREAK", () => {
  it("click the figure (the click is the first point) → second point → one request", () => {
    const { session, picks } = start();
    session.submitText("break");
    const second = session.submitPoint({ x: 30, y: 1 });
    expect(picks).toEqual([{ point: { x: 30, y: 1 }, name: "切断" }]);
    expect(second.messages.join("\n")).toContain("クリックした位置を、第1点にしました");
    expect(second.active).toMatchObject({ keywords: ["F"], basePoint: { x: 30, y: 1 }, prompt: expect.stringContaining("第2点") });
    const done = session.submitPoint({ x: 60, y: 0 });
    expect(only(done.requests)).toEqual({ type: "breakEntity", id: "e0", first: { x: 30, y: 1 }, second: { x: 60, y: 0 } });
    expect(done.active).toBeNull();
  });

  it("F re-specifies the first point (a snapped point is allowed); the second point then ends it", () => {
    const { session } = start();
    session.submitText("break");
    session.submitPoint({ x: 30, y: 1 });
    const again = session.submitText("f");
    expect(again.active).toMatchObject({ prompt: expect.stringContaining("第1点を指示"), rawPoints: false });
    const second = session.submitPoint({ x: 25, y: 0 });
    expect(second.active).toMatchObject({ basePoint: { x: 25, y: 0 } });
    const done = session.submitPoint({ x: 75, y: 0 });
    expect(only(done.requests)).toEqual({ type: "breakEntity", id: "e0", first: { x: 25, y: 0 }, second: { x: 75, y: 0 } });
  });

  it("the preview follows the cursor from the first point; the same point as the first is a request too (split at a point)", () => {
    const { session } = start();
    session.submitText("break");
    session.submitPoint({ x: 30, y: 1 });
    expect(session.previewAt({ x: 40, y: 3 })).toEqual([{ kind: "polyline", points: [{ x: 30, y: 1 }, { x: 40, y: 3 }], closed: false }]);
    const done = session.submitPoint({ x: 30, y: 1 });
    expect(only(done.requests)).toMatchObject({ type: "breakEntity", first: { x: 30, y: 1 }, second: { x: 30, y: 1 } });
  });

  it("clicking where there is no figure keeps waiting; Enter and Esc end with no request", () => {
    const { session } = start();
    session.submitText("break");
    const miss = session.submitPoint({ x: 5000, y: 0 });
    expect(miss.messages.join("\n")).toContain("クリックした所に図形がありません");
    expect(miss.active?.prompt).toContain("切断する図形をクリック");
    expect(session.submitText("").active).toBeNull();

    session.submitText("break");
    session.submitPoint({ x: 30, y: 1 });
    const enter = session.submitText("");
    expect(enter.requests).toEqual([]);
    expect(enter.active).toBeNull();
    session.submitText("break");
    session.submitPoint({ x: 30, y: 1 });
    expect(session.cancel().requests).toEqual([]);
  });
});
