import { describe, expect, it } from "vitest";
import { circle, dxfDocument, line } from "../../regression/fixtures";
import { applyDxfEdits } from "./patch";
import { indexDxf } from "./rawIndex";
import { addHandles, decode, encode, listRecords, toCrlf } from "./testHelpers";

const base = () =>
  addHandles(
    dxfDocument({
      layers: [{ name: "0", color: 7 }],
      entities: [line("0", 0, 0, 1, 1), circle("0", 5, 5, 2), line("0", 2, 2, 3, 3), circle("0", 9, 9, 4)],
    }),
  );

const recordText = (bytes: Uint8Array, text: string, position: number) => {
  const r = listRecords(indexDxf(bytes))[position];
  void text;
  return decode(bytes.subarray(r.start, r.end));
};

describe("applyDxfEdits", () => {
  it("returns the very same bytes when there are no edits", () => {
    const bytes = encode(base());
    const index = indexDxf(bytes);
    expect(applyDxfEdits(bytes, index, {})).toBe(bytes);
    expect(applyDxfEdits(bytes, index, { replace: new Map(), remove: new Set() })).toBe(bytes);
  });

  it("removes only the chosen record; every other byte stays identical", () => {
    const text = base();
    const bytes = encode(text);
    const index = indexDxf(bytes);
    const out = applyDxfEdits(bytes, index, { remove: new Set([1]) });

    const removed = listRecords(index)[1];
    const expected = decode(bytes.subarray(0, removed.start)) + decode(bytes.subarray(removed.end));
    expect(decode(out)).toBe(expected);
    expect(out.length).toBe(bytes.length - (removed.end - removed.start));

    const after = indexDxf(out);
    expect(listRecords(after).map((r) => r.type)).toEqual(["LINE", "LINE", "CIRCLE"]);
    // 残った記録は、元の記録とバイトで同じ
    expect(recordText(out, "", 0)).toBe(recordText(bytes, "", 0));
    expect(recordText(out, "", 1)).toBe(recordText(bytes, "", 2));
    expect(recordText(out, "", 2)).toBe(recordText(bytes, "", 3));
  });

  it("replaces a record with new bytes and leaves the rest untouched", () => {
    const bytes = encode(base());
    const index = indexDxf(bytes);
    const replacement = encode(["0", "LINE", "5", "FFF", "8", "NEWLAYER", "10", "7", "20", "7", "11", "8", "21", "8", ""].join("\n"));
    const out = applyDxfEdits(bytes, index, { replace: new Map([[2, replacement]]) });
    const after = indexDxf(out);
    expect(listRecords(after).map((r) => r.type)).toEqual(["LINE", "CIRCLE", "LINE", "CIRCLE"]);
    expect(recordText(out, "", 2)).toBe(decode(replacement));
    for (const position of [0, 1, 3]) expect(recordText(out, "", position)).toBe(recordText(bytes, "", position));
  });

  it("applies several edits at once, regardless of the order they are given", () => {
    const bytes = encode(base());
    const index = indexDxf(bytes);
    const replacement = encode(["0", "LINE", "5", "EEE", "8", "X", "10", "0", "20", "0", "11", "1", "21", "1", ""].join("\n"));
    const out = applyDxfEdits(bytes, index, { remove: new Set([3, 0]), replace: new Map([[2, replacement]]) });
    const after = indexDxf(out);
    expect(listRecords(after).map((r) => r.handle)).toEqual(["101", "EEE"]);
    expect(recordText(out, "", 0)).toBe(recordText(bytes, "", 1));
  });

  it("adds the missing line break to a replacement, using the file's own style (CRLF)", () => {
    const bytes = encode(toCrlf(base()));
    const index = indexDxf(bytes);
    expect(index.eol).toBe("\r\n");
    const noTrailingBreak = encode(["0", "POINT", "5", "AAA", "8", "0", "10", "1", "20", "1"].join("\r\n"));
    const out = applyDxfEdits(bytes, index, { replace: new Map([[0, noTrailingBreak]]) });
    const after = indexDxf(out);
    expect(listRecords(after).map((r) => r.type)).toEqual(["POINT", "CIRCLE", "LINE", "CIRCLE"]);
    expect(decode(out)).toContain("20\r\n1\r\n0\r\nCIRCLE");
  });

  it("refuses edits that could corrupt the file", () => {
    const bytes = encode(base());
    const index = indexDxf(bytes);
    const fine = encode(["0", "POINT", "10", "0", "20", "0", ""].join("\n"));
    expect(() => applyDxfEdits(bytes, index, { remove: new Set([99]) })).toThrow("範囲外");
    expect(() => applyDxfEdits(bytes, index, { remove: new Set([-1]) })).toThrow("範囲外");
    expect(() => applyDxfEdits(bytes, index, { remove: new Set([1]), replace: new Map([[1, fine]]) })).toThrow("重複");
    expect(() => applyDxfEdits(bytes, index, { replace: new Map([[1, encode("LINE\n10\n0\n")]]) })).toThrow("グループコード0");
    expect(() => applyDxfEdits(bytes, index, { replace: new Map([[1, encode("05\nLINE\n")]]) })).toThrow("グループコード0");
    // 別のバイト列の索引は使えない
    expect(() => applyDxfEdits(encode(base() + "\n"), index, { remove: new Set([0]) })).toThrow("長さが違います");
  });

  it("does not modify the input bytes", () => {
    const bytes = encode(base());
    const copy = bytes.slice();
    applyDxfEdits(bytes, indexDxf(bytes), { remove: new Set([0, 2]) });
    expect(bytes).toEqual(copy);
  });
});
