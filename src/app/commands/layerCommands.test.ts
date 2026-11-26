// レイヤー・線種・線の太さのコマンド(LAYER・LINETYPE・LINEWEIGHT・LTSCALE・LAYMOVE)
import { describe, expect, it } from "vitest";
import { createAppCommandSession } from "./builtinCommands";
import { makeContext } from "./testHelpers";
import { NO_EDITING } from "./types";
import type { AppCommandContext } from "./types";

function start(overrides: Partial<AppCommandContext> = {}) {
  const context = makeContext(overrides);
  return { s: createAppCommandSession(() => context), context };
}

const selecting = (ids: string[]): Partial<AppCommandContext> => ({
  editing: {
    ...NO_EDITING,
    ready: true,
    getSelection: () => ids,
    resolveTargets: (given) => ({ editable: given.filter((id) => id !== "ro"), skipped: given.filter((id) => id === "ro").length, reason: given.includes("ro") ? "読み取り専用です" : null }),
  },
});

describe("LAYER / LINETYPE / LINEWEIGHT", () => {
  it("open the layer panel on the matching tab, by name and by alias", () => {
    const { s } = start();
    expect(s.submitText("layer").requests).toEqual([{ type: "openLayers", tab: "layers" }]);
    expect(s.submitText("la").requests).toEqual([{ type: "openLayers", tab: "layers" }]);
    expect(s.submitText("linetype").requests).toEqual([{ type: "openLayers", tab: "linetypes" }]);
    expect(s.submitText("lt").requests).toEqual([{ type: "openLayers", tab: "linetypes" }]);
    expect(s.submitText("lineweight").requests).toEqual([{ type: "openLayers", tab: "lineweights" }]);
    expect(s.submitText("lw").requests).toEqual([{ type: "openLayers", tab: "lineweights" }]);
  });

  it("need an open drawing", () => {
    const { s } = start({ isDocumentOpen: false });
    for (const name of ["layer", "linetype", "lineweight"]) {
      const result = s.submitText(name);
      expect(result.requests, name).toEqual([]);
      expect(result.messages, name).toEqual(["図面が開かれていません"]);
    }
  });
});

describe("LTSCALE", () => {
  it("asks for a number (showing the current scale) and then requests the change", () => {
    const { s } = start({ ltScale: 2.5, editing: { ...NO_EDITING, ready: true } });
    const started = s.submitText("ltscale");
    expect(started.active?.prompt).toContain("現在 2.5");
    const done = s.submitText("0.5");
    expect(done.requests).toEqual([{ type: "setLineTypeScale", value: 0.5 }]);
    expect(done.active).toBeNull();
    s.submitText("lts");
    expect(s.submitText("1e3").requests).toEqual([{ type: "setLineTypeScale", value: 1000 }]);
  });

  it("stays on the step with a message for something that is not a plain number, and cancels on an empty answer", () => {
    const { s } = start({ editing: { ...NO_EDITING, ready: true } });
    s.submitText("ltscale");
    for (const bad of ["abc", "0x10", "1,5", "--1", "1e999", "Infinity", "."]) {
      const result = s.submitText(bad);
      expect(result.requests, bad).toEqual([]);
      expect(result.messages[0], bad).toContain("数値");
      expect(result.active?.name, bad).toBe("LTSCALE");
    }
    const cancelled = s.submitText("");
    expect(cancelled.requests).toEqual([]);
    expect(cancelled.active).toBeNull();
  });

  it("needs an open drawing that is ready", () => {
    expect(start({ isDocumentOpen: false }).s.submitText("ltscale").messages).toEqual(["図面が開かれていません"]);
    expect(start().s.submitText("ltscale").messages[0]).toContain("準備中");
  });
});

describe("LAYMOVE", () => {
  it("with a selection, asks for the layer name; Enter means the current layer; a typed name is passed on as it is", () => {
    const a = start(selecting(["n1", "n2"]));
    expect(a.s.submitText("laymove").active?.prompt).toContain("現在のレイヤー「0」");
    expect(a.s.submitText("").requests).toEqual([{ type: "moveToLayer", ids: ["n1", "n2"], layer: "0" }]);
    const b = start(selecting(["n1"]));
    b.s.submitText("laymove");
    expect(b.s.submitText("  Walls ").requests).toEqual([{ type: "moveToLayer", ids: ["n1"], layer: "Walls" }]);
  });

  it("without a selection, waits for one first", () => {
    const { s } = start(selecting([]));
    expect(s.submitText("laymove").active?.expect).toBe("selection");
    const next = s.submitSelection(["n3"]);
    expect(next.active?.expect).toBe("text");
    expect(s.submitText("A").requests).toEqual([{ type: "moveToLayer", ids: ["n3"], layer: "A" }]);
  });

  it("leaves read-only figures out (and says so); refuses when nothing is editable", () => {
    const mixed = start(selecting(["n1", "ro"]));
    const started = mixed.s.submitText("laymove");
    expect(started.messages.join("")).toContain("除きました");
    expect(mixed.s.submitText("A").requests).toEqual([{ type: "moveToLayer", ids: ["n1"], layer: "A" }]);
    const none = start(selecting(["ro"]));
    const refused = none.s.submitText("laymove");
    expect(refused.requests).toEqual([]);
    expect(refused.active).toBeNull();
    expect(refused.messages[0]).toContain("LAYMOVE");
  });

  it("when the current layer is unknown (hidden), an empty answer asks again instead of guessing", () => {
    const { s } = start({ ...selecting(["n1"]), drawTarget: { ok: false, reason: "非表示です" } });
    s.submitText("laymove");
    const result = s.submitText("");
    expect(result.requests).toEqual([]);
    expect(result.active?.name).toBe("LAYMOVE");
    expect(result.messages[0]).toContain("レイヤー名");
  });
});
