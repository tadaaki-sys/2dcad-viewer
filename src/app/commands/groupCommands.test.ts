// グループ・描画順のコマンド(Phase 19)
import { describe, expect, it } from "vitest";
import { createAppCommandSession } from "./builtinCommands";
import { makeContext } from "./testHelpers";
import { NO_EDITING } from "./types";
import type { AppCommandContext, AppEditing } from "./types";

function start(overrides: Partial<AppCommandContext> = {}) {
  const context = makeContext(overrides);
  return { s: createAppCommandSession(() => context), context };
}

const editing = (selection: string[], extra: Partial<AppEditing> = {}): Partial<AppCommandContext> => ({
  editing: {
    ...NO_EDITING,
    ready: true,
    getSelection: () => selection,
    resolveTargets: (given) => ({ editable: [...given], skipped: 0, reason: null }),
    ...extra,
  },
});

describe("GROUP / UNGROUP / GROUPEDIT / GROUPS / PICKSTYLE", () => {
  it("GROUP (alias G) asks for a name; Enter makes an unnamed group", () => {
    const named = start(editing(["n1", "n2"]));
    expect(named.s.submitText("g").active?.expect).toBe("text");
    expect(named.s.submitText("  Conveyor ").requests).toEqual([{ type: "createGroup", ids: ["n1", "n2"], name: "Conveyor" }]);
    const unnamed = start(editing(["n1"]));
    unnamed.s.submitText("group");
    expect(unnamed.s.submitText("").requests).toEqual([{ type: "createGroup", ids: ["n1"], name: null }]);
  });

  it("GROUP without a selection waits for one", () => {
    const { s } = start(editing([]));
    expect(s.submitText("group").active?.expect).toBe("selection");
    s.submitSelection(["n5"]);
    expect(s.submitText("X").requests).toEqual([{ type: "createGroup", ids: ["n5"], name: "X" }]);
  });

  it("UNGROUP requests ungrouping the selection", () => {
    expect(start(editing(["n1"])).s.submitText("ungroup").requests).toEqual([{ type: "ungroup", ids: ["n1"] }]);
  });

  it("GROUPEDIT: the name defaults to the group of the selection; A / R then a selection", () => {
    const { s } = start(editing(["n1"], { groupNameOf: (id) => (id === "n1" ? "G" : null) }));
    expect(s.submitText("groupedit").active?.prompt).toContain("「G」");
    expect(s.submitText("").active?.prompt).toContain("追加(A)/除外(R)");
    expect(s.submitText("x").messages[0]).toContain("A(追加)か R(除外)");
    // 図形を選ぶ段階は、グループ単位に広げない(PICKSTYLE がオンでも、1つずつ)
    expect(s.submitText("r").active).toMatchObject({ expect: "selection", individualSelection: true });
    expect(s.submitSelection(["n1"]).requests).toEqual([{ type: "editGroup", name: "G", ids: ["n1"], mode: "remove" }]);
    const named = start(editing([]));
    named.s.submitText("groupedit");
    expect(named.s.submitText("").messages[0]).toContain("グループ名を入力してください");
    named.s.submitText("Other");
    named.s.submitText("a");
    expect(named.s.submitSelection(["n9"]).requests).toEqual([{ type: "editGroup", name: "Other", ids: ["n9"], mode: "add" }]);
  });

  it("GROUPS opens the panel; PICKSTYLE toggles group selection; both need an open drawing", () => {
    expect(start().s.submitText("groups").requests).toEqual([{ type: "openGroups" }]);
    expect(start().s.submitText("pickstyle").requests).toEqual([{ type: "togglePickStyle" }]);
    expect(start({ isDocumentOpen: false }).s.submitText("groups").messages).toEqual(["図面が開かれていません"]);
    expect(start({ isDocumentOpen: false }).s.submitText("ungroup").messages).toEqual(["図面が開かれていません"]);
  });
});

describe("DRAWORDER / TEXTTOFRONT", () => {
  it("F and B request front / back for the selection (alias DR)", () => {
    const front = start(editing(["n1", "n2"]));
    front.s.submitText("dr");
    expect(front.s.submitText("f").requests).toEqual([{ type: "drawOrder", ids: ["n1", "n2"], placement: { kind: "front" } }]);
    const back = start(editing(["n1"]));
    back.s.submitText("draworder");
    expect(back.s.submitText("背面").requests).toEqual([{ type: "drawOrder", ids: ["n1"], placement: { kind: "back" } }]);
  });

  it("A and U ask for a reference figure; a moved figure cannot be the reference; Enter ends", () => {
    const kinds: Array<string | undefined> = [];
    const pick = (point: { x: number }, _name: string, kind?: string) => (kinds.push(kind), point.x === 1 ? { ok: true as const, id: "n9" } : point.x === 2 ? { ok: true as const, id: "n1" } : { ok: false as const, message: "図形が見つかりません" });
    const { s } = start(editing(["n1"], { pickEntity: pick }));
    s.submitText("draworder");
    expect(s.submitText("a").active).toMatchObject({ expect: "point", rawPoints: true });
    expect(s.submitPoint({ x: 3, y: 0 }).messages[0]).toBe("図形が見つかりません");
    expect(s.submitPoint({ x: 2, y: 0 }).messages[0]).toContain("動かす図形以外");
    expect(s.submitPoint({ x: 1, y: 0 }).requests).toEqual([{ type: "drawOrder", ids: ["n1"], placement: { kind: "above", referenceId: "n9" } }]);
    // 基準は、ロック・読み取り専用の図形でも選べる指定(reference)で探す
    expect(new Set(kinds)).toEqual(new Set(["reference"]));
    const below = start(editing(["n1"], { pickEntity: pick }));
    below.s.submitText("draworder");
    below.s.submitText("u");
    expect(below.s.submitPoint({ x: 1, y: 0 }).requests).toEqual([{ type: "drawOrder", ids: ["n1"], placement: { kind: "below", referenceId: "n9" } }]);
    const ended = start(editing(["n1"], { pickEntity: pick }));
    ended.s.submitText("draworder");
    ended.s.submitText("a");
    expect(ended.s.submitText("").requests).toEqual([]);
  });

  it("an unknown answer stays on the step; TEXTTOFRONT requests at once (needs a ready drawing)", () => {
    const { s } = start(editing(["n1"]));
    s.submitText("draworder");
    expect(s.submitText("z").messages[0]).toContain("F(前面)");
    expect(start(editing([])).s.submitText("texttofront").requests).toEqual([{ type: "textToFront" }]);
    expect(start().s.submitText("texttofront").messages[0]).toContain("準備中");
  });
});
