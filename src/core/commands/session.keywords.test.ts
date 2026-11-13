// Phase 4: キーワード、空のEnter、Escでの確定、ゴム紐、基準点
import { describe, expect, it } from "vitest";
import { CommandRegistry } from "./registry";
import type { CommandDefinition, PromptStep } from "./registry";
import { CommandSession } from "./session";

type Req = { type: "ping" } | { type: "got"; value: string };
type Ctx = { open: boolean };
type Pt = { x: number; y: number };

const ping: CommandDefinition<Req, Ctx> = {
  name: "PING",
  description: "test",
  start: () => ({ type: "done", messages: ["pong"], requests: [{ type: "ping" }] }),
};

/** キーワード・Enterを宣言しない、ふつうの点の段階(Phase 2の動作の確認用) */
const plainPoint: CommandDefinition<Req, Ctx> = {
  name: "PLAIN",
  description: "test",
  start: () => ({
    type: "prompt",
    prompt: "first?",
    expect: "point",
    onInput: () => ({ type: "done", messages: ["ok"] }),
  }),
};

/** 点を順に集めて、Enter・Escで、集めた点を依頼として返すコマンド(作図コマンドの縮図) */
const collector: CommandDefinition<Req, Ctx> = {
  name: "COLLECT",
  aliases: ["CO"],
  description: "test",
  start: () => step([]),
};

const asText = (points: readonly Pt[]) => points.map((p) => `${p.x},${p.y}`).join(";");

function step(points: readonly Pt[]): PromptStep<Req> {
  return {
    type: "prompt",
    prompt: points.length === 0 ? "first?" : "next?",
    expect: "point",
    keywords: points.length > 0 ? ["U", "C"] : [],
    acceptsEnter: true,
    basePoint: points.length > 0 ? points[points.length - 1] : undefined,
    preview: (cursor) => (points.length > 0 ? [{ kind: "polyline", points: [...points, cursor], closed: false }] : []),
    onCancel: () => ({ messages: [`終了 ${points.length}点`], requests: [{ type: "got", value: asText(points) }] }),
    onInput: (input) => {
      if (input.kind === "point") return step([...points, input.point]);
      if (input.kind === "keyword" && input.keyword === "U") return step(points.slice(0, -1));
      if (input.kind === "keyword" && input.keyword === "C") {
        return { type: "done", messages: ["閉じました"], requests: [{ type: "got", value: `closed:${points.length}` }] };
      }
      return { type: "done", messages: [`Enterで終了 ${points.length}点`], requests: [{ type: "got", value: asText(points) }] };
    },
  };
}

function makeSession() {
  const registry = new CommandRegistry<Req, Ctx>();
  for (const d of [collector, ping, plainPoint]) registry.register(d);
  return new CommandSession(registry, () => ({ open: true }));
}

