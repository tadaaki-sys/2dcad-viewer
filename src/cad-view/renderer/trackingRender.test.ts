import { describe, expect, it } from "vitest";
import type { Camera } from "../../core/view/Camera";
import type { TrackingGuide } from "../../core/tracking/trackingGeometry";
import type { Point2D } from "../../types/cad";
import { clipGuideToViewport, drawTracking } from "./trackingRender";

describe("clipGuideToViewport", () => {
  it("a two-sided line through the screen is cut at the edges", () => {
    const clipped = clipGuideToViewport(500, 300, 1, 0, false, 1000, 600);
    expect(clipped).not.toBeNull();
    expect(clipped!.y0).toBe(300);
    expect(clipped!.y1).toBe(300);
    expect(clipped!.x0).toBeCloseTo(-1, 9); // 画面の端の少し外
    expect(clipped!.x1).toBeCloseTo(1001, 9);
  });

  it("a one-sided ray starts at its origin and goes only one way", () => {
    const clipped = clipGuideToViewport(500, 300, 1, 0, true, 1000, 600);
    expect(clipped!.x0).toBe(500);
    expect(clipped!.x1).toBeCloseTo(1001, 9);
    // 画面の外に向かう半直線
    expect(clipGuideToViewport(500, 300, -1, 0, true, 1000, 600)!.x1).toBeCloseTo(-1, 9);
  });

  it("an origin far off-screen: the part that is on the screen is still found (Codex review)", () => {
    // 起点が、画面の左へ 10000px。水平な両側の直線は、画面を横切る
    const line = clipGuideToViewport(-10_000, 300, 1, 0, false, 1000, 1000);
    expect(line).not.toBeNull();
    expect(line!.x0).toBeCloseTo(-1, 9);
    expect(line!.x1).toBeCloseTo(1001, 9);
    // その点から右へ延びる半直線も、画面を横切る。左へ延びる半直線は、画面にかからない
    expect(clipGuideToViewport(-10_000, 300, 1, 0, true, 1000, 1000)).not.toBeNull();
    expect(clipGuideToViewport(-10_000, 300, -1, 0, true, 1000, 1000)).toBeNull();
    // 斜めの線
    const diagonal = clipGuideToViewport(-5000, -5000, Math.SQRT1_2, Math.SQRT1_2, true, 1000, 1000);
    expect(diagonal).not.toBeNull();
    expect(diagonal!.x0).toBeCloseTo(-1, 6);
  });

  it("a line that misses the screen, or runs parallel outside it, gives null", () => {
    expect(clipGuideToViewport(500, 2000, 1, 0, false, 1000, 600)).toBeNull(); // 水平で、画面の下
    expect(clipGuideToViewport(2000, 300, 0, 1, false, 1000, 600)).toBeNull(); // 垂直で、画面の右
    expect(clipGuideToViewport(2000, 2000, Math.SQRT1_2, Math.SQRT1_2, true, 1000, 600)).toBeNull();
    expect(clipGuideToViewport(Number.NaN, 0, 1, 0, false, 1000, 600)).toBeNull();
    expect(clipGuideToViewport(0, 0, Number.POSITIVE_INFINITY, 0, false, 1000, 600)).toBeNull();
  });
});

describe("drawTracking", () => {
  function fakeCamera(): Camera {
    return { scale: 1, worldToScreen: (p: Point2D) => ({ x: p.x, y: 600 - p.y }), screenToWorld: (p: Point2D) => ({ x: p.x, y: 600 - p.y }) } as unknown as Camera;
  }
  function fakeContext() {
    const calls: string[] = [];
    const ctx = {
      save: () => calls.push("save"),
      restore: () => calls.push("restore"),
      beginPath: () => undefined,
      moveTo: (x: number, y: number) => calls.push(`moveTo ${Math.round(x)},${Math.round(y)}`),
      lineTo: (x: number, y: number) => calls.push(`lineTo ${Math.round(x)},${Math.round(y)}`),
      stroke: () => calls.push("stroke"),
      fillText: (text: string) => calls.push(`text ${text}`),
      setLineDash: () => undefined,
      strokeStyle: "",
      fillStyle: "",
      lineWidth: 1,
      font: "",
    } as unknown as CanvasRenderingContext2D;
    return { ctx, calls };
  }

  it("draws a guide whose origin is far away from the screen", () => {
    const { ctx, calls } = fakeContext();
    const guide: TrackingGuide = { kind: "object", origin: { x: -10_000, y: 300 }, angleDeg: 0, oneSided: false };
    drawTracking(ctx, fakeCamera(), 1000, 600, [guide], [], null);
    expect(calls.filter((c) => c === "stroke")).toHaveLength(1);
    expect(calls.some((c) => c.startsWith("moveTo -1,"))).toBe(true);
    expect(calls.some((c) => c.startsWith("lineTo 1001,"))).toBe(true);
  });

  it("draws nothing for no guides and no acquired points; skips a guide that is off the screen; draws the label", () => {
    const empty = fakeContext();
    drawTracking(empty.ctx, fakeCamera(), 1000, 600, [], [], null);
    expect(empty.calls).toEqual([]);
    const off = fakeContext();
    drawTracking(off.ctx, fakeCamera(), 1000, 600, [{ kind: "polar", origin: { x: 500, y: 5000 }, angleDeg: 0, oneSided: true }], [], null);
    expect(off.calls.filter((c) => c === "stroke")).toHaveLength(0);
    const labelled = fakeContext();
    drawTracking(labelled.ctx, fakeCamera(), 1000, 600, [], [{ x: 100, y: 100 }], { point: { x: 100, y: 100 }, text: "45°" });
    expect(labelled.calls).toContain("text 45°");
  });
});
