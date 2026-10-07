import { describe, expect, it } from "vitest";
import { extractLayerLineTypes } from "./layerLineTypes";

function dxfWithLayerTable(layerRecords: string[], eol = "\n"): string {
  return [
    "0", "SECTION", "2", "TABLES",
    "0", "TABLE", "2", "LTYPE", "70", "1", "0", "LTYPE", "2", "DASHED", "6", "should-not-be-read", "0", "ENDTAB",
    "0", "TABLE", "2", "LAYER", "70", String(layerRecords.length),
    ...layerRecords.flatMap((record) => record.split("|")),
    "0", "ENDTAB",
    "0", "TABLE", "2", "STYLE", "0", "STYLE", "2", "STANDARD", "6", "ignored", "0", "ENDTAB",
    "0", "ENDSEC", "0", "EOF",
  ].join(eol);
}

describe("extractLayerLineTypes", () => {
  it("maps each layer name to its linetype", () => {
    const text = dxfWithLayerTable([
      "0|LAYER|2|CENTER_LINES|70|0|62|1|6|CENTER",
      "0|LAYER|2|0|70|0|62|7|6|Continuous",
      "0|LAYER|2|寸法|70|0|62|3|6|DASHED2",
    ]);
    const map = extractLayerLineTypes(text);
    expect(map.get("CENTER_LINES")).toBe("CENTER");
    expect(map.get("0")).toBe("Continuous");
    expect(map.get("寸法")).toBe("DASHED2");
    expect(map.size).toBe(3);
  });

  it("does not read linetype groups from other tables", () => {
    const map = extractLayerLineTypes(dxfWithLayerTable(["0|LAYER|2|A|6|HIDDEN"]));
    expect([...map.values()]).toEqual(["HIDDEN"]);
  });

  it("works with CRLF line endings and padded group codes", () => {
    const text = dxfWithLayerTable(["0|LAYER|2|A|6|PHANTOM"], "\r\n").replace(/^0\r\n/gm, "  0\r\n");
    expect(extractLayerLineTypes(text).get("A")).toBe("PHANTOM");
  });

  it("returns an empty map when there is no LAYER table", () => {
    expect(extractLayerLineTypes("0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF").size).toBe(0);
  });
});
