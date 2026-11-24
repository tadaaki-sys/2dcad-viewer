// TEXT・MTEXT・TEXTEDIT・TEXTSTYLE のコマンドの進み方(Phase 14)
import { describe, expect, it } from "vitest";
import { dynamicModeOf } from "../../core/commands/dynamicInput";
import { DEFAULT_TEXT_STYLE } from "../../core/text/textStyle";
import type { TextStyle } from "../../core/text/textStyle";
import type { CadText } from "../../types/cad";
import { createAppCommandSession } from "./builtinCommands";
import { makeContext } from "./testHelpers";
import { NO_EDITING } from "./types";
import type { AppCommandContext, AppEditing, AppRequest, PickKind } from "./types";

function start(context: Partial<AppCommandContext> = {}, editing: Partial<AppEditing> = {}) {
  const picks: Array<{ point: { x: number; y: number }; name: string; kind: PickKind | undefined }> = [];
  const state = makeContext({
    editing: {
      ...NO_EDITING,
      ready: true,
      pickEntity: (point, name, kind) => {
        picks.push({ point, name, kind });
        return point.x < 1000 ? { ok: true, id: "t1" } : { ok: false, message: `${name}: クリックした所に図形がありません` };
      },
      textOf: (id) => (id === "t1" ? { text: "old", isMText: false } : null),
      ...editing,
    },
    ...context,
  });
  return { session: createAppCommandSession(() => state), picks };
}

function only(requests: readonly AppRequest[]): AppRequest {
  if (requests.length !== 1) throw new Error(`依頼が1つではありません: ${requests.length}`);
  return requests[0];
}

const addedText = (request: AppRequest): CadText => {
  if (request.type !== "addEntities") throw new Error(`addEntities ではありません: ${request.type}`);
  expect(request.entities).toHaveLength(1);
  return request.entities[0] as CadText;
};

const NOTE: TextStyle = { name: "Note", fontFamily: "MS ゴシック", height: 50, widthFactor: 0.8, italic: true, horizontalAlign: "center", verticalAlign: "middle" };

describe("starting", () => {
  it("DT, MT, ED and ST are the short names", () => {
    expect(start().session.submitText("dt").active).toMatchObject({ name: "TEXT", expect: "point" });
    expect(start().session.submitText("text").active).toMatchObject({ name: "TEXT" });
    expect(start().session.submitText("mt").active).toMatchObject({ name: "MTEXT", expect: "point" });
    expect(start().session.submitText("ed").active).toMatchObject({ name: "TEXTEDIT", expect: "point", rawPoints: true });
    expect(start().session.submitText("st").requests).toEqual([{ type: "openTextStyles" }]);
    expect(start().session.submitText("textstyle").requests).toEqual([{ type: "openTextStyles" }]);
  });

  it("without a document, while loading, or without a layer to draw on, nothing starts (TEXTSTYLE needs no document)", () => {
    const closed = start({ isDocumentOpen: false }).session;
    for (const name of ["text", "mtext", "textedit"]) expect(closed.submitText(name).messages[0]).toContain("図面が開かれていません");
    expect(closed.submitText("textstyle").requests).toEqual([{ type: "openTextStyles" }]);
    expect(start({}, { ready: false }).session.submitText("text").messages[0]).toContain("準備中");
    expect(start({}, { ready: false }).session.submitText("textedit").messages[0]).toContain("準備中");
    const blocked = start({ drawTarget: { ok: false, reason: "このレイヤーには描けません" } }).session;
    expect(blocked.submitText("text").messages[0]).toContain("このレイヤーには描けません");
    expect(blocked.submitText("mtext").messages[0]).toContain("このレイヤーには描けません");
  });
});

