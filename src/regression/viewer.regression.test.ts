// 既存ビューアの動作を固定する回帰テスト(Phase 0.5)。
// 意図して挙動を変えたときだけ、スナップショットを更新する(`vitest -u`)。更新は事前に承認を取ること。
import { beforeAll, describe, expect, it } from "vitest";
import { parseDxfText } from "../dxf/DxfParserAdapter";
import { unionOfVisibleEntityBounds } from "../cad-view/spatial/entityBounds";
import { buildSpatialIndex } from "../cad-view/spatial/SpatialIndex";
import { findEntitiesInBox, findEntitiesNearPoint } from "../cad-view/selection/Selection";
import { findSnapPoint } from "../cad-view/snap/SnapEngine";
import { Camera } from "../cad-view/camera/Camera";
import type { CadEntity, CadModel } from "../types/cad";
import { factoryLayoutDxf, nestedBlocksDxf, smallDxf, unsupportedDxf } from "./fixtures";
import { cameraAt, installRecordingPath2D, renderModel, summarizeStrokes } from "./recordingContext";

beforeAll(installRecordingPath2D);

const round = (n: number) => Math.round(n * 1e6) / 1e6;

/** 図形の中身を、丸めた比較しやすい形にする(idは連番なので含めない) */
function summarizeEntity(entity: CadEntity): unknown {
  const { id: _id, ...rest } = entity;
  void _id;
  return JSON.parse(JSON.stringify(rest, (_key, value) => (typeof value === "number" ? round(value) : value)));
}

const countByType = (model: CadModel) => {
  const counts: Record<string, number> = {};
  for (const entity of model.entities) counts[entity.type] = (counts[entity.type] ?? 0) + 1;
  return counts;
};

describe("reading: DXF -> internal model", () => {
  it("reads the smallest drawing", () => {
    const model = parseDxfText(smallDxf());
    expect(model.entities).toHaveLength(1);
    expect(model.stats).toEqual({ totalEntityCount: 1, supportedEntityCount: 1, unsupportedEntityCount: 0, unsupportedBreakdown: {} });
    expect(model.bounds).toEqual({ min: { x: 0, y: 0 }, max: { x: 100, y: 50 } });
  });

  it("reads the factory layout drawing completely", () => {
    const model = parseDxfText(factoryLayoutDxf());
    expect(model.stats.unsupportedEntityCount).toBe(0);
    expect(countByType(model)).toMatchSnapshot("entity counts by type");
    expect(model.layers.map((l) => [l.name, l.color, l.visible])).toMatchSnapshot("layers");
    expect(model.pointStyle).toEqual({ mode: 35, size: 20 });
    expect(model.entities.map(summarizeEntity)).toMatchSnapshot("entities");
  });

  it("starts with OFF and frozen layers hidden but keeps their entities", () => {
    const model = parseDxfText(factoryLayoutDxf());
    const visibility = Object.fromEntries(model.layers.map((l) => [l.name, l.visible]));
    expect(visibility).toMatchObject({ HIDDEN_OFF: false, FROZEN: false, WALL: true, MACHINE: true });
    expect(model.entities.filter((e) => e.layer === "HIDDEN_OFF" || e.layer === "FROZEN")).toHaveLength(2);
  });

  it("expands blocks: normal, mirrored (exact circle) and array inserts", () => {
    const model = parseDxfText(factoryLayoutDxf());
    const circles = model.entities.filter((e) => e.type === "CIRCLE" && e.radius === 20);
    // 通常1 + 鏡像1 + 配列2x2=4 = 6個
    expect(circles).toHaveLength(6);
    const mirrored = circles.find((e) => e.type === "CIRCLE" && Math.abs(e.center.x - 900) < 1e-9 && Math.abs(e.center.y - 500) < 1e-9);
    expect(mirrored).toBeDefined();
  });

  it("draws the dimension through its anonymous block (line + text)", () => {
    const model = parseDxfText(factoryLayoutDxf());
    expect(model.entities.some((e) => e.type === "TEXT" && e.text === "500")).toBe(true);
    expect(model.entities.some((e) => e.layer === "DIM" && e.type === "LINE")).toBe(true);
  });

  it("turns a polyline bulge into an arc (more than the 2 straight vertices)", () => {
    const model = parseDxfText(factoryLayoutDxf());
    const bulged = model.entities.find((e) => e.type === "LWPOLYLINE" && !e.closed);
    expect(bulged?.type === "LWPOLYLINE" && bulged.vertices.length).toBeGreaterThan(4);
  });

  it("counts unsupported entities and keeps the supported ones", () => {
    const model = parseDxfText(unsupportedDxf());
    expect(model.entities).toHaveLength(1);
    expect(model.stats.unsupportedBreakdown).toEqual({ SOLID: 1 });
  });

  it("keeps deeply nested block references (no depth-related disappearance)", () => {
    const model = parseDxfText(nestedBlocksDxf(40));
    expect(model.entities).toHaveLength(1);
    const only = model.entities[0];
    expect(only.type === "LINE" && round(only.end.x)).toBe(50); // 40段の入れ子で1mmずつずれる + 線の長さ10
  });
});

