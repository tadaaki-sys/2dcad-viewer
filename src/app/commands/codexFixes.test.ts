// Codexレビュー(Phase 3・4)の指摘に対する単体テスト
import { describe, expect, it } from "vitest";
import { createDocument } from "../../core/model";
import { addEntitiesChangeSet } from "../../core/history";
import type { CadLayer, CadLine } from "../../types/cad";
import { DocumentSession } from "../document/documentSession";
import type { DocumentChange } from "../document/documentSession";
import { createAppCommandSession } from "./builtinCommands";
import { makeContext } from "./testHelpers";

function start() {
  const context = makeContext();
  return createAppCommandSession(() => context);
}

describe("pending (drawn but not yet confirmed) work is reported for the page-unload guard", () => {
  it("LINE: nothing pending until there are two points", () => {
    const session = start();
    expect(session.submitText("line").active?.hasPendingChanges).toBe(false);
    expect(session.submitPoint({ x: 0, y: 0 }).active?.hasPendingChanges).toBe(false);
    expect(session.submitPoint({ x: 10, y: 0 }).active?.hasPendingChanges).toBe(true);
    // 1点戻すと、また確定する内容が無くなる
    expect(session.submitText("u").active?.hasPendingChanges).toBe(false);
  });

  it("PLINE: the same rule; RECT never has pending work (Esc draws nothing)", () => {
    const session = start();
    session.submitText("pl");
    session.submitPoint({ x: 0, y: 0 });
    expect(session.submitPoint({ x: 5, y: 5 }).active?.hasPendingChanges).toBe(true);
    session.cancel();
    expect(session.active).toBeNull();
    session.submitText("rect");
    expect(session.active?.hasPendingChanges).toBe(false);
    expect(session.submitPoint({ x: 0, y: 0 }).active?.hasPendingChanges).toBe(false);
  });

  it("a command that is not running has no pending work, and ID has none", () => {
    const session = start();
    expect(session.active).toBeNull();
    session.submitText("id");
    expect(session.active?.hasPendingChanges).toBe(false);
  });
});

describe("RECT ends with an empty Enter, drawing nothing", () => {
  it("at the first corner and at the second corner", () => {
    const first = start();
    first.submitText("rect");
    const ended = first.submitText("");
    expect(ended.active).toBeNull();
    expect(ended.requests).toEqual([]);
    expect(ended.messages).toEqual(["RECT を終了しました(図形は描かれませんでした)"]);

    const second = start();
    second.submitText("rect");
    second.submitPoint({ x: 1, y: 1 });
    const result = second.submitText("  ");
    expect(result.active).toBeNull();
    expect(result.requests).toEqual([]);
    expect(result.messages).toEqual(["RECT を終了しました(図形は描かれませんでした)"]);
  });
});

const LAYERS: CadLayer[] = [{ name: "0", color: "#ffffff", visible: true }];
const line = (id: string, x = 0): CadLine => ({ id, type: "LINE", layer: "0", color: "#ffffff", start: { x, y: 0 }, end: { x: x + 10, y: 10 } });

describe("DocumentSession notifications for history discard and saving", () => {
  it("tells subscribers when Undo fails and the history is discarded (state changes, document does not)", () => {
    // 履歴を通さずに図面を差し替えるのは、DocumentSessionの外からはできないので、図面の内容を食い違わせる変更を履歴に直接入れる
    const session = new DocumentSession(createDocument({ layers: LAYERS, entities: [line("e0")] }));
    const events: DocumentChange[] = [];
    session.subscribe((change) => events.push(change));
    session.apply(addEntitiesChangeSet(session.document, [line("n0", 20)], "追加"));
    // 同じIDを持つ別の図形で、n0 を置き換える(履歴の「追加」を反転して削除するときに、参照が一致しなくなる)
    // applyは参照の一致を確かめるため、DocumentSessionの公開の操作では起こせない。そこで、履歴の内部の変更を、型を迂回して行う
    const internal = session as unknown as { current: { entities: unknown[]; indexById: Map<string, number> } };
    const replacement = line("n0", 99);
    internal.current = { ...internal.current, entities: [internal.current.entities[0], replacement], indexById: new Map([["e0", 0], ["n0", 1]]) } as never;
    events.length = 0;

    const outcome = session.undo();
    expect(outcome.type).toBe("error");
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("reset");
    expect(events[0].state).toEqual({ canUndo: false, canRedo: false, isDirty: true });
    expect(events[0].document).toBe(session.document);
  });

  it("markSaved notifies the new (clean) state, and a token keeps the state that was actually saved", () => {
    const session = new DocumentSession(createDocument({ layers: LAYERS, entities: [line("e0")] }));
    const events: DocumentChange[] = [];
    session.subscribe((change) => events.push(change));
    session.apply(addEntitiesChangeSet(session.document, [line("n0", 20)], "A"));
    const token = session.saveToken; // 状態Aの保存を始める
    session.apply(addEntitiesChangeSet(session.document, [line("n1", 40)], "B")); // 保存している間に編集が進む
    events.length = 0;

    session.markSaved(token); // Aの保存が終わった
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("saved");
    // Bは保存されていないので、まだ未保存
    expect(events[0].state.isDirty).toBe(true);
    expect(session.isDirty).toBe(true);
    session.undo(); // Aに戻ると、保存済み
    expect(session.isDirty).toBe(false);

    session.apply(addEntitiesChangeSet(session.document, [line("n2", 60)], "C"));
    session.markSaved(); // 引数なし: いまの状態
    expect(session.isDirty).toBe(false);
    expect(events[events.length - 1].state.isDirty).toBe(false);
  });
});