describe("TEXT", () => {
  it("insertion point → rotation (Enter = 0) → the text in the input panel → ONE addEntities request with the current style's values", () => {
    const { session } = start({ textStyle: NOTE, drawTarget: { ok: true, layer: "NOTE", color: "#ffff00" } });
    const first = session.submitText("text");
    expect(first.active?.prompt).toContain("Note");
    expect(first.active?.prompt).toContain("50");
    const rotation = session.submitPoint({ x: 100, y: 200 });
    expect(rotation.active).toMatchObject({ expect: "point", acceptsEnter: true, acceptsDistance: true, numberMeaning: "angle", basePoint: { x: 100, y: 200 } });
    expect(dynamicModeOf(rotation.active)).not.toBeNull();
    const panel = session.submitText("");
    expect(panel.active).toMatchObject({ expect: "text", textEditor: { multiline: false, initial: "" } });
    expect(panel.requests).toEqual([]);

    const done = session.submitText("検査 A");
    expect(done.active).toBeNull();
    const text = addedText(only(done.requests));
    expect(text).toMatchObject({
      id: "n0",
      type: "TEXT",
      layer: "NOTE",
      color: "#ffff00",
      position: { x: 100, y: 200 },
      text: "検査 A",
      height: 50,
      widthFactor: 0.8,
      rotation: 0,
      horizontalAlign: "center",
      verticalAlign: "middle",
      fontFamily: "MS ゴシック",
      italic: true,
      styleName: "Note",
    });
    expect("boxWidth" in text).toBe(false);
    expect(only(done.requests)).toMatchObject({ label: "文字を追加" });
  });

  it("a style with width factor 1 leaves the width factor out (the same as an imported text); other values are kept", () => {
    const { session } = start();
    session.submitText("text");
    session.submitPoint({ x: 0, y: 0 });
    session.submitText("");
    const text = addedText(only(session.submitText("A").requests));
    expect("widthFactor" in text).toBe(false);
    expect(text).toMatchObject({ fontFamily: "sans-serif", italic: false, styleName: "Standard", verticalAlign: "baseline", horizontalAlign: "left" });
  });

  it("a number is the rotation in degrees (counter-clockwise); a click gives the direction; the same point is refused", () => {
    const { session } = start();
    session.submitText("text");
    session.submitPoint({ x: 10, y: 10 });
    session.submitText("90");
    expect(addedText(only(session.submitText("A").requests)).rotation).toBeCloseTo(Math.PI / 2);

    session.submitText("text");
    session.submitPoint({ x: 10, y: 10 });
    session.submitPoint({ x: 20, y: 20 });
    expect(addedText(only(session.submitText("B").requests)).rotation).toBeCloseTo(Math.PI / 4);

    session.submitText("text");
    session.submitPoint({ x: 10, y: 10 });
    const same = session.submitPoint({ x: 10, y: 10 });
    expect(same.messages[0]).toContain("挿入点と同じ点");
    expect(same.active?.expect).toBe("point");

    // 負の角度・360を超える角度も、0〜2πにそろえる
    session.cancel();
    session.submitText("text");
    session.submitPoint({ x: 0, y: 0 });
    session.submitText("-90");
    expect(addedText(only(session.submitText("C").requests)).rotation).toBeCloseTo((3 * Math.PI) / 2);
  });

  it("the preview of the rotation step is the direction line", () => {
    const { session } = start();
    session.submitText("text");
    session.submitPoint({ x: 10, y: 10 });
    expect(session.previewAt({ x: 30, y: 10 })).toEqual([{ kind: "polyline", points: [{ x: 10, y: 10 }, { x: 30, y: 10 }], closed: false }]);
    expect(session.previewAt({ x: 10, y: 10 })).toEqual([]);
  });

  it("empty or blank text is refused with a reason and the panel stays; Esc cancels without a request", () => {
    const { session } = start();
    session.submitText("text");
    session.submitPoint({ x: 0, y: 0 });
    session.submitText("");
    const empty = session.submitText("   ");
    expect(empty.messages[0]).toContain("空です");
    expect(empty.requests).toEqual([]);
    expect(empty.active?.textEditor).not.toBeNull();
    const cancelled = session.cancel();
    expect(cancelled.requests).toEqual([]);
    expect(cancelled.active).toBeNull();
  });

  it("a huge angle (1e308 degrees) is folded into 0..360 before it is multiplied: the text gets a finite rotation", () => {
    const { session } = start();
    session.submitText("text");
    session.submitPoint({ x: 0, y: 0 });
    session.submitText("1" + "0".repeat(308));
    const rotation = addedText(only(session.submitText("A").requests)).rotation;
    expect(Number.isFinite(rotation)).toBe(true);
    expect(rotation).toBeGreaterThanOrEqual(0);
    expect(rotation).toBeLessThan(Math.PI * 2);
  });

  it("a refused text stays in the panel (as its first text), so it can be corrected: nothing the user typed is lost", () => {
    const { session } = start();
    session.submitText("text");
    session.submitPoint({ x: 0, y: 0 });
    session.submitText("");
    const refused = session.submitText("\u200b");
    expect(refused.messages[0]).toContain("空です");
    expect(refused.active?.textEditor).toEqual({ multiline: false, initial: "\u200b" });
    const tooLong = session.submitText("x".repeat(100_001));
    expect(tooLong.messages[0]).toContain("長すぎます");
    expect(tooLong.active?.textEditor?.initial).toHaveLength(100_001);
    // 直して確定できる
    expect(addedText(only(session.submitText("ok").requests)).text).toBe("ok");
  });

  it("line breaks in a one-line text become spaces", () => {
    const { session } = start();
    session.submitText("text");
    session.submitPoint({ x: 0, y: 0 });
    session.submitText("");
    expect(addedText(only(session.submitText("a\nb").requests)).text).toBe("a b");
  });

  it("the style at the start is used, even if the current style changes while the command runs", () => {
    let style: TextStyle = DEFAULT_TEXT_STYLE;
    const state = makeContext({ editing: { ...NO_EDITING, ready: true } });
    const session = createAppCommandSession(() => ({ ...state, textStyle: style }));
    session.submitText("text");
    style = NOTE;
    session.submitPoint({ x: 0, y: 0 });
    session.submitText("");
    expect(addedText(only(session.submitText("A").requests))).toMatchObject({ height: DEFAULT_TEXT_STYLE.height, styleName: DEFAULT_TEXT_STYLE.name });
  });

  it("Enter at the insertion point ends without a text", () => {
    const { session } = start();
    session.submitText("text");
    const ended = session.submitText("");
    expect(ended.requests).toEqual([]);
    expect(ended.active).toBeNull();
    expect(ended.messages.join("\n")).toContain("TEXT を終了しました");
  });
});

