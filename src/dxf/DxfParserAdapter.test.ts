import { describe, expect, it } from "vitest";
import { parseDxfText } from "./DxfParserAdapter";
import { normalizeArcSpan } from "../utils/geometry";

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

function buildDxfWithBlocks(entitiesSection: string, blocksSection: string, tablesSection = ""): string {
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

function blockDef(name: string, basePoint: { x: number; y: number }, entitiesLines: string): string {
  return [
    "0",
    "BLOCK",
    "8",
    "0",
    "2",
    name,
    "70",
    "0",
    "10",
    String(basePoint.x),
    "20",
    String(basePoint.y),
    "30",
    "0.0",
    entitiesLines,
    "0",
    "ENDBLK",
  ].join("\n");
}

function insertRef(
  blockName: string,
  position: { x: number; y: number },
  options: { rotation?: number; xScale?: number; yScale?: number; colorIndex?: number } = {},
): string {
  const lines = ["0", "INSERT", "8", "0", "2", blockName, "10", String(position.x), "20", String(position.y)];
  if (options.colorIndex !== undefined) lines.push("62", String(options.colorIndex));
  if (options.xScale !== undefined) lines.push("41", String(options.xScale));
  if (options.yScale !== undefined) lines.push("42", String(options.yScale));
  if (options.rotation !== undefined) lines.push("50", String(options.rotation));
  return lines.join("\n");
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
        "POINT",
        "8",
        "0",
        "10",
        "5.0",
        "20",
        "5.0",
        "0",
        "SOLID",
        "8",
        "0",
        "10",
        "0.0",
        "20",
        "0.0",
        "0",
        "POINT",
        "8",
        "0",
        "10",
        "1.0",
        "20",
        "1.0",
      ].join("\n"),
    );

    const model = parseDxfText(dxf);

    expect(model.stats.totalEntityCount).toBe(4);
    expect(model.stats.supportedEntityCount).toBe(1);
    expect(model.stats.unsupportedEntityCount).toBe(3);
    expect(model.stats.unsupportedBreakdown).toEqual({ POINT: 2, SOLID: 1 });
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
    const dxf = buildDxf(["0", "POINT", "8", "0", "10", "0.0", "20", "0.0"].join("\n"));

    const model = parseDxfText(dxf);

    expect(model.bounds).toBeNull();
  });
});

