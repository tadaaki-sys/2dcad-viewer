import { beforeAll, describe, expect, it } from "vitest";
import type { CadEntity, CadModel } from "../../types/cad";
import { Camera } from "../camera/Camera";
import { computeAllEntityBounds, unionOfEntityBounds } from "../spatial/entityBounds";
import { buildSpatialIndex } from "../spatial/SpatialIndex";
import { CanvasRenderer } from "./CanvasRenderer";
import type { RenderParams } from "./Renderer";

type Op = [string, ...number[]];

class RecordingPath {
  ops: Op[] = [];
  moveTo(x: number, y: number) { this.ops.push(["moveTo", x, y]); }
  lineTo(x: number, y: number) { this.ops.push(["lineTo", x, y]); }
  arc(x: number, y: number, r: number, a0: number, a1: number, ccw?: boolean) { this.ops.push(["arc", x, y, r, a0, a1, ccw ? 1 : 0]); }
  closePath() { this.ops.push(["closePath"]); }
}

class RecordingContext extends RecordingPath {
  strokes: Array<{ style: string; path: RecordingPath | null; width: number }> = [];
  strokeStyle = "";
  fillStyle = "";
  lineWidth = 1;
  font = "";
  textAlign = "";
  textBaseline = "";
  fillTexts: string[] = [];
  beginPath() { /* パス記録はops側で行う */ }
  stroke(path?: RecordingPath) { this.strokes.push({ style: this.strokeStyle, path: path ?? null, width: this.lineWidth }); }
  fillRect() {}
  strokeRect() {}
  save() {}
  restore() {}
  translate() {}
  rotate() {}
  setLineDash() {}
  fillText(text: string) { this.fillTexts.push(text); }
}

beforeAll(() => {
  (globalThis as unknown as { Path2D: typeof RecordingPath }).Path2D = RecordingPath;
});

const common = { layer: "A" } as const;

function line(id: string, x0: number, y0: number, x1: number, y1: number, color: string): CadEntity {
  return { id, type: "LINE", ...common, color, start: { x: x0, y: y0 }, end: { x: x1, y: y1 } };
}

function makeModel(entities: CadEntity[]): CadModel {
  const entityBounds = computeAllEntityBounds(entities);
  return {
    entities,
    entityBounds,
    layers: [{ name: "A", color: "#fff", visible: true }],
    bounds: unionOfEntityBounds(entityBounds),
    stats: { totalEntityCount: entities.length, supportedEntityCount: entities.length, unsupportedEntityCount: 0, unsupportedBreakdown: {} },
  };
}

function render(model: CadModel, camera: Camera, options: Partial<RenderParams> = {}, viewport = { w: 200, h: 100 }) {
  const ctx = new RecordingContext();
  new CanvasRenderer().render({
    ctx: ctx as unknown as CanvasRenderingContext2D,
    viewportWidth: viewport.w,
    viewportHeight: viewport.h,
    model,
    camera,
    visibleLayerNames: new Set(["A"]),
    selectedEntityIds: new Set(),
    dragSelectionBox: null,
    measurements: [],
    selectedMeasurementId: null,
    pendingMeasurementPoint: null,
    spatialIndex: null,
    ...options,
  });
  return ctx;
}

function camera(scale = 1, offsetX = 0, offsetY = 100): Camera {
  const c = new Camera();
  c.scale = scale;
  c.offsetX = offsetX;
  c.offsetY = offsetY;
  return c;
}

