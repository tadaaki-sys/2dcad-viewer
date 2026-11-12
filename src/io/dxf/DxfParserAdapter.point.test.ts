import { describe, expect, it } from "vitest";
import { parseDxfText } from "./DxfParserAdapter";
import { findEntityAtPoint, findEntitiesInBox } from "../cad-view/selection/Selection";
import { findSnapPoint } from "../cad-view/snap/SnapEngine";

function dxf(entities: string[], header: string[] = [], blocks: string[] = []): string {
  return [
    ...(header.length ? ["0", "SECTION", "2", "HEADER", ...header, "0", "ENDSEC"] : []),
    ...(blocks.length ? ["0", "SECTION", "2", "BLOCKS", ...blocks, "0", "ENDSEC"] : []),
    "0", "SECTION", "2", "ENTITIES", ...entities, "0", "ENDSEC", "0", "EOF",
  ].join("\n");
}

const point = (x: number, y: number, layer = "0") => ["0", "POINT", "8", layer, "10", String(x), "20", String(y), "30", "0"];

describe("POINT entity", () => {
  it("is converted into a CadPoint and counted as supported", () => {
    const model = parseDxfText(dxf(point(12.5, -3)));
    expect(model.entities).toHaveLength(1);
    expect(model.entities[0]).toMatchObject({ type: "POINT", layer: "0", position: { x: 12.5, y: -3 } });
    expect(model.stats.unsupportedEntityCount).toBe(0);
  });

  it("is placed through an INSERT's transform", () => {
    const block = ["0", "BLOCK", "8", "0", "2", "B", "70", "0", "10", "0", "20", "0", "30", "0", ...point(1, 2), "0", "ENDBLK"];
    const insert = ["0", "INSERT", "8", "0", "2", "B", "10", "100", "20", "200", "41", "2", "42", "2"];
    const model = parseDxfText(dxf(insert, [], block));
    expect(model.entities[0]).toMatchObject({ type: "POINT", position: { x: 102, y: 204 } });
  });

  it("contributes to the drawing bounds even though it has no size", () => {
    const model = parseDxfText(dxf([...point(0, 0), ...point(10, 20)]));
    expect(model.bounds).toEqual({ min: { x: 0, y: 0 }, max: { x: 10, y: 20 } });
  });

  it("reads the display style from $PDMODE / $PDSIZE and defaults to a dot", () => {
    const withHeader = parseDxfText(dxf(point(0, 0), ["9", "$PDMODE", "70", "35", "9", "$PDSIZE", "40", "2.5"]));
    expect(withHeader.pointStyle).toEqual({ mode: 35, size: 2.5 });
    expect(parseDxfText(dxf(point(0, 0))).pointStyle).toEqual({ mode: 0, size: 0 });
  });
});

describe("POINT selection and snapping", () => {
  const model = parseDxfText(dxf([...point(100, 100), ...point(500, 500)]));
  const visible = new Set(["0"]);

  it("can be picked by clicking near it", () => {
    expect(findEntityAtPoint(model.entities, visible, { x: 101, y: 100.5 }, 3)?.id).toBe(model.entities[0].id);
    expect(findEntityAtPoint(model.entities, visible, { x: 300, y: 300 }, 3)).toBeNull();
  });

  it("is selected by window and crossing boxes", () => {
    const box = { min: { x: 90, y: 90 }, max: { x: 110, y: 110 } };
    expect(findEntitiesInBox(model.entities, visible, box, "window")).toHaveLength(1);
    expect(findEntitiesInBox(model.entities, visible, box, "crossing")).toHaveLength(1);
    expect(findEntitiesInBox(model.entities, visible, { min: { x: 0, y: 0 }, max: { x: 50, y: 50 } }, "window")).toHaveLength(0);
  });

  it("is a snap target (node)", () => {
    const snap = findSnapPoint(model.entities, visible, { x: 102, y: 101 }, 5);
    expect(snap).toEqual({ point: { x: 100, y: 100 }, type: "endpoint" });
  });
});