describe("DxfParserAdapter - INSERT/BLOCK expansion", () => {
  const lineInBlock = ["0", "LINE", "8", "0", "10", "0.0", "20", "0.0", "11", "10.0", "21", "0.0"].join("\n");

  it("translates a block's LINE by the INSERT position", () => {
    const dxf = buildDxfWithBlocks(
      insertRef("SYMBOL", { x: 100, y: 200 }),
      blockDef("SYMBOL", { x: 0, y: 0 }, lineInBlock),
    );

    const model = parseDxfText(dxf);

    expect(model.entities).toHaveLength(1);
    const entity = model.entities[0];
    expect(entity.type).toBe("LINE");
    if (entity.type === "LINE") {
      expect(entity.start).toEqual({ x: 100, y: 200 });
      expect(entity.end).toEqual({ x: 110, y: 200 });
    }
  });

  it("applies INSERT rotation and scale around the block base point", () => {
    const dxf = buildDxfWithBlocks(
      insertRef("SYMBOL", { x: 0, y: 0 }, { rotation: 90, xScale: 2, yScale: 2 }),
      blockDef("SYMBOL", { x: 0, y: 0 }, lineInBlock),
    );

    const model = parseDxfText(dxf);

    const entity = model.entities[0];
    expect(entity.type).toBe("LINE");
    if (entity.type === "LINE") {
      expect(entity.start.x).toBeCloseTo(0, 9);
      expect(entity.start.y).toBeCloseTo(0, 9);
      // local (10,0) -> scaled (20,0) -> rotated 90deg -> (0,20)
      expect(entity.end.x).toBeCloseTo(0, 9);
      expect(entity.end.y).toBeCloseTo(20, 9);
    }
  });

  it("offsets by the block base point before applying the insert transform", () => {
    const dxf = buildDxfWithBlocks(
      insertRef("SYMBOL", { x: 100, y: 100 }),
      blockDef("SYMBOL", { x: 5, y: 5 }, lineInBlock),
    );

    const model = parseDxfText(dxf);

    const entity = model.entities[0];
    if (entity.type === "LINE") {
      // local (0,0) is 5 units left/below the base point -> insertPos + (-5,-5)
      expect(entity.start).toEqual({ x: 95, y: 95 });
      expect(entity.end).toEqual({ x: 105, y: 95 });
    }
  });

  it("resolves nested INSERTs by composing transforms", () => {
    const innerInsert = insertRef("INNER", { x: 10, y: 0 });
    const dxf = buildDxfWithBlocks(
      insertRef("OUTER", { x: 100, y: 100 }),
      [blockDef("OUTER", { x: 0, y: 0 }, innerInsert), blockDef("INNER", { x: 0, y: 0 }, lineInBlock)].join("\n"),
    );

    const model = parseDxfText(dxf);

    expect(model.entities).toHaveLength(1);
    const entity = model.entities[0];
    if (entity.type === "LINE") {
      // INNER's line (0,0)-(10,0) shifted by INNER insert (10,0), then by OUTER insert (100,100)
      expect(entity.start).toEqual({ x: 110, y: 100 });
      expect(entity.end).toEqual({ x: 120, y: 100 });
    }
  });

  it("inherits the INSERT's own color for ByBlock (colorIndex 0) entities inside the block", () => {
    const byBlockLine = ["0", "LINE", "8", "0", "62", "0", "10", "0.0", "20", "0.0", "11", "10.0", "21", "0.0"].join(
      "\n",
    );
    const dxf = buildDxfWithBlocks(
      insertRef("SYMBOL", { x: 0, y: 0 }, { colorIndex: 1 }), // red
      blockDef("SYMBOL", { x: 0, y: 0 }, byBlockLine),
    );

    const model = parseDxfText(dxf);

    expect(model.entities[0].color).toBe("#ff0000");
  });

  it("counts entities inside a block towards total/unsupported stats", () => {
    const pointInBlock = ["0", "POINT", "8", "0", "10", "0.0", "20", "0.0"].join("\n");
    const dxf = buildDxfWithBlocks(
      insertRef("SYMBOL", { x: 0, y: 0 }),
      blockDef("SYMBOL", { x: 0, y: 0 }, [lineInBlock, pointInBlock].join("\n")),
    );

    const model = parseDxfText(dxf);

    expect(model.stats.totalEntityCount).toBe(2);
    expect(model.stats.supportedEntityCount).toBe(1);
    expect(model.stats.unsupportedBreakdown).toEqual({ POINT: 1 });
  });

  it("counts an INSERT referencing a missing block as unsupported instead of crashing", () => {
    const dxf = buildDxf(insertRef("DOES_NOT_EXIST", { x: 0, y: 0 }));

    const model = parseDxfText(dxf);

    expect(model.entities).toHaveLength(0);
    expect(model.stats.totalEntityCount).toBe(1);
    expect(model.stats.unsupportedBreakdown).toEqual({ INSERT: 1 });
  });

  it("does not infinite-loop on a circular block reference", () => {
    const dxf = buildDxfWithBlocks(
      insertRef("A", { x: 0, y: 0 }),
      [blockDef("A", { x: 0, y: 0 }, insertRef("B", { x: 0, y: 0 })), blockDef("B", { x: 0, y: 0 }, insertRef("A", { x: 0, y: 0 }))].join(
        "\n",
      ),
    );

    const model = parseDxfText(dxf);

    // 無限ループせず完了すること自体がテストの主目的
    expect(model.entities).toHaveLength(0);
  });
});

