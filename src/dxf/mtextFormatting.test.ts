import { describe, expect, it } from "vitest";
import { stripMtextFormatting } from "./mtextFormatting";

describe("stripMtextFormatting", () => {
  it("leaves plain text without codes unchanged", () => {
    expect(stripMtextFormatting("鉄筋コンクリート造")).toBe("鉄筋コンクリート造");
  });

  it("converts \\P to a newline", () => {
    expect(stripMtextFormatting("1階平面図\\P縮尺1:100")).toBe("1階平面図\n縮尺1:100");
  });

  it("converts \\~ to a regular space", () => {
    expect(stripMtextFormatting("A\\~B")).toBe("A B");
  });

  it("strips font/height/color control codes with semicolon-terminated parameters", () => {
    expect(stripMtextFormatting("\\fArial|b0|i0;\\H2.5x;\\C1;注記")).toBe("注記");
  });

  it("strips toggle codes without altering surrounding text", () => {
    expect(stripMtextFormatting("\\L下線\\l通常\\O上線\\o")).toBe("下線通常上線");
  });

  it("removes grouping braces", () => {
    expect(stripMtextFormatting("{注記}")).toBe("注記");
  });

  it("converts a \\U+XXXX unicode escape to the actual character", () => {
    expect(stripMtextFormatting("\\U+03A6100")).toBe("Φ100");
  });

  it("converts %%d/%%p/%%c to their symbols", () => {
    expect(stripMtextFormatting("45%%d %%p0.5 %%c100")).toBe("45° ±0.5 ⌀100");
  });

  it("unescapes a literal double backslash to a single backslash", () => {
    expect(stripMtextFormatting("C:\\\\Users")).toBe("C:\\Users");
  });
});
