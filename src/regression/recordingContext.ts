// CanvasRendererの描画命令を記録するための偽のCanvasコンテキスト。実際に描かず、呼ばれた命令だけを残す。
import { CanvasRenderer } from "../cad-view/renderer/CanvasRenderer";
import type { RenderParams } from "../cad-view/renderer/Renderer";
import { Camera } from "../cad-view/camera/Camera";
import type { CadModel } from "../types/cad";
import { buildSpatialIndex } from "../cad-view/spatial/SpatialIndex";

export type Op = [string, ...number[]];

export class RecordingPath {
  ops: Op[] = [];
  moveTo(x: number, y: number) { this.ops.push(["moveTo", x, y]); }
  lineTo(x: number, y: number) { this.ops.push(["lineTo", x, y]); }
  arc(x: number, y: number, r: number, a0: number, a1: number, ccw?: boolean) { this.ops.push(["arc", x, y, r, a0, a1, ccw ? 1 : 0]); }
  closePath() { this.ops.push(["closePath"]); }
  rect(x: number, y: number, w: number, h: number) { this.ops.push(["rect", x, y, w, h]); }
}

export type StrokeRecord = { style: string; width: number; dash: number[]; ops: Op[] };

export class RecordingContext extends RecordingPath {
  strokes: StrokeRecord[] = [];
  fills: Array<{ style: string; ops: Op[] }> = [];
  fillTexts: string[] = [];
  strokeStyle = "";
  fillStyle = "";
  lineWidth = 1;
  font = "";
  textAlign = "";
  textBaseline = "";
  private currentDash: number[] = [];
  beginPath() { /* パスの記録はopsで行う */ }
  stroke(path?: RecordingPath) {
    this.strokes.push({ style: this.strokeStyle, width: this.lineWidth, dash: [...this.currentDash], ops: path ? path.ops : [] });
  }
  fill(path?: RecordingPath) { this.fills.push({ style: this.fillStyle, ops: path ? path.ops : [] }); }
  fillRect() {}
  strokeRect() {}
  save() {}
  restore() {}
  translate() {}
  rotate() {}
  scale() {}
  setLineDash(dash: number[]) { this.currentDash = dash; }
  fillText(text: string) { this.fillTexts.push(text); }
}

export function installRecordingPath2D(): void {
  (globalThis as unknown as { Path2D: typeof RecordingPath }).Path2D = RecordingPath;
}

export function cameraAt(scale: number, offsetX: number, offsetY: number): Camera {
  const camera = new Camera();
  camera.scale = scale;
  camera.offsetX = offsetX;
  camera.offsetY = offsetY;
  return camera;
}

export function renderModel(
  model: CadModel,
  camera: Camera,
  options: Partial<RenderParams> & { useIndex?: boolean } = {},
  viewport = { w: 1000, h: 700 },
): RecordingContext {
  const { useIndex, ...rest } = options;
  const ctx = new RecordingContext();
  new CanvasRenderer().render({
    ctx: ctx as unknown as CanvasRenderingContext2D,
    viewportWidth: viewport.w,
    viewportHeight: viewport.h,
    model,
    camera,
    visibleLayerNames: new Set(model.layers.filter((l) => l.visible).map((l) => l.name)),
    selectedEntityIds: new Set(),
    dragSelectionBox: null,
    measurements: [],
    selectedMeasurementId: null,
    pendingMeasurementPoint: null,
    spatialIndex: useIndex ? buildSpatialIndex(model) : null,
    ...rest,
  });
  return ctx;
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;

/** 描画命令を、比較しやすい(丸めた)形にする */
export function summarizeStrokes(ctx: RecordingContext) {
  return ctx.strokes
    .map((s) => ({
      style: s.style,
      width: round(s.width),
      dash: s.dash.map(round),
      ops: s.ops.map((op) => [op[0], ...(op.slice(1) as number[]).map(round)]),
    }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}