describe("DxfParserAdapter - CIRCLE/ARC conversion", () => {
  it("converts a CIRCLE entity into a CadCircle", () => {
    const dxf = buildDxf(["0", "CIRCLE", "8", "0", "10", "5.0", "20", "10.0", "40", "3.0"].join("\n"));

    const model = parseDxfText(dxf);

    expect(model.entities).toHaveLength(1);
    const entity = model.entities[0];
    expect(entity.type).toBe("CIRCLE");
    if (entity.type === "CIRCLE") {
      expect(entity.center).toEqual({ x: 5, y: 10 });
      expect(entity.radius).toBe(3);
    }
  });

  it("converts an ARC entity into a CadArc, preserving start/end angles", () => {
    const dxf = buildDxf(
      ["0", "ARC", "8", "0", "10", "0.0", "20", "0.0", "40", "5.0", "50", "0", "51", "90"].join("\n"),
    );

    const model = parseDxfText(dxf);

    expect(model.entities).toHaveLength(1);
    const entity = model.entities[0];
    expect(entity.type).toBe("ARC");
    if (entity.type === "ARC") {
      expect(entity.center).toEqual({ x: 0, y: 0 });
      expect(entity.radius).toBe(5);
      expect(entity.startAngle).toBeCloseTo(0, 9);
      expect(entity.endAngle).toBeCloseTo(Math.PI / 2, 9);
    }
  });

  it("scales a CIRCLE's radius and translates its center through a scaled/positioned INSERT", () => {
    const circleInBlock = ["0", "CIRCLE", "8", "0", "10", "0.0", "20", "0.0", "40", "2.0"].join("\n");
    const dxf = buildDxfWithBlocks(
      insertRef("SYMBOL", { x: 100, y: 100 }, { xScale: 2, yScale: 2 }),
      blockDef("SYMBOL", { x: 0, y: 0 }, circleInBlock),
    );

    const model = parseDxfText(dxf);

    expect(model.entities).toHaveLength(1);
    const entity = model.entities[0];
    expect(entity.type).toBe("CIRCLE");
    if (entity.type === "CIRCLE") {
      expect(entity.center).toEqual({ x: 100, y: 100 });
      expect(entity.radius).toBe(4);
    }
  });

  it("rotates an ARC's start/end angles through a rotated INSERT", () => {
    const arcInBlock = ["0", "ARC", "8", "0", "10", "0.0", "20", "0.0", "40", "5.0", "50", "0", "51", "90"].join("\n");
    const dxf = buildDxfWithBlocks(
      insertRef("SYMBOL", { x: 0, y: 0 }, { rotation: 90 }),
      blockDef("SYMBOL", { x: 0, y: 0 }, arcInBlock),
    );

    const model = parseDxfText(dxf);

    expect(model.entities).toHaveLength(1);
    const entity = model.entities[0];
    expect(entity.type).toBe("ARC");
    if (entity.type === "ARC") {
      expect(entity.startAngle).toBeCloseTo(Math.PI / 2, 9);
      expect(entity.endAngle).toBeCloseTo(Math.PI, 9);
    }
  });
});

