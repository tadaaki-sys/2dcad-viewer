// グリップ・頂点のコマンド(GRIPEDIT・VERTEXADD・VERTEXDEL・PCLOSE・POPEN)(Phase 18)
import { describe, expect, it } from "vitest";
import type { PreviewShape } from "../../core/commands";
import { createAppCommandSession } from "./builtinCommands";
import { makeContext } from "./testHelpers";
import { NO_EDITING } from "./types";
import type { AppCommandContext, GripTarget } from "./types";

function start(overrides: Partial<AppCommandContext> = {}) {
  const context = makeContext(overrides);
  return { s: createAppCommandSession(() => context), context };
}

const ready = { ...NO_EDITING, ready: true };

describe("GRIPEDIT", () => {
  it("takes the pending grip, waits for a point (base point = the grip), and requests the move; the preview comes from the editing hook", () => {
    let pending: GripTarget | null = { id: "n7", index: 2, point: { x: 5, y: 6 } };
    const shapes: PreviewShape[] = [{ kind: "circle", center: { x: 0, y: 0 }, radius: 1 }];
    const { s } = start({
      editing: {
        ...ready,
        takePendingGrip: () => {
          const grip = pending;
          pending = null;
          return grip;
        },
        createGripPreview: (id, index) => (cursor) => (id === "n7" && index === 2 && cursor.x === 9 ? shapes : []),
      },
    });
    const started = s.submitText("gripedit");
    expect(started.active).toMatchObject({ name: "GRIPEDIT", expect: "point", acceptsEnter: true, basePoint: { x: 5, y: 6 }, hasPreview: true });
    expect(s.previewAt({ x: 9, y: 0 })).toEqual(shapes);
    const done = s.submitPoint({ x: 12, y: 13 });
    expect(done.requests).toEqual([{ type: "moveGrip", id: "n7", index: 2, point: { x: 12, y: 13 } }]);
    expect(done.active).toBeNull();
    expect(pending).toBeNull();
  });

  it("Enter ends without a request; with no pending grip (or no drawing) it says so", () => {
    const { s } = start({ editing: { ...ready, takePendingGrip: () => ({ id: "n1", index: 0, point: { x: 0, y: 0 } }) } });
    s.submitText("gripedit");
    const ended = s.submitText("");
    expect(ended.requests).toEqual([]);
    expect(ended.active).toBeNull();
    expect(start({ editing: ready }).s.submitText("gripedit").messages[0]).toContain("グリップが指定されていません");
    expect(start({ isDocumentOpen: false }).s.submitText("gripedit").messages).toEqual(["図面が開かれていません"]);
    expect(start().s.submitText("gripedit").messages[0]).toContain("準備中");
  });
});

describe("VERTEXADD / VERTEXDEL", () => {
  const picking = (ids: Record<string, string>) => ({
    ...ready,
    pickEntity: (point: { x: number; y: number }) => (ids[String(point.x)] !== undefined ? { ok: true as const, id: ids[String(point.x)] } : { ok: false as const, message: "折れ線が見つかりません" }),
  });

  it("each click on a polyline requests one add and the command waits for the next; Enter ends", () => {
    const { s } = start({ editing: picking({ "10": "n1", "20": "n2" }) });
    expect(s.submitText("vertexadd").active).toMatchObject({ name: "VERTEXADD", rawPoints: true, acceptsEnter: true });
    expect(s.submitPoint({ x: 10, y: 0 }).requests).toEqual([{ type: "addVertex", id: "n1", point: { x: 10, y: 0 } }]);
    const second = s.submitPoint({ x: 20, y: 5 });
    expect(second.requests).toEqual([{ type: "addVertex", id: "n2", point: { x: 20, y: 5 } }]);
    expect(second.active?.name).toBe("VERTEXADD");
    const ended = s.submitText("");
    expect(ended.requests).toEqual([]);
    expect(ended.active).toBeNull();
  });

  it("Enter after some clicks does not claim that nothing changed (each click was already applied)", () => {
    const { s } = start({ editing: picking({ "10": "n1" }) });
    s.submitText("vertexadd");
    s.submitPoint({ x: 10, y: 0 });
    s.submitPoint({ x: 10, y: 1 });
    const ended = s.submitText("");
    expect(ended.messages[0]).toContain("2 回の分は、適用済みです");
    expect(ended.messages[0]).not.toContain("変更されませんでした");
    const none = start({ editing: picking({}) });
    none.s.submitText("vertexadd");
    expect(none.s.submitText("").messages[0]).toContain("変更されませんでした");
  });

  it("a click that finds nothing says why and stays; VERTEXDEL requests a delete", () => {
    const { s } = start({ editing: picking({ "10": "n1" }) });
    s.submitText("vertexadd");
    const miss = s.submitPoint({ x: 99, y: 0 });
    expect(miss.requests).toEqual([]);
    expect(miss.messages[0]).toBe("折れ線が見つかりません");
    expect(miss.active?.name).toBe("VERTEXADD");
    s.cancel();
    const del = start({ editing: picking({ "10": "n1" }) });
    del.s.submitText("vertexdel");
    expect(del.s.submitPoint({ x: 10, y: 0 }).requests).toEqual([{ type: "deleteVertex", id: "n1", point: { x: 10, y: 0 } }]);
  });

  it("need an open, ready drawing", () => {
    expect(start({ isDocumentOpen: false }).s.submitText("vertexadd").messages).toEqual(["図面が開かれていません"]);
    expect(start().s.submitText("vertexdel").messages[0]).toContain("準備中");
  });
});

describe("PCLOSE / POPEN", () => {
  const selecting = (ids: string[]) => ({ ...ready, getSelection: () => ids, resolveTargets: (given: readonly string[]) => ({ editable: [...given], skipped: 0, reason: null }) });

  it("act on the selection (or wait for one) and request closing / opening", () => {
    expect(start({ editing: selecting(["n1", "n2"]) }).s.submitText("pclose").requests).toEqual([{ type: "setPolylinesClosed", ids: ["n1", "n2"], closed: true }]);
    expect(start({ editing: selecting(["n3"]) }).s.submitText("popen").requests).toEqual([{ type: "setPolylinesClosed", ids: ["n3"], closed: false }]);
    const waiting = start({ editing: selecting([]) });
    expect(waiting.s.submitText("pclose").active?.expect).toBe("selection");
    expect(waiting.s.submitSelection(["n9"]).requests).toEqual([{ type: "setPolylinesClosed", ids: ["n9"], closed: true }]);
  });
});