describe("MTEXT", () => {
  it("two corners → the text (multiline panel) → ONE request: a boxed MTEXT, anchored to the top of the box, with the style's horizontal alignment", () => {
    const { session } = start({ textStyle: { ...NOTE, horizontalAlign: "left" } });
    session.submitText("mtext");
    session.submitPoint({ x: 300, y: 100 });
    // 反対の角が左下でも、枠は、左上を基準にする
    const panel = session.submitPoint({ x: 100, y: 40 });
    expect(panel.active).toMatchObject({ expect: "text", textEditor: { multiline: true, initial: "" }, prompt: expect.stringContaining("Ctrl+Enter") });
    const text = addedText(only(session.submitText("line one\nline two").requests));
    expect(text).toMatchObject({ type: "TEXT", text: "line one\nline two", boxWidth: 200, isMText: true, position: { x: 100, y: 100 }, rotation: 0, horizontalAlign: "left", verticalAlign: "top", height: 50, styleName: "Note" });
  });

  it("the anchor follows the horizontal alignment: left edge, centre, right edge of the box", () => {
    for (const [align, x] of [["left", 100], ["center", 200], ["right", 300]] as const) {
      const { session } = start({ textStyle: { ...NOTE, horizontalAlign: align } });
      session.submitText("mtext");
      session.submitPoint({ x: 100, y: 0 });
      session.submitPoint({ x: 300, y: 80 });
      const text = addedText(only(session.submitText("A").requests));
      expect(text.position).toEqual({ x, y: 80 });
      expect(text.boxWidth).toBe(200);
    }
  });

  it("a box of width 0 is refused (the second corner is asked again); the preview is the rectangle", () => {
    const { session } = start();
    session.submitText("mtext");
    session.submitPoint({ x: 100, y: 100 });
    expect(session.previewAt({ x: 200, y: 50 })).toEqual([{ kind: "polyline", points: [{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 200, y: 50 }, { x: 100, y: 50 }], closed: true }]);
    const flat = session.submitPoint({ x: 100, y: 50 });
    expect(flat.messages[0]).toContain("枠の幅が 0");
    expect(flat.active?.expect).toBe("point");
    expect(flat.requests).toEqual([]);
  });

  it("empty text is refused; Esc cancels; Enter at the first corner ends", () => {
    const { session } = start();
    session.submitText("mtext");
    session.submitPoint({ x: 0, y: 0 });
    session.submitPoint({ x: 100, y: 50 });
    expect(session.submitText("  \n ").messages[0]).toContain("空です");
    expect(session.cancel().requests).toEqual([]);
    session.submitText("mtext");
    expect(session.submitText("").messages.join("\n")).toContain("MTEXT を終了しました");
  });
});