describe("DxfParserAdapter - TEXT/MTEXT conversion", () => {
  it("converts a default-aligned TEXT entity using its start point", () => {
    const dxf = buildDxf(
      ["0", "TEXT", "8", "0", "1", "hello", "10", "5.0", "20", "10.0", "40", "2.5"].join("\n"),
    );

    const model = parseDxfText(dxf);

    expect(model.entities).toHaveLength(1);
    const entity = model.entities[0];
    expect(entity.type).toBe("TEXT");
    if (entity.type === "TEXT") {
      expect(entity.position).toEqual({ x: 5, y: 10 });
      expect(entity.text).toBe("hello");
      expect(entity.height).toBe(2.5);
      expect(entity.horizontalAlign).toBe("left");
      expect(entity.verticalAlign).toBe("baseline");
    }
  });

  it("uses the second alignment point for a center/middle-justified TEXT entity", () => {
    const dxf = buildDxf(
      [
        "0",
        "TEXT",
        "8",
        "0",
        "1",
        "centered",
        "10",
        "0.0",
        "20",
        "0.0",
        "11",
        "20.0",
        "21",
        "30.0",
        "40",
        "2.5",
        "72",
        "1",
        "73",
        "2",
      ].join("\n"),
    );

    const model = parseDxfText(dxf);

    const entity = model.entities[0];
    expect(entity.type).toBe("TEXT");
    if (entity.type === "TEXT") {
      expect(entity.position).toEqual({ x: 20, y: 30 });
      expect(entity.horizontalAlign).toBe("center");
      expect(entity.verticalAlign).toBe("middle");
    }
  });

  it("converts an MTEXT entity, stripping formatting codes and converting \\P to a newline", () => {
    const dxf = buildDxf(
      [
        "0",
        "MTEXT",
        "8",
        "0",
        "10",
        "0.0",
        "20",
        "0.0",
        "40",
        "3.0",
        "71",
        "5",
        "1",
        "\\fArial;1階平面図\\P縮尺1:100",
      ].join("\n"),
    );

    const model = parseDxfText(dxf);

    expect(model.entities).toHaveLength(1);
    const entity = model.entities[0];
    expect(entity.type).toBe("TEXT");
    if (entity.type === "TEXT") {
      expect(entity.text).toBe("1階平面図\n縮尺1:100");
      expect(entity.horizontalAlign).toBe("center");
      expect(entity.verticalAlign).toBe("middle");
    }
  });

  it("scales TEXT height and rotates it through a scaled/rotated INSERT", () => {
    const textInBlock = ["0", "TEXT", "8", "0", "1", "note", "10", "0.0", "20", "0.0", "40", "2.0", "50", "0"].join(
      "\n",
    );
    const dxf = buildDxfWithBlocks(
      insertRef("SYMBOL", { x: 0, y: 0 }, { rotation: 90, xScale: 2, yScale: 2 }),
      blockDef("SYMBOL", { x: 0, y: 0 }, textInBlock),
    );

    const model = parseDxfText(dxf);

    expect(model.entities).toHaveLength(1);
    const entity = model.entities[0];
    expect(entity.type).toBe("TEXT");
    if (entity.type === "TEXT") {
      expect(entity.height).toBe(4);
      expect(entity.rotation).toBeCloseTo(Math.PI / 2, 9);
    }
  });
});

