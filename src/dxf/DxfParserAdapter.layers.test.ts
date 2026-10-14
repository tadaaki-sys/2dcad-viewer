import { describe, expect, it } from "vitest";
import DxfParser from "dxf-parser";
import { convertToCadModel, parseDxfText } from "./DxfParserAdapter";
import { extractLayerStyles } from "./layerStyles";

const layerRecord = (name: string, flags: number, color: number) => ["0", "LAYER", "2", name, "70", String(flags), "62", String(color), "6", "CONTINUOUS"];

function dxf(layers: string[][], usedLayers: string[]): string {
  const lines = (layer: string) => ["0", "LINE", "8", layer, "10", "0", "20", "0", "11", "1", "21", "0"];
  return [
    "0", "SECTION", "2", "TABLES", "0", "TABLE", "2", "LAYER", ...layers.flat(), "0", "ENDTAB", "0", "ENDSEC",
    "0", "SECTION", "2", "ENTITIES", ...usedLayers.flatMap(lines), "0", "ENDSEC", "0", "EOF",
  ].join("\n");
}

const visibilityOf = (model: ReturnType<typeof parseDxfText>) => Object.fromEntries(model.layers.map((l) => [l.name, l.visible]));

describe("initial layer visibility", () => {
  const text = dxf(
    [layerRecord("ON", 0, 7), layerRecord("OFF", 0, -7), layerRecord("FROZEN", 1, 7), layerRecord("NEWVP", 2, 7), layerRecord("LOCKED", 4, 7)],
    ["ON", "OFF", "FROZEN", "NEWVP", "LOCKED", "UNDECLARED"],
  );

  it("hides layers that are OFF (negative color) or frozen in the file", () => {
    expect(visibilityOf(parseDxfText(text))).toEqual({
      ON: true,
      OFF: false,
      FROZEN: false,
      NEWVP: true, // 新規ビューポートでフリーズ(ビット2)は、このレイヤー自体の表示には影響しない
      LOCKED: true, // ロックしても表示される
      UNDECLARED: true, // レイヤー表に無い(図形だけが参照している)レイヤーは表示する
    });
  });

  it("ignores the OFF flag but keeps the frozen flag for DWG-converted DXF, whose color signs are unreliable", () => {
    const raw = new DxfParser().parseSync(text)!;
    const model = convertToCadModel(raw, { layerStyles: extractLayerStyles(text), ignoreLayerOffFlag: true });
    expect(visibilityOf(model)).toMatchObject({ ON: true, OFF: true, FROZEN: false });
  });

  it("keeps entities of hidden layers in the model so that turning the layer on shows them", () => {
    const model = parseDxfText(text);
    expect(model.entities.filter((e) => e.layer === "OFF")).toHaveLength(1);
  });
});
