import { describe, expect, it } from "vitest";
import { dxfDocument, line, circle, insert, block } from "../../regression/fixtures";
import { indexDxf } from "./rawIndex";
import { addHandles, decode, encode, listRecords, padCodes, toCrlf } from "./testHelpers";

const entitiesDxf = (entities: string[][]) => dxfDocument({ layers: [{ name: "0", color: 7 }], entities });

describe("indexDxf: sections and records", () => {
  it("finds the sections and every top-level entity record with its type", () => {
    const text = entitiesDxf([line("0", 0, 0, 1, 1), circle("0", 5, 5, 2), line("0", 2, 2, 3, 3)]);
    const index = indexDxf(encode(text));
    expect(index.sections.map((s) => s.name)).toEqual(["TABLES", "ENTITIES"]);
    expect(listRecords(index).map((r) => r.type)).toEqual(["LINE", "CIRCLE", "LINE"]);
    expect(index.byteLength).toBe(encode(text).length);
    expect(index.eol).toBe("\n");
  });

  it("gives each record exact byte boundaries that tile the ENTITIES section", () => {
    const text = entitiesDxf([line("0", 0, 0, 1, 1), circle("0", 5, 5, 2)]);
    const bytes = encode(text);
    const index = indexDxf(bytes);
    const [first, second] = listRecords(index);
    expect(decode(bytes.subarray(first.start, first.end))).toBe(["0", "LINE", "8", "0", "10", "0", "20", "0", "11", "1", "21", "1", ""].join("\n"));
    expect(first.end).toBe(second.start); // すき間なく続く
    expect(index.entitiesAppendOffset).toBe(second.end); // 最後の記録の次が「ENDSECの行」
    expect(decode(bytes.subarray(index.entitiesAppendOffset!, index.entitiesAppendOffset! + 11))).toBe("0\nENDSEC\n0\n");
    const entitiesSection = index.sections.find((s) => s.name === "ENTITIES")!;
    expect(decode(bytes.subarray(entitiesSection.start, entitiesSection.start + 8))).toBe("0\nSECTIO");
    expect(entitiesSection.end).toBeGreaterThan(index.entitiesAppendOffset!);
  });

  it("reads the handle (group 5) of each record, or null when there is none", () => {
    const plain = indexDxf(encode(entitiesDxf([line("0", 0, 0, 1, 1)])));
    expect(listRecords(plain)[0].handle).toBeNull();

    const withHandles = indexDxf(encode(addHandles(entitiesDxf([line("0", 0, 0, 1, 1), circle("0", 5, 5, 2)]), 0xa1)));
    expect(listRecords(withHandles).map((r) => r.handle)).toEqual(["A1", "A2"]);
  });

  it("works with CRLF line endings and padded group codes", () => {
    const text = padCodes(entitiesDxf([line("0", 0, 0, 1, 1), circle("0", 5, 5, 2)]));
    const crlf = indexDxf(encode(toCrlf(text)));
    expect(crlf.eol).toBe("\r\n");
    expect(listRecords(crlf).map((r) => r.type)).toEqual(["LINE", "CIRCLE"]);
    expect(crlf.sections.map((s) => s.name)).toEqual(["TABLES", "ENTITIES"]);
  });

  it("treats VERTEX / SEQEND of an old-style POLYLINE as part of one record", () => {
    const polyline = [
      "0", "POLYLINE", "8", "0", "66", "1", "70", "0",
      "0", "VERTEX", "8", "0", "10", "0", "20", "0",
      "0", "VERTEX", "8", "0", "10", "5", "20", "0",
      "0", "SEQEND", "8", "0",
    ];
    const text = entitiesDxf([line("0", 0, 0, 1, 1), polyline, circle("0", 5, 5, 2)]);
    const bytes = encode(text);
    const index = indexDxf(bytes);
    expect(listRecords(index).map((r) => r.type)).toEqual(["LINE", "POLYLINE", "CIRCLE"]);
    const poly = decode(bytes.subarray(listRecords(index)[1].start, listRecords(index)[1].end));
    expect(poly.startsWith("0\nPOLYLINE")).toBe(true);
    expect(poly.match(/VERTEX/g)).toHaveLength(2);
    expect(poly.endsWith("SEQEND\n8\n0\n")).toBe(true);
  });

  it("keeps the ATTRIB records of an INSERT inside the INSERT record, and uses the INSERT's own handle", () => {
    const withAttrib = [
      "0", "INSERT", "5", "AA", "8", "0", "2", "B", "10", "0", "20", "0", "66", "1",
      "0", "ATTRIB", "5", "BB", "8", "0", "1", "value",
      "0", "SEQEND", "5", "CC", "8", "0",
    ];
    const index = indexDxf(encode(entitiesDxf([withAttrib, line("0", 0, 0, 1, 1)])));
    expect(listRecords(index).map((r) => [r.type, r.handle])).toEqual([["INSERT", "AA"], ["LINE", null]]);
  });

  it("does not list the entities inside BLOCKS, only those in ENTITIES", () => {
    const text = dxfDocument({
      layers: [{ name: "0", color: 7 }],
      blocks: [block("UNIT", [line("0", 0, 0, 1, 0), circle("0", 5, 5, 1)])],
      entities: [insert("0", "UNIT", 0, 0)],
    });
    const index = indexDxf(encode(text));
    expect(index.sections.map((s) => s.name)).toEqual(["TABLES", "BLOCKS", "ENTITIES"]);
    expect(listRecords(index).map((r) => r.type)).toEqual(["INSERT"]);
  });

  it("copes with a file that has no trailing newline", () => {
    const bytes = encode(entitiesDxf([line("0", 0, 0, 1, 1)]).trimEnd());
    const index = indexDxf(bytes);
    expect(listRecords(index).map((r) => r.type)).toEqual(["LINE"]);
  });

  it("is not confused by non-ASCII bytes (Shift_JIS) inside values", () => {
    const head = encode(["0", "SECTION", "2", "ENTITIES", "0", "TEXT", "8", ""].join("\n"));
    const sjis = Uint8Array.of(0x83, 0x41, 0x83, 0x43); // 「アイ」のShift_JIS
    const tail = encode(["", "1", "x", "0", "LINE", "8", "0", "0", "ENDSEC", "0", "EOF", ""].join("\n"));
    const bytes = new Uint8Array(head.length + sjis.length + tail.length);
    bytes.set(head, 0);
    bytes.set(sjis, head.length);
    bytes.set(tail, head.length + sjis.length);
    const index = indexDxf(bytes);
    expect(listRecords(index).map((r) => r.type)).toEqual(["TEXT", "LINE"]);
  });

  it("does not throw for empty, garbage or truncated input and reports what it could read", () => {
    expect(listRecords(indexDxf(new Uint8Array(0)))).toEqual([]);
    expect(listRecords(indexDxf(encode("this is not a dxf file")))).toEqual([]);
    expect(indexDxf(Uint8Array.of(0, 1, 2, 3, 0xff, 0xfe)).sections).toEqual([]);

    const truncated = encode(["0", "SECTION", "2", "ENTITIES", "0", "LINE", "8", "0", "10", "1"].join("\n"));
    const index = indexDxf(truncated);
    expect(listRecords(index)).toHaveLength(1);
    expect(listRecords(index)[0].end).toBe(truncated.length);
    expect(index.entitiesAppendOffset).toBeNull();
  });

  it("returns an empty entity list when the ENTITIES section is empty", () => {
    const index = indexDxf(encode(entitiesDxf([])));
    expect(listRecords(index)).toEqual([]);
    expect(index.entitiesAppendOffset).not.toBeNull();
    expect(index.malformed).toBeNull();
  });
});