describe("DxfParserAdapter - ELLIPSE conversion", () => {
  it("converts a full ELLIPSE into a CadEllipse", () => {
    const dxf = buildDxf(
      ["0", "ELLIPSE", "8", "0", "10", "10.0", "20", "20.0", "11", "8.0", "21", "0.0", "40", "0.5"].join("\n"),
    );

    const model = parseDxfText(dxf);

    expect(model.entities).toHaveLength(1);
    const entity = model.entities[0];
    expect(entity.type).toBe("ELLIPSE");
    if (entity.type === "ELLIPSE") {
      expect(entity.center).toEqual({ x: 10, y: 20 });
      expect(entity.majorRadius).toBe(8);
      expect(entity.minorRadius).toBe(4);
      expect(entity.rotation).toBeCloseTo(0, 9);
      expect(normalizeArcSpan(entity.startParam, entity.endParam)).toBeCloseTo(Math.PI * 2, 9);
    }
  });

  it("preserves startParam/endParam for an elliptical arc", () => {
    const dxf = buildDxf(
      [
        "0",
        "ELLIPSE",
        "8",
        "0",
        "10",
        "0.0",
        "20",
        "0.0",
        "11",
        "8.0",
        "21",
        "0.0",
        "40",
        "0.5",
        "41",
        "0",
        "42",
        String(Math.PI / 2),
      ].join("\n"),
    );

    const model = parseDxfText(dxf);

    const entity = model.entities[0];
    expect(entity.type).toBe("ELLIPSE");
    if (entity.type === "ELLIPSE") {
      expect(entity.startParam).toBeCloseTo(0, 9);
      expect(entity.endParam).toBeCloseTo(Math.PI / 2, 9);
    }
  });

  it("scales an ELLIPSE's radii and translates its center through a scaled/positioned INSERT", () => {
    const ellipseInBlock = ["0", "ELLIPSE", "8", "0", "10", "0.0", "20", "0.0", "11", "8.0", "21", "0.0", "40", "0.5"].join(
      "\n",
    );
    const dxf = buildDxfWithBlocks(
      insertRef("SYMBOL", { x: 100, y: 100 }, { xScale: 2, yScale: 2 }),
      blockDef("SYMBOL", { x: 0, y: 0 }, ellipseInBlock),
    );

    const model = parseDxfText(dxf);

    expect(model.entities).toHaveLength(1);
    const entity = model.entities[0];
    expect(entity.type).toBe("ELLIPSE");
    if (entity.type === "ELLIPSE") {
      expect(entity.center).toEqual({ x: 100, y: 100 });
      expect(entity.majorRadius).toBe(16);
      expect(entity.minorRadius).toBe(8);
    }
  });

  it("rotates an ELLIPSE's major axis through a rotated INSERT", () => {
    const ellipseInBlock = ["0", "ELLIPSE", "8", "0", "10", "0.0", "20", "0.0", "11", "8.0", "21", "0.0", "40", "0.5"].join(
      "\n",
    );
    const dxf = buildDxfWithBlocks(
      insertRef("SYMBOL", { x: 0, y: 0 }, { rotation: 90 }),
      blockDef("SYMBOL", { x: 0, y: 0 }, ellipseInBlock),
    );

    const model = parseDxfText(dxf);

    const entity = model.entities[0];
    expect(entity.type).toBe("ELLIPSE");
    if (entity.type === "ELLIPSE") {
      expect(entity.rotation).toBeCloseTo(Math.PI / 2, 9);
    }
  });
});

describe("DxfParserAdapter - SPLINE conversion", () => {
  // 2次ベジェ(制御点3、クランプノット)。t=0.5の点は (10, 10)
  function quadraticSplineLines(flags = 8): string[] {
    return [
      "0", "SPLINE", "8", "0",
      "70", String(flags), "71", "2", "72", "6", "73", "3",
      "40", "0", "40", "0", "40", "0", "40", "1", "40", "1", "40", "1",
      "10", "0.0", "20", "0.0",
      "10", "10.0", "20", "20.0",
      "10", "20.0", "20", "0.0",
    ];
  }

  it("converts a SPLINE into a smooth polyline through its start, apex region, and end", () => {
    const model = parseDxfText(buildDxf(quadraticSplineLines().join("\n")));

    expect(model.entities).toHaveLength(1);
    const entity = model.entities[0];
    expect(entity.type).toBe("SPLINE");
    if (entity.type === "SPLINE") {
      expect(entity.points.length).toBeGreaterThan(3);
      expect(entity.points[0]).toEqual({ x: 0, y: 0 });
      const last = entity.points[entity.points.length - 1];
      expect(last.x).toBeCloseTo(20, 9);
      expect(last.y).toBeCloseTo(0, 9);
      expect(entity.points.some((p) => Math.abs(p.x - 10) < 1e-9 && Math.abs(p.y - 10) < 1e-9)).toBe(true);
      expect(entity.closed).toBe(false);
    }
    expect(model.stats.unsupportedEntityCount).toBe(0);
  });

  it("marks a SPLINE with the closed flag as closed", () => {
    const model = parseDxfText(buildDxf(quadraticSplineLines(1 | 8).join("\n")));
    const entity = model.entities[0];
    expect(entity.type === "SPLINE" && entity.closed).toBe(true);
  });

  it("falls back to fit points when a SPLINE has no control points", () => {
    const lines = ["0", "SPLINE", "8", "0", "70", "0", "74", "3", "11", "0.0", "21", "0.0", "11", "5.0", "21", "5.0", "11", "9.0", "21", "0.0"];
    const model = parseDxfText(buildDxf(lines.join("\n")));
    const entity = model.entities[0];
    expect(entity.type).toBe("SPLINE");
    if (entity.type === "SPLINE") {
      expect(entity.points).toEqual([
        { x: 0, y: 0 },
        { x: 5, y: 5 },
        { x: 9, y: 0 },
      ]);
    }
  });

  it("transforms a SPLINE through a scaled/positioned INSERT", () => {
    const dxf = buildDxfWithBlocks(
      insertRef("CURVE", { x: 100, y: 100 }, { xScale: 2, yScale: 2 }),
      blockDef("CURVE", { x: 0, y: 0 }, quadraticSplineLines().join("\n")),
    );
    const model = parseDxfText(dxf);
    const entity = model.entities[0];
    expect(entity.type).toBe("SPLINE");
    if (entity.type === "SPLINE") {
      expect(entity.points[0]).toEqual({ x: 100, y: 100 });
      const last = entity.points[entity.points.length - 1];
      expect(last.x).toBeCloseTo(140, 9);
      expect(last.y).toBeCloseTo(100, 9);
    }
  });
});

