import { describe, expect, it } from "vitest";
import { parseDxfText } from "./DxfParserAdapter";

function buildDxf(entitiesSection: string, tablesSection = ""): string {
  return [
    "0",
    "SECTION",
    "2",
    "TABLES",
    tablesSection,
    "0",
    "ENDSEC",
    "0",
    "SECTION",
    "2",
    "ENTITIES",
    entitiesSection,
    "0",
    "ENDSEC",
    "0",
    "EOF",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

const LAYER_TABLE = [
  "0",
  "TABLE",
  "2",
  "LAYER",
  "0",
  "LAYER",
  "2",
  "CONVEYOR",
  "70",
  "0",
  "62",
  "5",
  "6",
  "CONTINUOUS",
  "0",
  "ENDTAB",
].join("\n");

describe("DxfParserAdapter", () => {
  it("converts a LINE entity into a CadLine", () => {
    const dxf = buildDxf(
      ["0", "LINE", "8", "CONVEYOR", "10", "0.0", "20", "0.0", "11", "100.0", "21", "50.0"].join("\n"),
      LAYER_TABLE,
    );

    const model = parseDxfText(dxf);

    expect(model.entities).toHaveLength(1);
    const entity = model.entities[0];
    expect(entity.type).toBe("LINE");
    if (entity.type === "LINE") {
      expect(entity.start).toEqual({ x: 0, y: 0 });
      expect(entity.end).toEqual({ x: 100, y: 50 });
      expect(entity.layer).toBe("CONVEYOR");
    }
    expect(model.stats.totalEntityCount).toBe(1);
    expect(model.stats.supportedEntityCount).toBe(1);
    expect(model.stats.unsupportedEntityCount).toBe(0);
  });

  it("marks a closed LWPOLYLINE correctly", () => {
    const dxf = buildDxf(
      [
        "0",
        "LWPOLYLINE",
        "8",
        "FLOOR",
        "90",
        "3",
        "70",
        "1",
        "10",
        "0.0",
        "20",
        "0.0",
        "10",
        "10.0",
        "20",
        "0.0",
        "10",
        "10.0",
        "20",
        "10.0",
      ].join("\n"),
    );

    const model = parseDxfText(dxf);

    expect(model.entities).toHaveLength(1);
    const entity = model.entities[0];
    expect(entity.type).toBe("LWPOLYLINE");
    if (entity.type === "LWPOLYLINE" || entity.type === "POLYLINE") {
      expect(entity.closed).toBe(true);
      expect(entity.vertices).toHaveLength(3);
    }
  });

  it("aggregates unsupported entities by type instead of dropping them silently", () => {
    const dxf = buildDxf(
      [
        "0",
        "LINE",
        "8",
        "0",
        "10",
        "0.0",
        "20",
        "0.0",
        "11",
        "10.0",
        "21",
        "0.0",
        "0",
        "CIRCLE",
        "8",
        "0",
        "10",
        "5.0",
        "20",
        "5.0",
        "40",
        "2.0",
        "0",
        "TEXT",
        "8",
        "0",
        "1",
        "hello",
        "10",
        "0.0",
        "20",
        "0.0",
        "40",
        "5.0",
        "0",
        "CIRCLE",
        "8",
        "0",
        "10",
        "1.0",
        "20",
        "1.0",
        "40",
        "1.0",
      ].join("\n"),
    );

    const model = parseDxfText(dxf);

    expect(model.stats.totalEntityCount).toBe(4);
    expect(model.stats.supportedEntityCount).toBe(1);
    expect(model.stats.unsupportedEntityCount).toBe(3);
    expect(model.stats.unsupportedBreakdown).toEqual({ CIRCLE: 2, TEXT: 1 });
  });

  it("excludes paper space entities from the model", () => {
    const dxf = buildDxf(
      [
        "0",
        "LINE",
        "8",
        "0",
        "67",
        "1",
        "10",
        "0.0",
        "20",
        "0.0",
        "11",
        "10.0",
        "21",
        "0.0",
        "0",
        "LINE",
        "8",
        "0",
        "10",
        "0.0",
        "20",
        "0.0",
        "11",
        "20.0",
        "21",
        "0.0",
      ].join("\n"),
    );

    const model = parseDxfText(dxf);

    expect(model.stats.totalEntityCount).toBe(1);
    expect(model.entities).toHaveLength(1);
  });

  it("computes bounds across all supported entities", () => {
    const dxf = buildDxf(
      [
        "0",
        "LINE",
        "8",
        "0",
        "10",
        "-10.0",
        "20",
        "0.0",
        "11",
        "10.0",
        "21",
        "0.0",
        "0",
        "LINE",
        "8",
        "0",
        "10",
        "0.0",
        "20",
        "0.0",
        "11",
        "0.0",
        "21",
        "30.0",
      ].join("\n"),
    );

    const model = parseDxfText(dxf);

    expect(model.bounds).toEqual({ min: { x: -10, y: 0 }, max: { x: 10, y: 30 } });
  });

  it("includes layers referenced only by entities, not declared in the LAYER table", () => {
    // 多くのDXFはデフォルトレイヤー"0"をLAYERテーブルに明記しない。
    // レイヤーパネルに現れないと該当Entityが永久に非表示になってしまうため、必ず一覧に含める。
    const dxf = buildDxf(
      ["0", "LINE", "8", "0", "10", "0.0", "20", "0.0", "11", "10.0", "21", "0.0"].join("\n"),
    );

    const model = parseDxfText(dxf);

    expect(model.layers).toEqual([{ name: "0", color: "#ffffff", visible: true }]);
  });

  it("returns null bounds when there are no supported entities", () => {
    const dxf = buildDxf(["0", "CIRCLE", "8", "0", "10", "0.0", "20", "0.0", "40", "1.0"].join("\n"));

    const model = parseDxfText(dxf);

    expect(model.bounds).toBeNull();
  });
});
