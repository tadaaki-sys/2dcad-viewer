import { describe, expect, it } from "vitest";
import { detectDwgVersion, isDwgFileName } from "./dwgFormat";

function bufferFromAscii(text: string, totalBytes = 64): ArrayBuffer {
  const bytes = new Uint8Array(totalBytes);
  bytes.set(new TextEncoder().encode(text), 0);
  return bytes.buffer;
}

describe("detectDwgVersion", () => {
  it("recognizes a DWG by its AC10xx version signature", () => {
    expect(detectDwgVersion(bufferFromAscii("AC1032"))).toEqual({ code: "AC1032", label: "AutoCAD 2018" });
    expect(detectDwgVersion(bufferFromAscii("AC1015"))).toEqual({ code: "AC1015", label: "AutoCAD 2000" });
  });

  it("still treats an unknown AC10xx signature as DWG, with an unknown label", () => {
    expect(detectDwgVersion(bufferFromAscii("AC1099"))).toEqual({ code: "AC1099", label: "不明なバージョン" });
  });

  it("does not treat ASCII DXF text as DWG", () => {
    expect(detectDwgVersion(bufferFromAscii("  0\r\nSECTION\r\n"))).toBeNull();
    expect(detectDwgVersion(bufferFromAscii("999\r\nDXF by tool"))).toBeNull();
  });

  it("returns null for files shorter than the signature", () => {
    expect(detectDwgVersion(new ArrayBuffer(3))).toBeNull();
  });

  it("does not match a signature that merely contains AC10 later in the file", () => {
    expect(detectDwgVersion(bufferFromAscii("XXAC1032"))).toBeNull();
  });
});

describe("isDwgFileName", () => {
  it("matches .dwg case-insensitively and rejects other extensions", () => {
    expect(isDwgFileName("plan.dwg")).toBe(true);
    expect(isDwgFileName("PLAN.DWG")).toBe(true);
    expect(isDwgFileName("plan.dxf")).toBe(false);
    expect(isDwgFileName("dwg")).toBe(false);
  });
});
