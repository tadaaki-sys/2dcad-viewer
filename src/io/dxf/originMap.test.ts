import { describe, expect, it } from "vitest";
import { dxfDocument, factoryLayoutDxf, line, nestedBlocksDxf, smallDxf, unsupportedDxf } from "../../regression/fixtures";
import { mapParserEntitiesToRecords } from "./originMap";
import { indexDxf } from "./rawIndex";
import { buildDxfSource, summarizeSource, transferablesOf } from "./source";
import { addHandles, encode, listRecords, openDxf, recordOfEntity } from "./testHelpers";

describe("mapParserEntitiesToRecords", () => {
  const index = indexDxf(encode(addHandles(dxfDocument({ layers: [], entities: [line("0", 0, 0, 1, 1), ["0", "VIEWPORT", "8", "0"], line("0", 2, 2, 3, 3)] }))));

  it("skips records the parser dropped (VIEWPORT) and maps the rest in order", () => {
    const map = mapParserEntitiesToRecords(index, [
      { type: "LINE", handle: "100" },
      { type: "LINE", handle: "102" },
    ]);
    expect(Array.from(map!)).toEqual([0, 2]);
  });

  it("fails (null) when the parser has an entity that cannot be matched", () => {
    expect(mapParserEntitiesToRecords(index, [{ type: "CIRCLE" }])).toBeNull();
    expect(mapParserEntitiesToRecords(index, [{ type: "LINE", handle: "100" }, { type: "LINE", handle: "999" }])).toBeNull();
  });

  it("falls back to matching by type alone when a handle cannot be read as hex (the count check still guards against mix-ups)", () => {
    expect(Array.from(mapParserEntitiesToRecords(index, [{ type: "LINE", handle: "100" }, { type: "LINE", handle: "not-hex" }])!)).toEqual([0, 2]);
  });

  it("fails (null) when only some entities of a type were dropped, since they could be mixed up", () => {
    // 記録にはLINEが2つあるのに、解析器が1つしか返していない(どちらか不明)
    expect(mapParserEntitiesToRecords(index, [{ type: "LINE" }])).toBeNull();
  });

  it("maps an empty parser list to an empty map", () => {
    expect(Array.from(mapParserEntitiesToRecords(index, [])!)).toEqual([]);
  });
});

describe("origin of each model entity and classification of records", () => {
  it("links top-level entities to their record and block products to the INSERT / DIMENSION record", () => {
    const opened = openDxf(factoryLayoutDxf());
    const { source, model, origin } = opened;
    expect(source.recordOfParserEntity).not.toBeNull();
    expect(origin.parserIndex.length).toBe(model.entities.length);
    expect(origin.nested.length).toBe(model.entities.length);

    const records = listRecords(source.index);
    model.entities.forEach((entity, i) => {
      const record = records[recordOfEntity(opened, i)];
      expect(record).toBeDefined();
      if (origin.nested[i] === 0) {
        // 最上位の図形: 記録の種類が図形の種類と対応する
        const expectedTypes: Record<string, string[]> = {
          LINE: ["LINE"],
          CIRCLE: ["CIRCLE"],
          ARC: ["ARC"],
          ELLIPSE: ["ELLIPSE"],
          LWPOLYLINE: ["LWPOLYLINE"],
          SPLINE: ["SPLINE"],
          TEXT: ["TEXT", "MTEXT"],
          POINT: ["POINT"],
        };
        expect(expectedTypes[entity.type]).toContain(record.type);
      } else {
        expect(["INSERT", "DIMENSION"]).toContain(record.type);
      }
    });
  });

  it("classifies the factory drawing: 13 editable, 4 read-only (3 INSERT + 1 DIMENSION), 0 unsupported", () => {
    const { source } = openDxf(factoryLayoutDxf());
    expect(listRecords(source.index)).toHaveLength(17);
    expect(source.classification).toEqual({ editable: 13, readOnly: 4, unsupported: 0, unsupportedByType: {} });
  });

  it("counts records that did not become entities (SOLID) as unsupported but keeps them", () => {
    const { source } = openDxf(unsupportedDxf());
    expect(source.classification).toEqual({ editable: 1, readOnly: 0, unsupported: 1, unsupportedByType: { SOLID: 1 } });
  });

  it("includes records the parser silently drops (VIEWPORT) as unsupported", () => {
    const text = dxfDocument({ layers: [{ name: "0", color: 7 }], entities: [line("0", 0, 0, 1, 1), ["0", "VIEWPORT", "8", "0", "10", "0", "20", "0"], line("0", 1, 1, 2, 2)] });
    const { source, model } = openDxf(addHandles(text));
    expect(model.entities).toHaveLength(2);
    expect(listRecords(source.index).map((r) => r.type)).toEqual(["LINE", "VIEWPORT", "LINE"]);
    expect(source.classification).toEqual({ editable: 2, readOnly: 0, unsupported: 1, unsupportedByType: { VIEWPORT: 1 } });
  });

  it("works for drawings without handles and for deeply nested blocks", () => {
    expect(openDxf(smallDxf()).source.classification).toEqual({ editable: 1, readOnly: 0, unsupported: 0, unsupportedByType: {} });
    const nested = openDxf(nestedBlocksDxf(40));
    expect(nested.source.classification).toEqual({ editable: 0, readOnly: 1, unsupported: 0, unsupportedByType: {} });
    expect(nested.origin.nested[0]).toBe(1);
  });

  it("does not change the model compared with the plain conversion (the origin is a separate output)", async () => {
    const { parseDxfText } = await import("../../dxf/DxfParserAdapter");
    const text = factoryLayoutDxf();
    expect(openDxf(text).model).toEqual(parseDxfText(text));
  });
});

describe("buildDxfSource and its summary", () => {
  it("summarizes the source for the dev overlay", () => {
    const { source } = openDxf(addHandles(factoryLayoutDxf()));
    const summary = summarizeSource(source)!;
    expect(summary).toMatchObject({ recordCount: 17, mapped: true, editable: 13, readOnly: 4, unsupported: 0 });
    expect(summary.byteLength).toBe(source.bytes.length);
    expect(summarizeSource(null)).toBeNull();
  });

  it("keeps a source without a mapping (read only) when the parser result cannot be matched", () => {
    const origin = { parserIndex: new Int32Array(0), nested: new Uint8Array(0) };
    const source = buildDxfSource(encode(smallDxf()), [{ type: "CIRCLE" }], origin)!;
    expect(source.recordOfParserEntity).toBeNull();
    expect(source.classification).toBeNull();
    expect(summarizeSource(source)).toMatchObject({ mapped: false, editable: 0 });
  });

  it("does not map (= read only) a drawing whose structure is broken, even if the parser result would match (Codex finding 3)", () => {
    const truncated = encode(["0", "SECTION", "2", "ENTITIES", "0", "LINE", "8", "0", "10", "1"].join("\n"));
    const origin = { parserIndex: Int32Array.of(0), nested: Uint8Array.of(0) };
    const source = buildDxfSource(truncated, [{ type: "LINE" }], origin)!;
    expect(source.index.malformed).not.toBeNull();
    expect(source.recordOfParserEntity).toBeNull();
    expect(source.classification).toBeNull();
    expect(summarizeSource(source)).toMatchObject({ mapped: false });
  });

  it("lists every buffer to transfer exactly once", () => {
    const { source } = openDxf(factoryLayoutDxf());
    const buffers = transferablesOf(source);
    expect(new Set(buffers).size).toBe(buffers.length);
    expect(buffers).toContain(source.bytes.buffer);
    expect(buffers).toContain(source.origin.parserIndex.buffer);
  });
});