describe("CanvasRenderer batching", () => {
  it("strokes all entities of one color with a single stroke call", () => {
    const entities: CadEntity[] = [];
    for (let i = 0; i < 50; i++) entities.push(line(`r${i}`, i, 5, i + 3, 20, "#ff0000"));
    for (let i = 0; i < 30; i++) entities.push(line(`b${i}`, i, 40, i + 3, 60, "#0000ff"));

    const ctx = render(makeModel(entities), camera());

    expect(ctx.strokes.map((s) => s.style).sort()).toEqual(["#0000ff", "#ff0000"]);
    const red = ctx.strokes.find((s) => s.style === "#ff0000")!.path!;
    expect(red.ops.filter((op) => op[0] === "moveTo")).toHaveLength(50);
  });

  it("does not draw entities that are smaller than the minimum on-screen size", () => {
    const entities = [line("tiny", 10, 10, 10.2, 10.2, "#fff"), line("ok", 20, 20, 40, 20, "#fff")];

    const ctx = render(makeModel(entities), camera());

    const ops = ctx.strokes[0].path!.ops.filter((op) => op[0] === "moveTo");
    expect(ops).toHaveLength(1);
  });

  it("converts world to screen with the Y axis flipped", () => {
    const ctx = render(makeModel([line("l", 10, 20, 30, 40, "#fff")]), camera(2, 5, 100));

    const ops = ctx.strokes[0].path!.ops;
    expect(ops[0]).toEqual(["moveTo", 25, 60]);
    expect(ops[1]).toEqual(["lineTo", 65, 20]);
  });

  it("draws an ARC with the native arc call using flipped, counter-clockwise angles", () => {
    const arc: CadEntity = { id: "a", type: "ARC", ...common, color: "#fff", center: { x: 10, y: 20 }, radius: 5, startAngle: 0, endAngle: Math.PI / 2 };

    const ctx = render(makeModel([arc]), camera(1, 0, 100));

    const ops = ctx.strokes[0].path!.ops;
    expect(ops[0][0]).toBe("moveTo");
    expect(ops[0][1]).toBeCloseTo(15, 9);
    expect(ops[0][2]).toBeCloseTo(80, 9);
    const arcOp = ops[1];
    expect(arcOp.slice(0, 4)).toEqual(["arc", 10, 80, 5]);
    expect(arcOp[4]).toBeCloseTo(-0, 9);
    expect(arcOp[5]).toBeCloseTo(-Math.PI / 2, 9);
    expect(arcOp[6]).toBe(1);
  });

  it("draws a CIRCLE as a full native arc", () => {
    const circle: CadEntity = { id: "c", type: "CIRCLE", ...common, color: "#fff", center: { x: 10, y: 20 }, radius: 5 };
    const ctx = render(makeModel([circle]), camera(1, 0, 100));
    const arcOp = ctx.strokes[0].path!.ops[1];
    expect(arcOp[0]).toBe("arc");
    expect(arcOp[5] - arcOp[4]).toBeCloseTo(Math.PI * 2, 9);
  });

  it("draws selected entities in the highlight color instead of their own", () => {
    const entities = [line("sel", 0, 10, 50, 10, "#ff0000"), line("other", 0, 20, 50, 20, "#ff0000")];

    const ctx = render(makeModel(entities), camera(), { selectedEntityIds: new Set(["sel"]) });

    const red = ctx.strokes.find((s) => s.style === "#ff0000")!.path!;
    expect(red.ops.filter((op) => op[0] === "moveTo")).toHaveLength(1);
    expect(ctx.strokes.some((s) => s.style === "#ffff00" && s.path === null)).toBe(true);
  });

  it("draws TEXT through fillText, not through stroke batching", () => {
    const text: CadEntity = {
      id: "t", type: "TEXT", ...common, color: "#fff", position: { x: 10, y: 50 }, text: "ABC", height: 10, rotation: 0,
      horizontalAlign: "left", verticalAlign: "baseline",
    };
    const ctx = render(makeModel([text]), camera());
    expect(ctx.fillTexts).toEqual(["ABC"]);
    expect(ctx.strokes).toHaveLength(0);
  });
});

describe("CanvasRenderer viewport culling", () => {
  it("skips entities outside the view when a spatial index is available, matching a full scan for visible ones", () => {
    const entities: CadEntity[] = [];
    for (let i = 0; i < 400; i++) entities.push(line(`l${i}`, i * 20, 10, i * 20 + 15, 30, "#fff"));
    const model = makeModel(entities);
    const index = buildSpatialIndex(model);
    // 画面は x:0..200 だけを映す(エンティティは x:0..8000 に広がっている)
    const cam = camera(1, 0, 100);

    const withIndex = render(model, cam, { spatialIndex: index });
    const withoutIndex = render(model, cam);

    const drawn = (ctx: RecordingContext) => ctx.strokes[0].path!.ops.filter((op) => op[0] === "moveTo").length;
    expect(drawn(withIndex)).toBeLessThan(40);
    // 索引なしは全件を描画命令に積む(画面外はcanvas側で切られる)。索引ありが描く分は、その部分集合で画面内を欠かさない
    expect(drawn(withoutIndex)).toBe(400);
    const visibleXs = withoutIndex.strokes[0].path!.ops.filter((op) => op[0] === "moveTo" && op[1] <= 200).map((op) => op[1]);
    const indexedXs = withIndex.strokes[0].path!.ops.filter((op) => op[0] === "moveTo").map((op) => op[1]);
    for (const x of visibleXs) expect(indexedXs).toContain(x);
  });
});
