import { describe, expect, it } from "vitest";
import {
  BUILTIN_COMMANDS,
  createAppCommandRegistry,
  createAppCommands,
  createAppCommandSession,
  formatCoordinate,
} from "./builtinCommands";
import { makeContext } from "./testHelpers";

function session(isDocumentOpen = true) {
  const state = makeContext({ isDocumentOpen });
  return { s: createAppCommandSession(() => state), state };
}

describe("built-in commands", () => {
  it("registers every command without name conflicts", () => {
    const registry = createAppCommandRegistry();
    expect(registry.list().map((d) => d.name)).toEqual(["OPEN", "CLOSE", "FIT", "MEASURE", "FULLSCREEN", "UNDO", "REDO", "LINE", "PLINE", "RECT", "TOFRONT", "TOBACK", "ID"]);
    expect(BUILTIN_COMMANDS.every((d) => d.description.length > 0)).toBe(true);
  });

  it("maps each command (and alias) to its request", () => {
    const { s } = session();
    const requestOf = (text: string) => s.submitText(text).requests;
    expect(requestOf("open")).toEqual([{ type: "openFile" }]);
    expect(requestOf("close")).toEqual([{ type: "closeDocument" }]);
    expect(requestOf("fit")).toEqual([{ type: "fitDrawing" }]);
    expect(requestOf("f")).toEqual([{ type: "fitDrawing" }]);
    expect(requestOf("measure")).toEqual([{ type: "toggleMeasurement" }]);
    expect(requestOf("m")).toEqual([{ type: "toggleMeasurement" }]);
    expect(requestOf("DI")).toEqual([{ type: "toggleMeasurement" }]);
    expect(requestOf("fullscreen")).toEqual([{ type: "toggleFullscreen" }]);
    expect(requestOf("undo")).toEqual([{ type: "undo" }]);
    expect(requestOf("u")).toEqual([{ type: "undo" }]);
    expect(requestOf("redo")).toEqual([{ type: "redo" }]);
    expect(requestOf("tofront")).toEqual([{ type: "reorder", direction: "front" }]);
    expect(requestOf("toback")).toEqual([{ type: "reorder", direction: "back" }]);
  });

  it("needs an open document, except for OPEN and FULLSCREEN", () => {
    const { s } = session(false);
    for (const name of ["close", "fit", "measure", "id", "undo", "u", "redo", "line", "l", "pline", "pl", "rect", "rec", "tofront", "toback"]) {
      const result = s.submitText(name);
      expect(result.requests, name).toEqual([]);
      expect(result.messages, name).toEqual(["図面が開かれていません"]);
      expect(result.active, name).toBeNull();
    }
    expect(s.submitText("open").requests).toEqual([{ type: "openFile" }]);
    expect(s.submitText("fullscreen").requests).toEqual([{ type: "toggleFullscreen" }]);
  });

  it("ID prints the clicked point", () => {
    const { s } = session();
    const started = s.submitText("id");
    expect(started.active).toEqual({
      name: "ID",
      prompt: "点を指示してください",
      expect: "point",
      keywords: [],
      acceptsEnter: false,
      hasPreview: false,
    });
    const done = s.submitPoint({ x: 1234.5678, y: -0.0001 });
    expect(done.messages).toEqual(["X = 1234.568, Y = 0.000"]);
    expect(done.active).toBeNull();
  });

  it("ID prints a typed point, including relative input from the previous one", () => {
    const { s } = session();
    s.submitText("id");
    expect(s.submitText("1000,500").messages).toEqual(["X = 1000.000, Y = 500.000"]);
    s.submitText("id");
    expect(s.submitText("@500,0").messages).toEqual(["X = 1500.000, Y = 500.000"]);
    s.submitText("id");
    expect(s.submitText("@100<90").messages).toEqual(["X = 1500.000, Y = 600.000"]);
  });

  it("ID keeps waiting after an invalid input", () => {
    const { s } = session();
    s.submitText("id");
    const bad = s.submitText("1,2,3");
    expect(bad.active?.name).toBe("ID");
    expect(bad.requests).toEqual([]);
    expect(s.submitText("1,2").messages).toEqual(["X = 1.000, Y = 2.000"]);
  });

  it("createAppCommands follows the context set later (document opened/closed)", () => {
    const commands = createAppCommands(makeContext({ isDocumentOpen: false }));
    expect(commands.session.submitText("fit").messages).toEqual(["図面が開かれていません"]);
    commands.setContext(makeContext({ isDocumentOpen: true }));
    expect(commands.session.submitText("fit").requests).toEqual([{ type: "fitDrawing" }]);
    commands.setContext(makeContext({ isDocumentOpen: false }));
    expect(commands.session.submitText("fit").requests).toEqual([]);
  });

  it("formatCoordinate prints 3 decimals and never -0.000", () => {
    expect(formatCoordinate(0)).toBe("0.000");
    expect(formatCoordinate(-0)).toBe("0.000");
    expect(formatCoordinate(-0.0004)).toBe("0.000");
    expect(formatCoordinate(-1.5)).toBe("-1.500");
    expect(formatCoordinate(123456.789123)).toBe("123456.789");
  });
});
