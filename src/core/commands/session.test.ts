import { describe, expect, it } from "vitest";
import { CommandRegistry } from "./registry";
import type { CommandDefinition, PromptStep } from "./registry";
import { CommandSession } from "./session";

type Req = { type: "ping" } | { type: "got"; value: string };
type Ctx = { open: boolean };

const ping: CommandDefinition<Req, Ctx> = {
  name: "PING",
  aliases: ["P"],
  description: "test",
  start: () => ({ type: "done", messages: ["pong"], requests: [{ type: "ping" }] }),
};

const twoPoints: CommandDefinition<Req, Ctx> = {
  name: "TWO",
  description: "test",
  start: () => ({
    type: "prompt",
    prompt: "first?",
    expect: "point",
    onInput: (a) => {
      if (a.kind !== "point") throw new Error("point expected");
      return {
        type: "prompt",
        prompt: "second?",
        expect: "point",
        onInput: (b) => {
          if (b.kind !== "point") throw new Error("point expected");
          return { type: "done", messages: [`${a.point.x},${a.point.y} -> ${b.point.x},${b.point.y}`] };
        },
      };
    },
  }),
};

const ask: CommandDefinition<Req, Ctx> = {
  name: "ASK",
  description: "test",
  start: () => ({
    type: "prompt",
    prompt: "name?",
    expect: "text",
    onInput: (input) => ({ type: "done", requests: [{ type: "got", value: input.kind === "text" ? input.text : "?" }] }),
  }),
};

const dist: CommandDefinition<Req, Ctx> = {
  name: "DIST",
  description: "test",
  start: () => ({
    type: "prompt",
    prompt: "length?",
    expect: "distance",
    onInput: (input) => ({ type: "done", messages: [input.kind === "distance" ? `d=${input.value}` : "?"] }),
  }),
};

const needsDoc: CommandDefinition<Req, Ctx> = {
  name: "NEEDDOC",
  description: "test",
  start: (ctx) => (ctx.open ? { type: "done", requests: [{ type: "ping" }] } : { type: "done", messages: ["no document"] }),
};

function makeSession(ctx: Ctx = { open: true }) {
  const registry = new CommandRegistry<Req, Ctx>();
  for (const d of [ping, twoPoints, ask, dist, needsDoc]) registry.register(d);
  const state = { ctx };
  return { session: new CommandSession(registry, () => state.ctx), state };
}

describe("PromptStep types", () => {
  it("types onInput by the expected kind (checked by the compiler)", () => {
    const step: PromptStep<Req> = {
      type: "prompt",
      prompt: "x",
      expect: "point",
      // @ts-expect-error 点を待つ段階では、距離(value)は読めない
      onInput: (input) => ({ type: "done", messages: [String(input.value)] }),
    };
    expect(step.expect).toBe("point");
    const textStep: PromptStep<Req> = {
      type: "prompt",
      prompt: "x",
      expect: "text",
      onInput: (input) => ({ type: "done", messages: [input.text] }),
    };
    expect(textStep.expect).toBe("text");
  });
});

describe("CommandRegistry", () => {
  it("finds by name and alias, ignoring case and width", () => {
    const registry = new CommandRegistry<Req, Ctx>();
    registry.register(ping);
    expect(registry.find("ping")?.name).toBe("PING");
    expect(registry.find("p")?.name).toBe("PING");
    expect(registry.find(" ｐｉｎｇ ")?.name).toBe("PING");
    expect(registry.find("nope")).toBeNull();
    expect(registry.list()).toHaveLength(1);
  });

  it("rejects duplicate names and aliases", () => {
    const registry = new CommandRegistry<Req, Ctx>();
    registry.register(ping);
    expect(() => registry.register({ ...ping, name: "PING" })).toThrow();
    expect(() => registry.register({ ...ping, name: "OTHER", aliases: ["p"] })).toThrow();
    expect(() => registry.register({ ...ping, name: "SAME", aliases: ["same"] })).toThrow();
    expect(() => registry.register({ ...ping, name: "  " })).toThrow();
    expect(registry.list()).toHaveLength(1); // 失敗した登録は残らない
    expect(registry.find("OTHER")).toBeNull();
  });
});

describe("CommandSession: starting commands", () => {
  it("runs a one-shot command and returns its messages and requests", () => {
    const { session } = makeSession();
    const result = session.submitText("ping");
    expect(result).toEqual({ messages: ["pong"], requests: [{ type: "ping" }], active: null });
    expect(session.submitText("p").requests).toEqual([{ type: "ping" }]);
  });

  it("reports an unknown command and stays idle", () => {
    const { session } = makeSession();
    const result = session.submitText("  zzz ");
    expect(result.messages).toEqual(["不明なコマンドです: zzz"]);
    expect(result.active).toBeNull();
  });

  it("ignores empty input when idle", () => {
    const { session } = makeSession();
    expect(session.submitText("")).toEqual({ messages: [], requests: [], active: null });
    expect(session.submitText("   ")).toEqual({ messages: [], requests: [], active: null });
  });

  it("passes the current context when the command starts", () => {
    const { session, state } = makeSession({ open: false });
    expect(session.submitText("needdoc").messages).toEqual(["no document"]);
    state.ctx = { open: true };
    expect(session.submitText("needdoc").requests).toEqual([{ type: "ping" }]);
  });
});