describe("rendering: draw commands", () => {
  const model = parseDxfText(factoryLayoutDxf());
  const camera = cameraAt(0.8, 50, 650);

  it("matches the recorded draw commands", () => {
    const ctx = renderModel(model, camera);
    expect(summarizeStrokes(ctx)).toMatchSnapshot("strokes");
    expect(ctx.fills.map((f) => [f.style, f.ops])).toMatchSnapshot("fills");
    expect(ctx.fillTexts.sort()).toMatchSnapshot("texts");
  });

  it("does not draw entities of hidden (OFF / frozen) layers", () => {
    const ctx = renderModel(model, camera);
    // HIDDEN_OFFとFROZENはどちらも色番号6(マゼンタ)。表示中のレイヤーはこの色を使っていない
    expect(ctx.strokes.some((s) => s.style === "#ff00ff")).toBe(false);
  });

  it("draws dashed linetypes with a dash pattern and heavy lines wider than 1px", () => {
    const ctx = renderModel(model, camera);
    expect(ctx.strokes.some((s) => s.dash.length > 0)).toBe(true);
    expect(ctx.strokes.some((s) => s.width > 1)).toBe(true);
  });

  it("draws the POINT markers (circle + cross for PDMODE 35)", () => {
    const ctx = renderModel(model, camera);
    expect(ctx.strokes.some((s) => s.ops.some((op) => op[0] === "arc" && op[3] === 10 * 0.8 /* 半径 = PDSIZE/2 * scale */))).toBe(true);
  });

  it("draws exactly the same set of drawn entities with the spatial index when the view covers the drawing", () => {
    const withIndex = summarizeStrokes(renderModel(model, camera, { useIndex: true }));
    const withoutIndex = summarizeStrokes(renderModel(model, camera));
    expect(withIndex).toEqual(withoutIndex);
  });

  it("fits the view to visible layers only", () => {
    const visible = new Set(model.layers.filter((l) => l.visible).map((l) => l.name));
    const bounds = unionOfVisibleEntityBounds(model.entities, model.entityBounds, visible);
    expect(bounds?.max.y).toBeLessThan(700); // 非表示のHIDDEN_OFF(y=700)・FROZEN(y=800)は含めない
    const all = new Set(model.layers.map((l) => l.name));
    expect(unionOfVisibleEntityBounds(model.entities, model.entityBounds, all)?.max.y).toBe(800);
  });
});

describe("camera", () => {
  it("round-trips screen and world coordinates (Y flipped)", () => {
    const camera = cameraAt(2, 30, 400);
    const world = camera.screenToWorld({ x: 130, y: 300 });
    expect(world).toEqual({ x: 50, y: 50 });
    expect(camera.worldToScreen(world)).toEqual({ x: 130, y: 300 });
  });

  it("keeps the world point under the cursor fixed while zooming", () => {
    const camera = cameraAt(1, 0, 600);
    const cursor = { x: 200, y: 300 };
    const before = camera.screenToWorld(cursor);
    camera.zoomAt(cursor, 3);
    const after = camera.screenToWorld(cursor);
    expect(round(after.x)).toBe(round(before.x));
    expect(round(after.y)).toBe(round(before.y));
    expect(camera.scale).toBe(3);
  });

  it("fits bounds into the viewport with a margin and centers them", () => {
    const camera = new Camera();
    camera.fit({ min: { x: 0, y: 0 }, max: { x: 1000, y: 600 } }, 1000, 700);
    const topLeft = camera.worldToScreen({ x: 0, y: 600 });
    const bottomRight = camera.worldToScreen({ x: 1000, y: 0 });
    expect(topLeft.x).toBeGreaterThan(0);
    expect(bottomRight.x).toBeLessThan(1000);
    expect(round((topLeft.x + bottomRight.x) / 2)).toBe(500);
    expect(round((topLeft.y + bottomRight.y) / 2)).toBe(350);
  });
});

describe("selection and snapping", () => {
  const model = parseDxfText(factoryLayoutDxf());
  const index = buildSpatialIndex(model);
  const visible = new Set(model.layers.filter((l) => l.visible).map((l) => l.name));

  const probes: Array<[string, number, number]> = [
    ["circle rim", 400, 300],
    ["circle interior (empty)", 300, 300],
    ["wall bottom edge", 650, 0],
    ["heavy line", 250, 100],
    ["text", 150, 570],
    ["point", 500, 500],
    ["empty space", 600, 350],
  ];

  it("picks the expected entities at fixed points (with and without the index)", () => {
    const summarize = (useIndex: boolean) =>
      probes.map(([label, x, y]) => [
        label,
        findEntitiesNearPoint(model.entities, visible, { x, y }, 5, useIndex ? index : null).map((e) => `${e.type}@${e.layer}`),
      ]);
    expect(summarize(true)).toEqual(summarize(false));
    expect(summarize(false)).toMatchSnapshot("click selection");
  });

  it("selects by window and crossing boxes", () => {
    const box = { min: { x: 150, y: 150 }, max: { x: 550, y: 450 } };
    const summarize = (mode: "window" | "crossing") => findEntitiesInBox(model.entities, visible, box, mode, index).map((e) => `${e.type}@${e.layer}`);
    expect(summarize("window")).toMatchSnapshot("window selection");
    expect(summarize("crossing")).toMatchSnapshot("crossing selection");
    expect(summarize("crossing").length).toBeGreaterThanOrEqual(summarize("window").length);
  });

  it("does not select entities of hidden layers", () => {
    expect(findEntitiesNearPoint(model.entities, visible, { x: 500, y: 700 }, 5, index)).toEqual([]);
  });

  it("snaps to endpoint / midpoint / intersection / nearest as expected", () => {
    const snaps: Array<[string, number, number]> = [
      ["wall corner", 3, 4],
      ["wall bottom midpoint", 503, 3],
      ["near a line (nearest)", 650, 3.5],
      ["far from everything", 600, 350],
    ];
    const result = snaps.map(([label, x, y]) => [label, findSnapPoint(model.entities, visible, { x, y }, 10, index, { nearestToleranceWorld: 5 })]);
    expect(result).toMatchSnapshot("snap results");
  });
});
