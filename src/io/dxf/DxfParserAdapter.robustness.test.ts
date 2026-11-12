import { describe, expect, it } from "vitest";
import { parseDxfText } from "./DxfParserAdapter";
import { normalizeArcSpan, pointOnEllipse } from "../utils/geometry";

function buildDxfWithBlocks(entitiesSection: string, blocksSection = ""): string {
  return [
    "0",
    "SECTION",
    "2",
    "BLOCKS",
    blocksSection,
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

function blockDef(name: string, entitiesLines: string): string {
  return ["0", "BLOCK", "8", "0", "2", name, "70", "0", "10", "0", "20", "0", "30", "0", entitiesLines, "0", "ENDBLK"].join("\n");
}

function insert(name: string, extra: string[] = [], layer = "0"): string {
  return ["0", "INSERT", "8", layer, "2", name, "10", "0", "20", "0", ...extra].join("\n");
}

describe("DxfParserAdapter - exact transforms of curves", () => {
  const arcInBlock = ["0", "ARC", "8", "0", "10", "0", "20", "0", "40", "5", "50", "0", "51", "90"].join("\n");

  it("keeps the same quarter of a mirrored ARC (X mirrored: 0-90 degrees becomes 90-180 degrees)", () => {
    const model = parseDxfText(buildDxfWithBlocks(insert("S", ["41", "-1"]), blockDef("S", arcInBlock)));
    const arc = model.entities[0];
    expect(arc.type).toBe("ARC");
    if (arc.type === "ARC") {
      expect(arc.radius).toBeCloseTo(5, 9);
      expect(arc.startAngle).toBeCloseTo(Math.PI / 2, 9);
      expect(arc.endAngle).toBeCloseTo(Math.PI, 9);
    }
  });

  it("keeps the same quarter of a Y-mirrored ARC (0-90 degrees becomes 270-360 degrees)", () => {
    const model = parseDxfText(buildDxfWithBlocks(insert("S", ["42", "-1"]), blockDef("S", arcInBlock)));
    const arc = model.entities[0];
    expect(arc.type).toBe("ARC");
    if (arc.type === "ARC") {
      const span = normalizeArcSpan(arc.startAngle, arc.endAngle);
      expect(span).toBeCloseTo(Math.PI / 2, 9);
      const mid = { x: arc.radius * Math.cos(arc.startAngle + span / 2), y: arc.radius * Math.sin(arc.startAngle + span / 2) };
      expect(mid.x).toBeGreaterThan(0);
      expect(mid.y).toBeLessThan(0);
    }
  });

  it("turns a CIRCLE under non-uniform scale into the matching ELLIPSE", () => {
    const circle = ["0", "CIRCLE", "8", "0", "10", "0", "20", "0", "40", "5"].join("\n");
    const model = parseDxfText(buildDxfWithBlocks(insert("S", ["41", "2", "42", "1"]), blockDef("S", circle)));
    const ellipse = model.entities[0];
    expect(ellipse.type).toBe("ELLIPSE");
    if (ellipse.type === "ELLIPSE") {
      expect(ellipse.majorRadius).toBeCloseTo(10, 9);
      expect(ellipse.minorRadius).toBeCloseTo(5, 9);
    }
  });

  it("turns an ARC under non-uniform scale into an elliptical arc through the scaled endpoints", () => {
    const model = parseDxfText(buildDxfWithBlocks(insert("S", ["41", "3", "42", "1"]), blockDef("S", arcInBlock)));
    const ellipse = model.entities[0];
    expect(ellipse.type).toBe("ELLIPSE");
    if (ellipse.type === "ELLIPSE") {
      const at = (param: number) =>
        pointOnEllipse(ellipse.center, ellipse.majorRadius, ellipse.minorRadius, ellipse.rotation, param);
      const start = at(ellipse.startParam);
      const end = at(ellipse.endParam);
      // 0度の点(5,0)→(15,0)、90度の点(0,5)→(0,5)
      expect(start.x).toBeCloseTo(15, 7);
      expect(start.y).toBeCloseTo(0, 7);
      expect(end.x).toBeCloseTo(0, 7);
      expect(end.y).toBeCloseTo(5, 7);
    }
  });

  it("keeps an ELLIPSE exact under mirroring", () => {
    const ellipse = ["0", "ELLIPSE", "8", "0", "10", "0", "20", "0", "11", "8", "21", "0", "40", "0.5", "41", "0", "42", String(Math.PI / 2)].join("\n");
    const model = parseDxfText(buildDxfWithBlocks(insert("S", ["41", "-1"]), blockDef("S", ellipse)));
    const result = model.entities[0];
    expect(result.type).toBe("ELLIPSE");
    if (result.type === "ELLIPSE") {
      // 元は(8,0)→(0,4)の弧。X反転後は(-8,0)→(0,4)で、中間点も+Y側(0より大)にある
      const span = normalizeArcSpan(result.startParam, result.endParam);
      const at = (param: number) => pointOnEllipse(result.center, result.majorRadius, result.minorRadius, result.rotation, param);
      const points = [at(result.startParam), at(result.startParam + span / 2), at(result.startParam + span)];
      const xs = points.map((p) => Math.round(p.x * 1e6) / 1e6);
      expect(xs.some((x) => Math.abs(x + 8) < 1e-6) || xs.some((x) => Math.abs(x) < 1e-6)).toBe(true);
      for (const p of points) {
        expect(p.x).toBeLessThanOrEqual(1e-6);
        expect(p.y).toBeGreaterThanOrEqual(-1e-6);
      }
    }
  });
});

describe("DxfParserAdapter - polyline bulge", () => {
  it("expands an LWPOLYLINE bulge segment into arc points", () => {
    const poly = ["0", "LWPOLYLINE", "8", "0", "90", "2", "70", "0", "10", "0", "20", "0", "42", "1", "10", "10", "20", "0"].join("\n");
    const model = parseDxfText(buildDxfWithBlocks(poly));
    const entity = model.entities[0];
    expect(entity.type).toBe("LWPOLYLINE");
    if (entity.type === "LWPOLYLINE") {
      expect(entity.vertices.length).toBeGreaterThan(4);
      // バルジ+1の半円は弦(0,0)-(10,0)の下側を通り、中心(5,0)から半径5
      for (const v of entity.vertices) expect(Math.hypot(v.x - 5, v.y)).toBeCloseTo(5, 6);
    }
  });
});

describe("DxfParserAdapter - layer 0 inheritance and attributes", () => {
  const lineIn = (layer: string) => ["0", "LINE", "8", layer, "10", "0", "20", "0", "11", "1", "21", "0"].join("\n");

  it("gives layer-0 entities inside a block the layer of the INSERT", () => {
    const model = parseDxfText(buildDxfWithBlocks(insert("B", [], "WALL"), blockDef("B", lineIn("0") + "\n" + lineIn("OTHER"))));
    expect(model.entities.map((e) => e.layer)).toEqual(["WALL", "OTHER"]);
  });

  it("propagates the inherited layer through nested blocks and keeps layer 0 at the top level", () => {
    const model = parseDxfText(
      buildDxfWithBlocks(
        insert("OUTER", [], "WALL") + "\n" + lineIn("0"),
        blockDef("INNER", lineIn("0")) + "\n" + blockDef("OUTER", insert("INNER")),
      ),
    );
    expect(model.entities.map((e) => e.layer)).toEqual(["WALL", "0"]);
  });

  it("uses a true color (group 420) given without a color index", () => {
    const line = ["0", "LINE", "8", "0", "420", "16711680", "10", "0", "20", "0", "11", "1", "21", "0"].join("\n");
    const model = parseDxfText(buildDxfWithBlocks(line));
    expect(model.entities[0].color).toBe("#ff0000");
  });

  it("uses a true color even when the color index says ByLayer (256), and ignores ByLayer without true color", () => {
    const layers = ["0", "TABLE", "2", "LAYER", "0", "LAYER", "2", "RED", "70", "0", "62", "1", "6", "CONTINUOUS", "0", "ENDTAB"];
    const lineWith = (extra: string[]) => ["0", "LINE", "8", "RED", ...extra, "10", "0", "20", "0", "11", "1", "21", "0"].join("\n");
    const dxf = [
      "0", "SECTION", "2", "TABLES", ...layers, "0", "ENDSEC",
      "0", "SECTION", "2", "ENTITIES",
      lineWith(["62", "256", "420", "65280"]),
      lineWith(["62", "256"]),
      "0", "ENDSEC", "0", "EOF",
    ].join("\n");
    const model = parseDxfText(dxf);
    expect(model.entities.map((e) => e.color)).toEqual(["#00ff00", "#ff0000"]);
  });

  it("keeps a circle finite under an extreme but finite scale", () => {
    const circle = ["0", "CIRCLE", "8", "0", "10", "0", "20", "0", "40", "1"].join("\n");
    const model = parseDxfText(buildDxfWithBlocks(insert("S", ["41", "1e200", "42", "1e200"]), blockDef("S", circle)));
    const result = model.entities[0];
    expect(result.type).toBe("CIRCLE");
    if (result.type === "CIRCLE") expect(Number.isFinite(result.radius)).toBe(true);
  });

  it("skips entities marked invisible (group 60 = 1)", () => {
    const hidden = ["0", "LINE", "8", "0", "60", "1", "10", "0", "20", "0", "11", "1", "21", "0"].join("\n");
    const model = parseDxfText(buildDxfWithBlocks(hidden + "\n" + lineIn("0")));
    expect(model.entities).toHaveLength(1);
  });

  it("falls back to top-left for an MTEXT attachment point outside 1 to 9", () => {
    const mtext = (attachment: string) =>
      ["0", "MTEXT", "8", "0", "10", "0", "20", "0", "40", "2", "71", attachment, "1", "ABC"].join("\n");
    const model = parseDxfText(buildDxfWithBlocks([mtext("5"), mtext("0"), mtext("12")].join("\n")));
    const aligns = model.entities.map((e) => (e.type === "TEXT" ? `${e.horizontalAlign}/${e.verticalAlign}` : ""));
    expect(aligns).toEqual(["center/middle", "left/top", "left/top"]);
  });
});

describe("DxfParserAdapter - INSERT safety limits", () => {
  const lineIn = ["0", "LINE", "8", "0", "10", "0", "20", "0", "11", "1", "21", "0"].join("\n");

  it("expands a normal array INSERT (columns x rows)", () => {
    const model = parseDxfText(buildDxfWithBlocks(insert("B", ["70", "3", "71", "2", "44", "10", "45", "10"]), blockDef("B", lineIn)));
    expect(model.entities).toHaveLength(6);
  });

  it("refuses an absurd array size instead of exhausting memory", () => {
    const model = parseDxfText(buildDxfWithBlocks(insert("B", ["70", "100000", "71", "100000"]), blockDef("B", lineIn)));
    expect(model.entities).toHaveLength(0);
    expect(model.stats.unsupportedBreakdown.INSERT).toBe(1);
  });

  it("treats invalid row/column counts and scales as defaults", () => {
    const model = parseDxfText(buildDxfWithBlocks(insert("B", ["70", "0", "71", "-5", "41", "abc"]), blockDef("B", lineIn)));
    expect(model.entities).toHaveLength(1);
    const line = model.entities[0];
    if (line.type === "LINE") expect(Number.isFinite(line.end.x)).toBe(true);
  });
});
