import { describe, expect, it } from "vitest";
import { CommandHistory } from "./history";

describe("CommandHistory", () => {
  it("walks back and forth, restoring the unsent text at the end", () => {
    const h = new CommandHistory();
    h.push("FIT");
    h.push("MEASURE");
    h.push("ID");
    expect(h.previous("abc")).toBe("ID");
    expect(h.previous("ignored")).toBe("MEASURE");
    expect(h.previous("ignored")).toBe("FIT");
    expect(h.previous("ignored")).toBe("FIT"); // 先頭で止まる
    expect(h.next("ignored")).toBe("MEASURE");
    expect(h.next("ignored")).toBe("ID");
    expect(h.next("ignored")).toBe("abc"); // 入力中だった文字に戻る
    expect(h.next("abc")).toBe("abc"); // たどっていないときは、そのまま
  });

  it("returns the current text when empty", () => {
    const h = new CommandHistory();
    expect(h.previous("x")).toBe("x");
    expect(h.next("x")).toBe("x");
  });

  it("ignores empty input and collapses consecutive duplicates", () => {
    const h = new CommandHistory();
    h.push("");
    h.push("   ");
    h.push("FIT");
    h.push("FIT");
    h.push(" FIT ");
    expect(h.size).toBe(1);
    h.push("ID");
    h.push("FIT");
    expect(h.size).toBe(3);
  });

  it("keeps only the newest entries up to the limit", () => {
    const h = new CommandHistory(3);
    for (const text of ["a", "b", "c", "d", "e"]) h.push(text);
    expect(h.size).toBe(3);
    expect(h.previous("")).toBe("e");
    expect(h.previous("")).toBe("d");
    expect(h.previous("")).toBe("c");
    expect(h.previous("")).toBe("c");
  });

  it("defaults to 50 entries", () => {
    const h = new CommandHistory();
    for (let i = 0; i < 80; i++) h.push(`cmd${i}`);
    expect(h.size).toBe(50);
  });

  it("push resets the walking position", () => {
    const h = new CommandHistory();
    h.push("a");
    h.push("b");
    expect(h.previous("")).toBe("b");
    h.push("c");
    expect(h.previous("")).toBe("c");
  });

  it("resetCursor starts again from the newest entry", () => {
    const h = new CommandHistory();
    h.push("a");
    h.push("b");
    h.previous("");
    h.previous("");
    h.resetCursor();
    expect(h.previous("typed")).toBe("b");
    expect(h.next("")).toBe("typed");
  });
});