describe("indexDxf: structure checks (a broken structure makes the drawing read only)", () => {
  const polylineWithVertices = [
    "0", "POLYLINE", "8", "0", "66", "1",
    "0", "VERTEX", "8", "0", "10", "0", "20", "0",
    "0", "SEQEND", "8", "0",
  ];

  it("reports no problem for well-formed drawings", () => {
    const withAttrib = ["0", "INSERT", "8", "0", "2", "B", "66", "1", "0", "ATTRIB", "1", "v", "0", "SEQEND", "8", "0"];
    const index = indexDxf(encode(toCrlf(padCodes(addHandles(entitiesDxf([line("0", 0, 0, 1, 1), polylineWithVertices, withAttrib, insert("0", "B", 0, 0)]))))));
    expect(index.malformed).toBeNull();
    expect(listRecords(index).map((r) => r.type)).toEqual(["LINE", "POLYLINE", "INSERT", "INSERT"]);
  });

  it("keeps a child record that its parent cannot have (ATTRIB after LINE) as its own record, and flags it (Codex finding 4)", () => {
    const strayAttrib = ["0", "ATTRIB", "8", "0", "1", "x"];
    const bytes = encode(entitiesDxf([line("0", 0, 0, 1, 1), strayAttrib, circle("0", 5, 5, 1)]));
    const index = indexDxf(bytes);
    // ATTRIBはLINEに吸収されない(LINEを消しても、ATTRIBは残る)
    expect(listRecords(index).map((r) => r.type)).toEqual(["LINE", "ATTRIB", "CIRCLE"]);
    expect(decode(bytes.subarray(listRecords(index)[0].start, listRecords(index)[0].end))).not.toContain("ATTRIB");
    expect(index.malformed).toContain("続けられない ATTRIB");
  });

  it("flags child records after SEQEND, a POLYLINE without SEQEND, and a leading child record", () => {
    const afterSeqend = [...polylineWithVertices, "0", "VERTEX", "10", "1", "20", "1"];
    expect(indexDxf(encode(entitiesDxf([afterSeqend]))).malformed).toContain("続けられない VERTEX");

    const noSeqend = ["0", "POLYLINE", "8", "0", "0", "VERTEX", "10", "0", "20", "0"];
    expect(indexDxf(encode(entitiesDxf([noSeqend, line("0", 0, 0, 1, 1)]))).malformed).toContain("SEQEND で終わっていません");

    expect(indexDxf(encode(entitiesDxf([["0", "SEQEND", "8", "0"], line("0", 0, 0, 1, 1)]))).malformed).not.toBeNull();
  });

  it("flags a file whose ENTITIES section is not closed, missing, or ends in the middle of a pair (Codex finding 3)", () => {
    const unclosed = encode(["0", "SECTION", "2", "ENTITIES", "0", "LINE", "8", "0", "10", "1", "20", "1"].join("\n"));
    expect(indexDxf(unclosed).malformed).toContain("閉じられていません");

    expect(indexDxf(encode("0\nSECTION\n2\nHEADER\n0\nENDSEC\n0\nEOF\n")).malformed).toContain("ありません");
    expect(indexDxf(new Uint8Array(0)).malformed).not.toBeNull();

    const danglingCode = encode(entitiesDxf([line("0", 0, 0, 1, 1)]) + "\n0\n");
    expect(indexDxf(danglingCode).malformed).not.toBeNull();
  });

  it("does not wrap around when there are more than 65,536 kinds of record types (Codex finding 5)", () => {
    const kinds = 65_540;
    const lines = ["0", "SECTION", "2", "ENTITIES"];
    for (let i = 0; i < kinds; i++) lines.push("0", `T${i}`);
    lines.push("0", "ENDSEC", "0", "EOF", "");
    const index = indexDxf(encode(lines.join("\n")));
    expect(index.recordCount).toBe(kinds);
    expect(index.typeNames).toHaveLength(kinds);
    expect(listRecords(index)[kinds - 1].type).toBe(`T${kinds - 1}`);
    expect(listRecords(index)[65_536].type).toBe("T65536");
  });
});
