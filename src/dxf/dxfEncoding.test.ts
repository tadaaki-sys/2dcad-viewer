import { describe, expect, it } from "vitest";
import { decodeDxfBuffer, detectDxfTextEncoding } from "./dxfEncoding";

function buildHeaderBuffer(acadver: string, codepage?: string, tailBytes: Uint8Array = new Uint8Array()): ArrayBuffer {
  const lines = ["0", "SECTION", "2", "HEADER", "9", "$ACADVER", "1", acadver];
  if (codepage) {
    lines.push("9", "$DWGCODEPAGE", "3", codepage);
  }
  lines.push("0", "ENDSEC", "0", "EOF");
  const headerBytes = new TextEncoder().encode(lines.join("\n") + "\n");
  const combined = new Uint8Array(headerBytes.length + tailBytes.length);
  combined.set(headerBytes, 0);
  combined.set(tailBytes, headerBytes.length);
  return combined.buffer;
}

describe("detectDxfTextEncoding", () => {
  it("treats DXF R2007+ (AC1021 and above) as UTF-8 regardless of codepage", () => {
    expect(detectDxfTextEncoding(buildHeaderBuffer("AC1024", "ANSI_932"))).toBe("utf-8");
    expect(detectDxfTextEncoding(buildHeaderBuffer("AC1021"))).toBe("utf-8");
  });

  it("maps ANSI_932 (Shift-JIS) for pre-R2007 DXF versions", () => {
    expect(detectDxfTextEncoding(buildHeaderBuffer("AC1015", "ANSI_932"))).toBe("shift-jis");
  });

  it("maps ANSI_1252 for pre-R2007 DXF versions", () => {
    expect(detectDxfTextEncoding(buildHeaderBuffer("AC1015", "ANSI_1252"))).toBe("windows-1252");
  });

  it("falls back to UTF-8 when no codepage is present", () => {
    expect(detectDxfTextEncoding(buildHeaderBuffer("AC1015"))).toBe("utf-8");
  });

  it("falls back to UTF-8 for an unrecognized codepage", () => {
    expect(detectDxfTextEncoding(buildHeaderBuffer("AC1015", "ANSI_99999"))).toBe("utf-8");
  });
});

describe("decodeDxfBuffer", () => {
  it("correctly decodes Shift-JIS text in a pre-R2007 file", () => {
    // "日本語" encoded as Shift-JIS (CP932)
    const shiftJisBytes = new Uint8Array([0x93, 0xfa, 0x96, 0x7b, 0x8c, 0xea]);
    const buffer = buildHeaderBuffer("AC1015", "ANSI_932", shiftJisBytes);

    const text = decodeDxfBuffer(buffer);

    expect(text).toContain("日本語");
  });

  it("decodes UTF-8 text normally for modern DXF versions", () => {
    const utf8Bytes = new TextEncoder().encode("日本語レイヤー");
    const buffer = buildHeaderBuffer("AC1024", undefined, utf8Bytes);

    const text = decodeDxfBuffer(buffer);

    expect(text).toContain("日本語レイヤー");
  });
});
