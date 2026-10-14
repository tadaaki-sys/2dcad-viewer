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
    expect(map.get("CENTER_LINES")).toEqual({ lineType: "CENTER", lineWeight: 50, off: false, frozen: false });
    expect(map.get("0")).toEqual({ lineType: "Continuous", lineWeight: -3, off: false, frozen: false });
    expect(map.get("寸法")).toEqual({ lineType: "DASHED2", lineWeight: 18, off: false, frozen: false });
    expect(map.size).toBe(3);
  });

  it("does not stop at a layer whose name contains ENDTAB", () => {
    const text = dxfWithLayerTable([
      "0|LAYER|2|MY_ENDTAB_LAYER|70|0|62|1|6|CENTER|370|50",
      "0|LAYER|2|NEXT|70|0|62|1|6|DASHED|370|25",
    ]);
    const map = extractLayerStyles(text);
    expect(map.get("MY_ENDTAB_LAYER")).toEqual({ lineType: "CENTER", lineWeight: 50, off: false, frozen: false });
    expect(map.get("NEXT")).toEqual({ lineType: "DASHED", lineWeight: 25, off: false, frozen: false });
  });

  it("reports null for properties a layer record does not specify", () => {
    const map = extractLayerStyles(dxfWithLayerTable(["0|LAYER|2|A|70|0|62|7", "0|LAYER|2|B|70|0|370|25"]));
    expect(map.get("A")).toEqual({ lineType: null, lineWeight: null, off: false, frozen: false });
    expect(map.get("B")).toEqual({ lineType: null, lineWeight: 25, off: false, frozen: false });
  });

  it("does not read groups from other tables", () => {
    const map = extractLayerStyles(dxfWithLayerTable(["0|LAYER|2|A|6|HIDDEN|370|13"]));
    expect([...map.values()]).toEqual([{ lineType: "HIDDEN", lineWeight: 13, off: false, frozen: false }]);
  });

  it("works with CRLF line endings and padded group codes", () => {
    const text = dxfWithLayerTable(["0|LAYER|2|A|6|PHANTOM|370|35"], "\r\n").replace(/^0\r\n/gm, "  0\r\n");
    expect(extractLayerStyles(text).get("A")).toEqual({ lineType: "PHANTOM", lineWeight: 35, off: false, frozen: false });
  });

  it("reads the OFF state (negative color) and the frozen flag (bit 1) of each layer", () => {
    const map = extractLayerStyles(
      dxfWithLayerTable([
        "0|LAYER|2|ON|70|0|62|7",
        "0|LAYER|2|OFF|70|0|62|-7",
        "0|LAYER|2|FROZEN|70|1|62|7",
        "0|LAYER|2|NEWVP|70|2|62|7",
        "0|LAYER|2|LOCKED|70|4|62|7",
        "0|LAYER|2|BOTH|70|5|62|-3",
      ]),
    );
    const state = (name: string) => [map.get(name)?.off, map.get(name)?.frozen];
    expect(state("ON")).toEqual([false, false]);
    expect(state("OFF")).toEqual([true, false]);
    expect(state("FROZEN")).toEqual([false, true]);
    // ビット2(新規ビューポートでフリーズ)とビット4(ロック)は、このレイヤー自体の表示には影響しない
    expect(state("NEWVP")).toEqual([false, false]);
    expect(state("LOCKED")).toEqual([false, false]);
    expect(state("BOTH")).toEqual([true, true]);
  });

  it("returns an empty map when there is no LAYER table", () => {
    expect(extractLayerStyles("0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF").size).toBe(0);
  });
});
