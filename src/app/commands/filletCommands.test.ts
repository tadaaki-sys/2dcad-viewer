// FILLET・CHAMFER のコマンドの進み方(Phase 13)
import { describe, expect, it } from "vitest";
import { CommandRegistry, CommandSession } from "../../core/commands";
import { dynamicModeOf } from "../../core/commands/dynamicInput";
import { createAppCommandSession } from "./builtinCommands";
import { createFilletCommands } from "./filletCommands";
import { makeContext } from "./testHelpers";
import { NO_EDITING } from "./types";
import type { AppCommandContext, AppEditing, AppRequest, PickKind } from "./types";

/**
 * 点をクリックすると、y が 0 以下なら図形 "e0"、y が正なら "e1" を指したことになる(x が 1000 未満のとき)。それ以外は、図形が無い。
 * 定義(前回の値を持つ)は、この関数を呼ぶたびに作り直す(同じ session の中では、前回の値が続く)。
 */
function start(overrides: Partial<AppEditing> = {}, context: Partial<AppCommandContext> = {}) {
  const picks: Array<{ point: { x: number; y: number }; name: string; kind: PickKind | undefined }> = [];
  const editing: AppEditing = {
    ...NO_EDITING,
    ready: true,
    pickEntity: (point, name, kind) => {
      picks.push({ point, name, kind });
      return point.x < 1000 ? { ok: true, id: point.y > 0 ? "e1" : "e0" } : { ok: false, message: `${name}: クリックした所に図形がありません` };
    },
    ...overrides,
  };
  const registry = new CommandRegistry<AppRequest, AppCommandContext>();
  for (const definition of createFilletCommands()) registry.register(definition);
  return { session: new CommandSession(registry, () => makeContext({ editing, ...context })), picks };
}

function only(requests: readonly AppRequest[]): AppRequest {
  if (requests.length !== 1) throw new Error(`依頼が1つではありません: ${requests.length}`);
  return requests[0];
}

describe("starting", () => {
  it("FIL and CHA are the short names (F is the view command FIT and is not used)", () => {
    expect(start().session.submitText("fil").active).toMatchObject({ name: "FILLET", expect: "distance", acceptsEnter: true, prompt: expect.stringContaining("半径") });
    expect(start().session.submitText("fillet").active).toMatchObject({ name: "FILLET" });
    expect(start().session.submitText("cha").active).toMatchObject({ name: "CHAMFER", expect: "distance", acceptsEnter: true, prompt: expect.stringContaining("1つ目の距離") });
    expect(start().session.submitText("chamfer").active).toMatchObject({ name: "CHAMFER" });
  });

  it("the built-in registry has both commands (and F is still the view command)", () => {
    const session = createAppCommandSession(() => makeContext({ editing: { ...NO_EDITING, ready: true } }));
    expect(session.submitText("fil").active).toMatchObject({ name: "FILLET" });
    session.cancel();
    expect(session.submitText("cha").active).toMatchObject({ name: "CHAMFER" });
    session.cancel();
    expect(session.submitText("f").requests).toEqual([{ type: "fitDrawing" }]);
  });

  it("without a document, or while the drawing is loading, nothing starts", () => {
    const closed = start({}, { isDocumentOpen: false }).session;
    expect(closed.submitText("fillet").messages[0]).toContain("図面が開かれていません");
    expect(closed.submitText("chamfer").messages[0]).toContain("図面が開かれていません");
    expect(start({ ready: false }).session.submitText("fillet").messages[0]).toContain("準備中");
    expect(start({ ready: false }).session.submitText("chamfer").messages[0]).toContain("準備中");
  });
});