describe("TEXTEDIT", () => {
  it("click a text (not snapped; kind text) → the panel with the current content → one editText request", () => {
    const { session, picks } = start();
    expect(session.submitText("textedit").active?.prompt).toContain("クリック");
    const panel = session.submitPoint({ x: 50, y: 50 });
    expect(picks).toEqual([{ point: { x: 50, y: 50 }, name: "文字編集", kind: "text" }]);
    expect(panel.active).toMatchObject({ expect: "text", textEditor: { multiline: false, initial: "old" } });
    const done = session.submitText("new");
    expect(only(done.requests)).toEqual({ type: "editText", id: "t1", text: "new" });
    expect(done.active).toBeNull();
  });

  it("a multiline text (or one with line breaks) gets the multiline panel", () => {
    const { session } = start({}, { textOf: () => ({ text: "a\nb", isMText: false }) });
    session.submitText("ed");
    expect(session.submitPoint({ x: 1, y: 1 }).active?.textEditor).toEqual({ multiline: true, initial: "a\nb" });
    const mtext = start({}, { textOf: () => ({ text: "boxed", isMText: true }) });
    mtext.session.submitText("ed");
    expect(mtext.session.submitPoint({ x: 1, y: 1 }).active?.textEditor).toEqual({ multiline: true, initial: "boxed" });
  });

  it("clicking nothing keeps asking with the reason; empty text keeps the panel; Esc cancels; Enter ends", () => {
    const { session } = start();
    session.submitText("ed");
    const none = session.submitPoint({ x: 5000, y: 0 });
    expect(none.messages[0]).toContain("図形がありません");
    expect(none.active?.rawPoints).toBe(true);
    session.submitPoint({ x: 1, y: 1 });
    expect(session.submitText("").messages[0]).toContain("空です");
    expect(session.cancel().requests).toEqual([]);
    session.submitText("ed");
    expect(session.submitText("").messages.join("\n")).toContain("TEXTEDIT を終了しました");
  });

  it("a figure that disappeared between the click and the panel is reported", () => {
    const { session } = start({}, { textOf: () => null });
    session.submitText("ed");
    const gone = session.submitPoint({ x: 1, y: 1 });
    expect(gone.messages[0]).toContain("見つかりません");
    expect(gone.active?.expect).toBe("point");
  });
});