describe("keywords, Enter, cancel hook and preview", () => {
  it("reports the declared keywords, Enter and preview in the active state", () => {
    const session = makeSession();
    const first = session.submitText("co");
    expect(first.active).toMatchObject({ keywords: [], acceptsEnter: true, hasPreview: true, expect: "point" });
    expect(session.submitPoint({ x: 1, y: 1 }).active?.keywords).toEqual(["U", "C"]);
  });

  it("passes a declared keyword (any case, full-width) as a keyword input; U stays in the command", () => {
    const session = makeSession();
    session.submitText("co");
    session.submitPoint({ x: 1, y: 1 });
    session.submitPoint({ x: 2, y: 2 });
    const undone = session.submitText("ｕ");
    expect(undone.active?.name).toBe("COLLECT");
    expect(undone.messages).toEqual(["COLLECT next?"]);
    const done = session.submitText(""); // 1点戻ったので、Enterで終了すると、その1点が返る
    expect(done.requests).toEqual([{ type: "got", value: "1,1" }]);
  });

  it("refuses a keyword the step does not declare (it is read as a coordinate)", () => {
    const session = makeSession();
    session.submitText("co");
    const result = session.submitText("u"); // 最初の点では U は宣言されていない
    expect(result.active?.prompt).toBe("first?");
    expect(result.requests).toEqual([]);
    expect(result.messages[0]).toContain("座標");
  });

  it("passes an empty Enter to a step that accepts it, and finishes the command", () => {
    const session = makeSession();
    session.submitText("co");
    session.submitPoint({ x: 5, y: 6 });
    const result = session.submitText("   ");
    expect(result.messages).toEqual(["Enterで終了 1点"]);
    expect(result.requests).toEqual([{ type: "got", value: "5,6" }]);
    expect(result.active).toBeNull();
  });

  it("C closes and finishes", () => {
    const session = makeSession();
    session.submitText("co");
    for (const p of [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }]) session.submitPoint(p);
    expect(session.submitText("c").requests).toEqual([{ type: "got", value: "closed:3" }]);
  });

  it("submitKeyword works like typing the keyword, and does nothing when the step does not declare it", () => {
    const session = makeSession();
    expect(session.submitKeyword("U")).toEqual({ messages: [], requests: [], active: null }); // 実行中でない
    session.submitText("co");
    expect(session.submitKeyword("U").active?.prompt).toBe("first?"); // 最初の点では宣言なし
    session.submitPoint({ x: 1, y: 1 });
    session.submitPoint({ x: 2, y: 2 });
    expect(session.submitKeyword("u").messages).toEqual(["COLLECT next?"]);
    expect(session.submitKeyword("ZZZ").messages).toEqual([]);
  });

  it("an Enter for a step that does not accept it does nothing (the Phase 2 behavior)", () => {
    const session = makeSession();
    session.submitText("plain");
    const result = session.submitText("");
    expect(result.messages).toEqual([]);
    expect(result.active?.prompt).toBe("first?");
    expect(result.active).toMatchObject({ keywords: [], acceptsEnter: false, hasPreview: false });
  });

  it("Esc applies the onCancel output (the drawn part is kept); a plain step is just cancelled", () => {
    const session = makeSession();
    session.submitText("co");
    session.submitPoint({ x: 1, y: 2 });
    session.submitPoint({ x: 3, y: 4 });
    const result = session.cancel();
    expect(result.messages).toEqual(["終了 2点"]);
    expect(result.requests).toEqual([{ type: "got", value: "1,2;3,4" }]);
    expect(result.active).toBeNull();
    expect(session.active).toBeNull();

    session.submitText("plain");
    expect(session.cancel().messages).toEqual(["PLAIN を取り消しました"]);
  });

  it("run() keeps the requests of the command it ends (the drawn part is not lost when another command starts)", () => {
    const session = makeSession();
    session.submitText("co");
    session.submitPoint({ x: 7, y: 8 });
    const result = session.run("ping");
    expect(result.requests).toEqual([{ type: "got", value: "7,8" }, { type: "ping" }]);
    expect(result.messages).toEqual(["終了 1点", "pong"]);
    expect(session.active).toBeNull();
  });

  it("reset() discards the running command without applying onCancel", () => {
    const session = makeSession();
    session.submitText("co");
    session.submitPoint({ x: 7, y: 8 });
    session.reset();
    expect(session.active).toBeNull();
    expect(session.cancel()).toEqual({ messages: [], requests: [], active: null });
  });

  it("previewAt returns the rubber band; nothing when idle or without a preview; it does not change the state", () => {
    const session = makeSession();
    expect(session.previewAt({ x: 0, y: 0 })).toEqual([]);
    session.submitText("co");
    expect(session.previewAt({ x: 9, y: 9 })).toEqual([]); // 最初の点: ゴム紐なし
    session.submitPoint({ x: 1, y: 1 });
    expect(session.previewAt({ x: 5, y: 5 })).toEqual([{ kind: "polyline", points: [{ x: 1, y: 1 }, { x: 5, y: 5 }], closed: false }]);
    expect(session.previewAt({ x: 6, y: 6 })).toHaveLength(1);
    expect(session.active?.prompt).toBe("next?");
    session.cancel();
    session.submitText("plain");
    expect(session.previewAt({ x: 1, y: 1 })).toEqual([]);
  });

  it("uses the step basePoint as the base of relative input (so U moves the base back too)", () => {
    const session = makeSession();
    session.submitText("co");
    session.submitPoint({ x: 0, y: 0 });
    session.submitPoint({ x: 100, y: 0 });
    session.submitKeyword("U"); // 直前の点が (0,0) に戻る
    expect(session.lastPointValue).toEqual({ x: 0, y: 0 });
    session.submitText("@10,10");
    expect(session.submitText("").requests).toEqual([{ type: "got", value: "0,0;10,10" }]);
  });
});
