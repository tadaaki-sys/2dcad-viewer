import { describe, expect, it } from "vitest";
import { extractLayerStyles } from "./layerStyles";

function dxfWithLayerTable(layerRecords: string[], eol = "\n"): string {
  return [
    "0", "SECTION", "2", "TABLES",
    "0", "TABLE", "2", "LTYPE", "70", "1", "0", "LTYPE", "2", "DASHED", "6", "should-not-be-read", "370", "99", "0", "ENDTAB",
    "0", "TABLE", "2", "LAYER", "70", String(layerRecords.length),
    ...layerRecords.flatMap((record) => record.split("|")),
    "0", "ENDTAB",
    "0", "TABLE", "2", "STYLE", "0", "STYLE", "2", "STANDARD", "6", "ignored", "370", "77", "0", "ENDTAB",
    "0", "ENDSEC", "0", "EOF",
  ].join(eol);
}

describe("extractLayerStyles", () => {
  it("maps each layer name to its linetype and line weight", () => {
    const text = dxfWithLayerTable([
      "0|LAYER|2|CENTER_LINES|70|0|62|1|6|CENTER|370|50",
      "0|LAYER|2|0|70|0|62|7|6|Continuous|370|-3",
      "0|LAYER|2|寸法|70|0|62|3|6|DASHED2|370|18",
    ]);
    const map = extractLayerStyles(text);
    expect(map.get("CENTER_LINES")).toEqual({ lineType: "CENTER", lineWeight: 50 });
    expect(map.get("0")).toEqual({ lineType: "Continuous", lineWeight: -3 });
    expect(map.get("寸法")).toEqual({ lineType: "DASHED2", lineWeight: 18 });
    expect(map.size).toBe(3);
  });

  it("reports null for properties a layer record does not specify", () => {
    const map = extractLayerStyles(dxfWithLayerTable(["0|LAYER|2|A|70|0|62|7", "0|LAYER|2|B|70|0|370|25"]));
    expect(map.get("A")).toEqual({ lineType: null, lineWeight: null });
    expect(map.get("B")).toEqual({ lineType: null, lineWeight: 25 });
  });

  it("does not read groups from other tables", () => {
    const map = extractLayerStyles(dxfWithLayerTable(["0|LAYER|2|A|6|HIDDEN|370|13"]));
    expect([...map.values()]).toEqual([{ lineType: "HIDDEN", lineWeight: 13 }]);
  });

  it("works with CRLF line endings and padded group codes", () => {
    const text = dxfWithLayerTable(["0|LAYER|2|A|6|PHANTOM|370|35"], "\r\n").replace(/^0\r\n/gm, "  0\r\n");
    expect(extractLayerStyles(text).get("A")).toEqual({ lineType: "PHANTOM", lineWeight: 35 });
  });

  it("returns an empty map when there is no LAYER table", () => {
    expect(extractLayerStyles("0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF").size).toBe(0);
  });
});