describe("FILLET", () => {
  it("radius → first line → second line → one request; then back to the first line (repeat)", () => {
    const { session, picks } = start();
    session.submitText("fillet");
    const picking = session.submitText("10");
    expect(picking.active).toMatchObject({ expect: "point", rawPoints: true, acceptsEnter: true, prompt: expect.stringContaining("1つ目の線") });
    expect(dynamicModeOf(picking.active)).toBeNull(); // 図形を指すクリックには、ダイナミック入力を出さない

    const second = session.submitPoint({ x: 50, y: -1 });
    expect(second.active).toMatchObject({ rawPoints: true, prompt: expect.stringContaining("2つ目の線") });
    expect(second.requests).toEqual([]);

    const done = session.submitPoint({ x: 3, y: 60 });
    expect(only(done.requests)).toEqual({ type: "filletEntities", first: { id: "e0", point: { x: 50, y: -1 } }, second: { id: "e1", point: { x: 3, y: 60 } }, radius: 10 });
    // 図形を探すときは、操作の名前と、線・折れ線だけを対象にすること(kind = chain)を伝える
    expect(picks).toEqual([
      { point: { x: 50, y: -1 }, name: "フィレット", kind: "chain" },
      { point: { x: 3, y: 60 }, name: "フィレット", kind: "chain" },
    ]);
    // 続けて、次の角を処理できる(半径は、そのまま)
    expect(done.active).toMatchObject({ name: "FILLET", prompt: expect.stringContaining("1つ目の線") });
    session.submitPoint({ x: 70, y: -2 });
    const again = session.submitPoint({ x: 4, y: 80 });
    expect(only(again.requests)).toMatchObject({ type: "filletEntities", radius: 10 });
  });

  it("Enter at the radius uses the previous value (0 at first); Enter at a pick ends without a request", () => {
    const { session } = start();
    expect(session.submitText("fillet").active?.prompt).toContain("前回の値: 0");
    session.submitText(""); // 前回の値 0 を使う
    session.submitPoint({ x: 50, y: -1 });
    expect(only(session.submitPoint({ x: 3, y: 60 }).requests)).toMatchObject({ type: "filletEntities", radius: 0 });
    const ended = session.submitText("");
    expect(ended.requests).toEqual([]);
    expect(ended.active).toBeNull();
    expect(ended.messages.join("\n")).toContain("FILLET を終了しました");

    // 次に始めたとき、前回の値が出る。Enter で、その値を使う
    session.submitText("fillet");
    session.submitText("12.5");
    session.submitText("");
    expect(session.submitText("fillet").active?.prompt).toContain("前回の値: 12.5");
    session.submitText("");
    session.submitPoint({ x: 50, y: -1 });
    expect(only(session.submitPoint({ x: 3, y: 60 }).requests)).toMatchObject({ radius: 12.5 });
  });

  it("a negative radius is refused with a message (the command keeps waiting); 0 is accepted", () => {
    const { session } = start();
    session.submitText("fillet");
    const bad = session.submitText("-5");
    expect(bad.messages[0]).toContain("0 以上");
    expect(bad.active).toMatchObject({ name: "FILLET", expect: "distance" });
    const text = session.submitText("abc");
    expect(text.active).toMatchObject({ expect: "distance" });
    expect(session.submitText("0").active).toMatchObject({ expect: "point" });
  });

  it("clicking where there is no figure keeps the same step with the reason; no request is made", () => {
    const { session } = start();
    session.submitText("fillet");
    session.submitText("5");
    const none = session.submitPoint({ x: 5000, y: 0 });
    expect(none.messages[0]).toContain("図形がありません");
    expect(none.requests).toEqual([]);
    expect(none.active?.prompt).toContain("1つ目の線");
    session.submitPoint({ x: 50, y: -1 });
    const second = session.submitPoint({ x: 5000, y: 0 });
    expect(second.messages[0]).toContain("図形がありません");
    expect(second.active?.prompt).toContain("2つ目の線");
    expect(second.requests).toEqual([]);
  });

  it("Esc cancels without a request", () => {
    const { session } = start();
    session.submitText("fillet");
    session.submitText("5");
    session.submitPoint({ x: 50, y: -1 });
    const cancelled = session.cancel();
    expect(cancelled.requests).toEqual([]);
    expect(cancelled.active).toBeNull();
  });
});

describe("CHAMFER", () => {
  it("distance 1 → distance 2 → first line → second line → one request; then back to the first line", () => {
    const { session, picks } = start();
    session.submitText("chamfer");
    expect(session.submitText("10").active?.prompt).toContain("2つ目の距離");
    expect(session.submitText("20").active).toMatchObject({ expect: "point", rawPoints: true, prompt: expect.stringContaining("1つ目の線") });
    session.submitPoint({ x: 50, y: -1 });
    const done = session.submitPoint({ x: 3, y: 60 });
    expect(only(done.requests)).toEqual({ type: "chamferEntities", first: { id: "e0", point: { x: 50, y: -1 } }, second: { id: "e1", point: { x: 3, y: 60 } }, distance1: 10, distance2: 20 });
    expect(picks.map((p) => [p.name, p.kind])).toEqual([["面取り", "chain"], ["面取り", "chain"]]);
    expect(done.active?.prompt).toContain("1つ目の線");
  });

  it("Enter uses each previous value; the prompts show them", () => {
    const { session } = start();
    session.submitText("chamfer");
    session.submitText("10");
    session.submitText("20");
    session.cancel();
    const prompt = session.submitText("chamfer").active?.prompt;
    expect(prompt).toContain("前回の値: 10");
    expect(session.submitText("").active?.prompt).toContain("前回の値: 20");
    session.submitText("");
    session.submitPoint({ x: 50, y: -1 });
    expect(only(session.submitPoint({ x: 3, y: 60 }).requests)).toMatchObject({ distance1: 10, distance2: 20 });
  });

  it("only one of the two distances being 0 is refused, and the first distance can be entered again; 0 and 0 is accepted", () => {
    const { session } = start();
    session.submitText("chamfer");
    session.submitText("0");
    const bad = session.submitText("5");
    expect(bad.messages[0]).toContain("片方だけ 0");
    expect(bad.messages[0]).toContain("1つ目の距離から入力し直してください");
    expect(bad.active?.prompt).toContain("1つ目の距離"); // 1つ目の値も直せる(最初からやり直さなくてよい)
    expect(session.submitText("5").active?.prompt).toContain("2つ目の距離");
    expect(session.submitText("0").messages[0]).toContain("片方だけ 0");
    session.submitText("0");
    const good = session.submitText("0");
    expect(good.active).toMatchObject({ expect: "point" });
    session.submitPoint({ x: 50, y: -1 });
    expect(only(session.submitPoint({ x: 3, y: 60 }).requests)).toMatchObject({ distance1: 0, distance2: 0 });
  });

  it("a negative distance is refused", () => {
    const { session } = start();
    session.submitText("chamfer");
    expect(session.submitText("-1").messages[0]).toContain("0 以上");
    session.submitText("3");
    expect(session.submitText("-2").messages[0]).toContain("0 以上");
  });
});