describe("DxfParserAdapter - linetypes", () => {
  const LTYPE_AND_LAYER_TABLES = [
    "0", "TABLE", "2", "LTYPE", "70", "3",
    "0", "LTYPE", "2", "CONTINUOUS", "70", "0", "3", "Solid line", "72", "65", "73", "0", "40", "0.0",
    "0", "LTYPE", "2", "DASHED", "70", "0", "3", "Dashed", "72", "65", "73", "2", "40", "9.525", "49", "6.35", "74", "0", "49", "-3.175", "74", "0",
    "0", "LTYPE", "2", "CENTER", "70", "0", "3", "Center", "72", "65", "73", "4", "40", "50.8", "49", "31.75", "74", "0", "49", "-6.35", "74", "0", "49", "6.35", "74", "0", "49", "-6.35", "74", "0",
    "0", "ENDTAB",
    "0", "TABLE", "2", "LAYER", "70", "2",
    "0", "LAYER", "2", "CENTERLINES", "70", "0", "62", "1", "6", "CENTER",
    "0", "LAYER", "2", "0", "70", "0", "62", "7", "6", "Continuous",
    "0", "ENDTAB",
  ].join("\n");

  const lineOn = (layer: string, extra: string[] = []) =>
    ["0", "LINE", "8", layer, ...extra, "10", "0.0", "20", "0.0", "11", "100.0", "21", "0.0"].join("\n");

  const withLtScale = (dxf: string, ltscale: number) =>
    ["0", "SECTION", "2", "HEADER", "9", "$LTSCALE", "40", String(ltscale), "0", "ENDSEC", dxf].join("\n");

  function dashOf(dxf: string, index = 0) {
    const entity = parseDxfText(dxf).entities[index];
    return entity.type === "TEXT" ? undefined : entity.lineDash;
  }

  it("applies an explicit entity linetype from the LTYPE table", () => {
    const dash = dashOf(buildDxf(lineOn("0", ["6", "DASHED"]), LTYPE_AND_LAYER_TABLES));
    expect(dash?.name).toBe("DASHED");
    expect(dash?.pattern).toEqual([6.35, 3.175]);
  });

  it("matches linetype names case-insensitively", () => {
    expect(dashOf(buildDxf(lineOn("0", ["6", "dashed"]), LTYPE_AND_LAYER_TABLES))?.pattern).toEqual([6.35, 3.175]);
  });

  it("uses the layer's linetype for ByLayer entities", () => {
    expect(dashOf(buildDxf(lineOn("CENTERLINES"), LTYPE_AND_LAYER_TABLES))?.name).toBe("CENTER");
    expect(dashOf(buildDxf(lineOn("CENTERLINES", ["6", "BYLAYER"]), LTYPE_AND_LAYER_TABLES))?.name).toBe("CENTER");
  });

  it("lets an explicit entity linetype override the layer's linetype", () => {
    expect(dashOf(buildDxf(lineOn("CENTERLINES", ["6", "DASHED"]), LTYPE_AND_LAYER_TABLES))?.name).toBe("DASHED");
    expect(dashOf(buildDxf(lineOn("CENTERLINES", ["6", "Continuous"]), LTYPE_AND_LAYER_TABLES))).toBeUndefined();
  });

  it("leaves continuous, unspecified, and unknown linetypes solid", () => {
    expect(dashOf(buildDxf(lineOn("0"), LTYPE_AND_LAYER_TABLES))).toBeUndefined();
    expect(dashOf(buildDxf(lineOn("0", ["6", "CONTINUOUS"]), LTYPE_AND_LAYER_TABLES))).toBeUndefined();
    expect(dashOf(buildDxf(lineOn("0", ["6", "NO_SUCH_LINETYPE"]), LTYPE_AND_LAYER_TABLES))).toBeUndefined();
  });

  it("scales the pattern by $LTSCALE and by the entity's own linetype scale", () => {
    const base = buildDxf(lineOn("0", ["6", "DASHED"]), LTYPE_AND_LAYER_TABLES);
    expect(dashOf(withLtScale(base, 2))?.pattern).toEqual([12.7, 6.35]);

    const scaledEntity = buildDxf(lineOn("0", ["6", "DASHED", "48", "0.5"]), LTYPE_AND_LAYER_TABLES);
    expect(dashOf(scaledEntity)?.pattern).toEqual([3.175, 1.5875]);

    const both = withLtScale(buildDxf(lineOn("0", ["6", "DASHED", "48", "0.5"]), LTYPE_AND_LAYER_TABLES), 4);
    expect(dashOf(both)?.pattern).toEqual([12.7, 6.35]);
  });

  it("keeps a multi-element pattern like CENTER intact", () => {
    expect(dashOf(buildDxf(lineOn("CENTERLINES"), LTYPE_AND_LAYER_TABLES))?.pattern).toEqual([31.75, 6.35, 6.35, 6.35]);
  });

  it("shares one dash object between entities with the same linetype and scale", () => {
    const two = buildDxf([lineOn("0", ["6", "DASHED"]), lineOn("0", ["6", "DASHED"])].join("\n"), LTYPE_AND_LAYER_TABLES);
    const [first, second] = parseDxfText(two).entities;
    const firstDash = first.type === "TEXT" ? undefined : first.lineDash;
    const secondDash = second.type === "TEXT" ? undefined : second.lineDash;
    expect(firstDash).toBeDefined();
    expect(firstDash).toBe(secondDash);
  });

  it("resolves ByBlock linetypes from the INSERT and ignores the INSERT's scale", () => {
    const insert = ["0", "INSERT", "8", "0", "2", "SYMBOL", "10", "0.0", "20", "0.0", "6", "DASHED", "41", "3.0", "42", "3.0"].join("\n");
    const dxf = buildDxfWithBlocks(
      insert,
      blockDef("SYMBOL", { x: 0, y: 0 }, lineOn("0", ["6", "BYBLOCK"])),
      LTYPE_AND_LAYER_TABLES,
    );
    const dash = dashOf(dxf);
    expect(dash?.name).toBe("DASHED");
    expect(dash?.pattern).toEqual([6.35, 3.175]);
  });

  it("makes ByBlock entities solid when there is no enclosing INSERT linetype", () => {
    expect(dashOf(buildDxf(lineOn("0", ["6", "BYBLOCK"]), LTYPE_AND_LAYER_TABLES))).toBeUndefined();
  });

  it("applies the linetype to circles, arcs and polylines as well", () => {
    const circle = ["0", "CIRCLE", "8", "0", "6", "DASHED", "10", "0.0", "20", "0.0", "40", "5.0"].join("\n");
    expect(dashOf(buildDxf(circle, LTYPE_AND_LAYER_TABLES))?.name).toBe("DASHED");
  });
});