describe("CommandSession: point input", () => {
  it("collects points from clicks and from typed coordinates", () => {
    const { session } = makeSession();
    const first = session.submitText("two");
    expect(first.active).toEqual({
      name: "TWO",
      prompt: "first?",
      expect: "point",
      keywords: [],
      acceptsEnter: false,
      hasPreview: false,
      hasPendingChanges: false,
    });
    expect(first.messages).toEqual(["TWO first?"]);
    const second = session.submitPoint({ x: 10, y: 20 });
    expect(second.active?.prompt).toBe("second?");
    const done = session.submitText("@5,5");
    expect(done.messages).toEqual(["10,20 -> 15,25"]);
    expect(done.active).toBeNull();
    expect(session.active).toBeNull();
  });

  it("uses the last point of the previous command as the base for relative input", () => {
    const { session } = makeSession();
    session.submitText("two");
    session.submitText("100,100");
    session.submitText("200,300");
    expect(session.lastPointValue).toEqual({ x: 200, y: 300 });
    session.submitText("two");
    const second = session.submitText("@1,1");
    expect(second.active?.prompt).toBe("second?");
    const done = session.submitText("0,0");
    expect(done.messages).toEqual(["201,301 -> 0,0"]);
  });

  it("explains an invalid coordinate and keeps waiting at the same step", () => {
    const { session } = makeSession();
    session.submitText("two");
    const result = session.submitText("abc");
    expect(result.messages).toHaveLength(2);
    expect(result.messages[1]).toBe("TWO first?");
    expect(result.active?.prompt).toBe("first?");
    // 続けて正しい入力ができる
    expect(session.submitText("1,2").active?.prompt).toBe("second?");
  });

  it("refuses a bare distance when a point is expected", () => {
    const { session } = makeSession();
    session.submitText("two");
    const result = session.submitText("500");
    expect(result.active?.prompt).toBe("first?");
    expect(result.messages[0]).toContain("点");
  });

  it("does not use the previous point when none exists yet", () => {
    const { session } = makeSession();
    session.submitText("two");
    const result = session.submitText("@1,1");
    expect(result.active?.prompt).toBe("first?");
    expect(result.messages[0]).toContain("相対座標");
  });

  it("does nothing on an empty Enter while waiting for a point", () => {
    const { session } = makeSession();
    session.submitText("two");
    const result = session.submitText("  ");
    expect(result.messages).toEqual([]);
    expect(result.active?.prompt).toBe("first?");
  });

  it("ignores a clicked point when no command is waiting for one", () => {
    const { session } = makeSession();
    expect(session.submitPoint({ x: 1, y: 1 })).toEqual({ messages: [], requests: [], active: null });
    expect(session.lastPointValue).toBeNull();
    session.submitText("ask");
    expect(session.submitPoint({ x: 1, y: 1 }).active?.expect).toBe("text");
    expect(session.lastPointValue).toBeNull();
  });
});

describe("CommandSession: text and distance input", () => {
  it("passes text as is", () => {
    const { session } = makeSession();
    session.submitText("ask");
    expect(session.submitText(" 1,2 abc ").requests).toEqual([{ type: "got", value: " 1,2 abc " }]);
  });

  it("reads a distance and refuses a point", () => {
    const { session } = makeSession();
    session.submitText("dist");
    expect(session.submitText("1,2").active?.expect).toBe("distance");
    const done = session.submitText("２５０");
    expect(done.messages).toEqual(["d=250"]);
    expect(done.active).toBeNull();
  });

  it("while a command is waiting, a command name is not started (it is treated as input)", () => {
    const { session } = makeSession();
    session.submitText("two");
    const result = session.submitText("ping");
    expect(result.requests).toEqual([]);
    expect(session.active?.name).toBe("TWO");
  });
});

describe("CommandSession: cancel, run, reset", () => {
  it("cancel stops the running command; cancelling when idle does nothing", () => {
    const { session } = makeSession();
    expect(session.cancel()).toEqual({ messages: [], requests: [], active: null });
    session.submitText("two");
    const result = session.cancel();
    expect(result).toEqual({ messages: ["TWO を取り消しました"], requests: [], active: null });
    expect(session.active).toBeNull();
    expect(session.submitPoint({ x: 1, y: 1 }).messages).toEqual([]);
  });

  it("run starts a command by name and replaces a running one", () => {
    const { session } = makeSession();
    session.submitText("two");
    const result = session.run("ping");
    expect(result.messages).toEqual(["TWO を取り消しました", "pong"]);
    expect(result.requests).toEqual([{ type: "ping" }]);
    expect(session.active).toBeNull();
  });

  it("run with an unknown name reports it", () => {
    const { session } = makeSession();
    expect(session.run("zzz").messages).toEqual(["不明なコマンドです: zzz"]);
  });

  it("reset drops the running command and the last point silently", () => {
    const { session } = makeSession();
    session.submitText("two");
    session.submitText("5,5");
    session.reset();
    expect(session.active).toBeNull();
    expect(session.lastPointValue).toBeNull();
  });
});
