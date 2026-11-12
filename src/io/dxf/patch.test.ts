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
    expect(applyDxfEdits({ bytes: bytes, index: index }, {})).toBe(bytes);
    expect(applyDxfEdits({ bytes: bytes, index: index }, { replace: new Map(), remove: new Set() })).toBe(bytes);
  });

  it("removes only the chosen record; every other byte stays identical", () => {
    const text = base();
    const bytes = encode(text);
    const index = indexDxf(bytes);
    const out = applyDxfEdits({ bytes: bytes, index: index }, { remove: new Set([1]) });

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
    const out = applyDxfEdits({ bytes: bytes, index: index }, { replace: new Map([[2, replacement]]) });
    const after = indexDxf(out);
    expect(listRecords(after).map((r) => r.type)).toEqual(["LINE", "CIRCLE", "LINE", "CIRCLE"]);
    expect(recordText(out, "", 2)).toBe(decode(replacement));
    for (const position of [0, 1, 3]) expect(recordText(out, "", position)).toBe(recordText(bytes, "", position));
  });

  it("applies several edits at once, regardless of the order they are given", () => {
    const bytes = encode(base());
    const index = indexDxf(bytes);
    const replacement = encode(["0", "LINE", "5", "EEE", "8", "X", "10", "0", "20", "0", "11", "1", "21", "1", ""].join("\n"));
    const out = applyDxfEdits({ bytes: bytes, index: index }, { remove: new Set([3, 0]), replace: new Map([[2, replacement]]) });
    const after = indexDxf(out);
    expect(listRecords(after).map((r) => r.handle)).toEqual(["101", "EEE"]);
    expect(recordText(out, "", 0)).toBe(recordText(bytes, "", 1));
  });

  it("adds the missing line break to a replacement, using the file's own style (CRLF)", () => {
    const bytes = encode(toCrlf(base()));
    const index = indexDxf(bytes);
    expect(index.eol).toBe("\r\n");
    const noTrailingBreak = encode(["0", "POINT", "5", "AAA", "8", "0", "10", "1", "20", "1"].join("\r\n"));
    const out = applyDxfEdits({ bytes: bytes, index: index }, { replace: new Map([[0, noTrailingBreak]]) });
    const after = indexDxf(out);
    expect(listRecords(after).map((r) => r.type)).toEqual(["POINT", "CIRCLE", "LINE", "CIRCLE"]);
    expect(decode(out)).toContain("20\r\n1\r\n0\r\nCIRCLE");
  });

  it("refuses edits that could corrupt the file", () => {
    const bytes = encode(base());
    const index = indexDxf(bytes);
    const target = { bytes, index };
    const fine = encode(["0", "POINT", "10", "0", "20", "0", ""].join("\n"));
    expect(() => applyDxfEdits(target, { remove: new Set([99]) })).toThrow("範囲外");
    expect(() => applyDxfEdits(target, { remove: new Set([-1]) })).toThrow("範囲外");
    expect(() => applyDxfEdits(target, { remove: new Set([1]), replace: new Map([[1, fine]]) })).toThrow("重複");
    // 別のバイト列の索引は使えない(長さが違う)
    expect(() => applyDxfEdits({ bytes: encode(base() + "\n"), index }, { remove: new Set([0]) })).toThrow("長さが違います");
  });

  it("rejects replacements that are not exactly one complete top-level record (Codex finding 1)", () => {
    const bytes = encode(base());
    const target = { bytes, index: indexDxf(bytes) };
    const reject = (lines: string[], message: string) =>
      expect(() => applyDxfEdits(target, { replace: new Map([[1, encode(lines.join("\n"))]]) })).toThrow(message);
    const line = ["0", "LINE", "8", "0", "10", "0", "20", "0", "11", "1", "21", "1"];

    reject(["0", "ENDSEC", ""], "構造の記録");
    reject(["0", "EOF", ""], "構造の記録");
    reject(["0", ""], "短すぎます");
    reject(["0", "LINE", "10", "0", "20", ""], "対になっていません");
    reject(["LINE", "10", "0", ""], "対になっていません");
    reject(["05", "LINE", ""], "グループコード0の行から始まっていません");
    reject(["abc", "LINE", ""], "数値ではありません");
    reject(["0", "line", "10", "0", ""], "種類として正しくありません");
    reject(["0", "VERTEX", "10", "0", ""], "子の記録");
    // 正しい記録の後ろに、ENDSEC や別の記録を付け足したもの
    reject([...line, "0", "ENDSEC", ""], "続けられない ENDSEC");
    reject([...line, "0", "CIRCLE", "10", "0", "20", "0", "40", "1", ""], "続けられない CIRCLE");
    // 子の記録の並びが正しくないもの
    reject([...line, "0", "ATTRIB", "1", "x", ""], "続けられない ATTRIB");
    reject(["0", "POLYLINE", "8", "0", "0", "VERTEX", "10", "0", "20", "0", ""], "SEQEND で閉じていません");
  });

  it("accepts complete records, including an old-style POLYLINE with its VERTEX and SEQEND", () => {
    const bytes = encode(base());
    const target = { bytes, index: indexDxf(bytes) };
    const polyline = ["0", "POLYLINE", "8", "0", "66", "1", "0", "VERTEX", "10", "0", "20", "0", "0", "VERTEX", "10", "5", "20", "0", "0", "SEQEND", "8", "0", ""];
    const out = applyDxfEdits(target, { replace: new Map([[1, encode(polyline.join("\n"))]]) });
    expect(listRecords(indexDxf(out)).map((r) => r.type)).toEqual(["LINE", "POLYLINE", "LINE", "CIRCLE"]);
    expect(indexDxf(out).malformed).toBeNull();
  });

  it("rejects an index made from a different file of the same length (Codex finding 2)", () => {
    // 記録0と記録1の順番を入れ替えると、ファイルの長さは同じで、記録の境界だけが変わる
    const bytes = encode(base());
    const index = indexDxf(bytes);
    const records = listRecords(index);
    const swapped = encode(
      decode(bytes.subarray(0, records[0].start)) +
        decode(bytes.subarray(records[1].start, records[1].end)) +
        decode(bytes.subarray(records[0].start, records[0].end)) +
        decode(bytes.subarray(records[1].end)),
    );
    expect(swapped.length).toBe(bytes.length);
    expect(() => applyDxfEdits({ bytes: swapped, index }, { remove: new Set([1]) })).toThrow("先頭が一致しません");
  });

  it("refuses to edit a drawing whose structure is broken (Codex finding 3)", () => {
    const truncated = encode(["0", "SECTION", "2", "ENTITIES", "0", "LINE", "8", "0", "10", "1", "20", "1"].join("\n"));
    const index = indexDxf(truncated);
    expect(index.malformed).not.toBeNull();
    expect(() => applyDxfEdits({ bytes: truncated, index }, { remove: new Set([0]) })).toThrow("構造に問題がある図面は編集できません");
  });

  it("does not modify the input bytes", () => {
    const bytes = encode(base());
    const copy = bytes.slice();
    applyDxfEdits({ bytes: bytes, index: indexDxf(bytes) }, { remove: new Set([0, 2]) });
    expect(bytes).toEqual(copy);
  });
});
