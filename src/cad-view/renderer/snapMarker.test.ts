import { describe, expect, it } from "vitest";
import type { Camera } from "../../core/view/Camera";
import type { Point2D } from "../../types/cad";
import { drawGrid, MIN_GRID_SCREEN_SPACING_PX } from "./snapMarker";

/** 表示範囲(ワールド)と、拡大率を指定できる、簡単なカメラ(画面の左上が (minX, maxY)。Y軸は上向き) */
function fakeCamera(minX: number, maxY: number, scale: number): Camera {
  return {
    scale,
    screenToWorld: (p: Point2D) => ({ x: minX + p.x / scale, y: maxY - p.y / scale }),
    worldToScreen: (p: Point2D) => ({ x: (p.x - minX) * scale, y: (maxY - p.y) * scale }),
  } as unknown as Camera;
}

function fakeContext() {
  const calls = { fillRect: 0 };
  const ctx = {
    save: () => undefined,
    restore: () => undefined,
    fillStyle: "",
    fillRect: () => {
      calls.fillRect++;
    },
  } as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

describe("drawGrid", () => {
  it("draws one dot per grid point in view", () => {
    const { ctx, calls } = fakeContext();
    drawGrid(ctx, fakeCamera(0, 100, 1), 100, 100, 10); // ワールド 0〜100 → 格子番号 0〜10 の 11 × 11
    expect(calls.fillRect).toBe(11 * 11);
  });

  it("draws nothing when the on-screen spacing is too small, and for an unusable spacing", () => {
    const smallSpacing = fakeContext();
    drawGrid(smallSpacing.ctx, fakeCamera(0, 100, 1), 100, 100, MIN_GRID_SCREEN_SPACING_PX - 1);
    expect(smallSpacing.calls.fillRect).toBe(0);
    for (const spacing of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const { ctx, calls } = fakeContext();
      drawGrid(ctx, fakeCamera(0, 100, 1), 100, 100, spacing);
      expect(calls.fillRect, String(spacing)).toBe(0);
    }
  });

  it("returns at once (no endless loop) when the grid numbers are too large to count exactly", () => {
    // 表示範囲が X=1e16〜1e16+100: 格子番号が 2^53 を超え、番号を1つ増やしても値が変わらない
    const { ctx, calls } = fakeContext();
    drawGrid(ctx, fakeCamera(1e16, 100, 8), 800, 800, 1);
    expect(calls.fillRect).toBe(0);
    const negative = fakeContext();
    drawGrid(negative.ctx, fakeCamera(-1e16, 100, 8), 800, 800, 1);
    expect(negative.calls.fillRect).toBe(0);
  });

  it("works for large but countable coordinates (and negative ones)", () => {
    const { ctx, calls } = fakeContext();
    drawGrid(ctx, fakeCamera(1e12, 1e12 + 100, 1), 100, 100, 10);
    expect(calls.fillRect).toBeGreaterThan(0);
    expect(calls.fillRect).toBeLessThanOrEqual(121);
    const negative = fakeContext();
    drawGrid(negative.ctx, fakeCamera(-1000, -900, 1), 100, 100, 10);
    expect(negative.calls.fillRect).toBe(11 * 11);
  });
});
