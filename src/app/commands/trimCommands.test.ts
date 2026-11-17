// TRIM・EXTEND のコマンドの進み方(Phase 11)
import { describe, expect, it } from "vitest";
import { dynamicModeOf } from "../../core/commands/dynamicInput";
import { createAppCommandSession } from "./builtinCommands";
import { makeContext } from "./testHelpers";
import { NO_EDITING } from "./types";
import type { AppEditing, AppRequest } from "./types";

function start(overrides: Partial<AppEditing> = {}) {
  const editing: AppEditing = { ...NO_EDITING, ready: true, ...overrides };
  return createAppCommandSession(() => makeContext({ editing }));
}

function only(requests: readonly AppRequest[]): AppRequest {
  if (requests.length !== 1) throw new Error(`依頼が1つではありません: ${requests.length}`);
  return requests[0];
}

describe("starting", () => {
  it("TR and EX are the short names; both ask for the boundary first (a selection step)", () => {
    for (const [name, prompt] of [["tr", "切り取り境界"], ["ex", "延長先の境界"], ["trim", "切り取り境界"], ["extend", "延長先の境界"]] as const) {
      const result = start().submitText(name);
      expect(result.active, name).toMatchObject({ expect: "selection", prompt: expect.stringContaining(prompt) });
      expect(result.active?.prompt, name).toContain("何も選ばずに Enter = すべての図形");
    }
  });

  it("without a document, or while the drawing is loading, nothing starts", () => {
    const closed = createAppCommandSession(() => makeContext({ isDocumentOpen: false }));
    expect(closed.submitText("trim").messages[0]).toContain("図面が開かれていません");
    expect(start({ ready: false }).submitText("extend").messages[0]).toContain("準備中");
  });
});

describe("TRIM", () => {
  it("Enter with nothing selected: every entity is a boundary (edgeIds = null); then it waits for clicks that are not snapped", () => {
    const session = start();
    session.submitText("trim");
    const result = session.submitSelection([]);
    expect(result.messages.join("\n")).toContain("すべての図形を境界にします");
    expect(result.active).toMatchObject({ expect: "point", rawPoints: true, acceptsEnter: true, prompt: expect.stringContaining("切り取る部分をクリック") });
    // 座標を入力する段階ではないので、ダイナミック入力は出さない
    expect(dynamicModeOf(result.active)).toBeNull();
  });

  it("a selection is the set of boundaries (the ids are passed on)", () => {
    const session = start();
    session.submitText("trim");
    const result = session.submitSelection(["e1", "e2"]);
    expect(result.messages.join("\n")).toContain("境界の図形: 2個");
    const click = session.submitPoint({ x: 50, y: 0 });
    expect(only(click.requests)).toEqual({ type: "trimAt", mode: "trim", point: { x: 50, y: 0 }, edgeIds: ["e1", "e2"] });
  });

  it("every click sends one request and the command stays active (repeat until Enter)", () => {
    const session = start();
    session.submitText("trim");
    session.submitSelection([]);
    for (const x of [10, 20, 30]) {
      const click = session.submitPoint({ x, y: 5 });
      expect(only(click.requests)).toEqual({ type: "trimAt", mode: "trim", point: { x, y: 5 }, edgeIds: null });
      expect(click.active).toMatchObject({ name: "TRIM", rawPoints: true });
    }
    const ended = session.submitText("");
    expect(ended.requests).toEqual([]);
    expect(ended.active).toBeNull();
    expect(ended.messages.join("\n")).toContain("TRIM を終了しました");
  });

  it("a typed coordinate works as a click; Esc ends without a request (the edits so far are already applied)", () => {
    const session = start();
    session.submitText("trim");
    session.submitSelection([]);
    const typed = session.submitText("50,0");
    expect(only(typed.requests)).toMatchObject({ type: "trimAt", point: { x: 50, y: 0 } });
    const cancelled = session.cancel();
    expect(cancelled.requests).toEqual([]);
    expect(cancelled.active).toBeNull();
  });

  it("a text answer while waiting for the boundary selection is not accepted (the selection is made on the drawing)", () => {
    const session = start();
    session.submitText("trim");
    const result = session.submitText("abc");
    expect(result.requests).toEqual([]);
    expect(result.active?.expect).toBe("selection");
  });
});

describe("EXTEND", () => {
  it("clicks send extend requests with the chosen boundaries", () => {
    const session = start();
    session.submitText("extend");
    const afterSelection = session.submitSelection(["e9"]);
    expect(afterSelection.active).toMatchObject({ expect: "point", rawPoints: true, prompt: expect.stringContaining("延ばす図形の、端に近い所をクリック") });
    const click = session.submitPoint({ x: 95, y: 0 });
    expect(only(click.requests)).toEqual({ type: "trimAt", mode: "extend", point: { x: 95, y: 0 }, edgeIds: ["e9"] });
    expect(click.active?.name).toBe("EXTEND");
  });

  it("Enter at the selection step with nothing selected: all entities are the boundary", () => {
    const session = start();
    session.submitText("ex");
    const result = session.submitSelection([]);
    expect(result.messages.join("\n")).toContain("すべての図形を境界にします");
    expect(only(session.submitPoint({ x: 1, y: 1 }).requests)).toMatchObject({ mode: "extend", edgeIds: null });
  });
});
