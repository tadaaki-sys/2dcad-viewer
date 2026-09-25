import { describe, expect, it } from "vitest";
import { Camera } from "./Camera";

describe("Camera", () => {
  it("flips Y axis when converting world to screen", () => {
    const camera = new Camera();
    camera.scale = 1;
    camera.offsetX = 0;
    camera.offsetY = 0;

    expect(camera.worldToScreen({ x: 10, y: 20 })).toEqual({ x: 10, y: -20 });
  });

  it("round-trips worldToScreen and screenToWorld", () => {
    const camera = new Camera();
    camera.scale = 2.5;
    camera.offsetX = 37;
    camera.offsetY = -14;

    const worldPoint = { x: 123.4, y: -56.7 };
    const screenPoint = camera.worldToScreen(worldPoint);
    const roundTripped = camera.screenToWorld(screenPoint);

    expect(roundTripped.x).toBeCloseTo(worldPoint.x, 9);
    expect(roundTripped.y).toBeCloseTo(worldPoint.y, 9);
  });

  it("fits bounds so the content is centered and scaled to the limiting axis", () => {
    const camera = new Camera();
    const bounds = { min: { x: 0, y: 0 }, max: { x: 100, y: 50 } };

    camera.fit(bounds, 200, 200, 0);

    // width needs scale 2 (200/100), height needs scale 4 (200/50) -> limited by width
    expect(camera.scale).toBeCloseTo(2, 9);

    const center = camera.worldToScreen({ x: 50, y: 25 });
    expect(center.x).toBeCloseTo(100, 9);
    expect(center.y).toBeCloseTo(100, 9);
  });

  it("falls back to a default scale for degenerate (zero-size) bounds", () => {
    const camera = new Camera();
    const bounds = { min: { x: 10, y: 10 }, max: { x: 10, y: 10 } };

    camera.fit(bounds, 200, 200, 0);

    expect(camera.scale).toBe(1);
    expect(Number.isFinite(camera.offsetX)).toBe(true);
    expect(Number.isFinite(camera.offsetY)).toBe(true);
  });

  it("keeps the world point under the cursor fixed on screen when zooming", () => {
    const camera = new Camera();
    camera.scale = 2;
    camera.offsetX = 10;
    camera.offsetY = 20;

    const cursorScreenPoint = { x: 150, y: 80 };
    const worldPointBefore = camera.screenToWorld(cursorScreenPoint);

    camera.zoomAt(cursorScreenPoint, 3);

    expect(camera.scale).toBeCloseTo(6, 9);
    const screenPointAfter = camera.worldToScreen(worldPointBefore);
    expect(screenPointAfter.x).toBeCloseTo(cursorScreenPoint.x, 9);
    expect(screenPointAfter.y).toBeCloseTo(cursorScreenPoint.y, 9);
  });

  it("clamps zoom scale within a sane min/max range", () => {
    const camera = new Camera();
    camera.scale = 1;

    camera.zoomAt({ x: 0, y: 0 }, 1e-12);
    expect(camera.scale).toBeGreaterThan(0);
    expect(Number.isFinite(camera.scale)).toBe(true);

    camera.zoomAt({ x: 0, y: 0 }, 1e12);
    expect(Number.isFinite(camera.scale)).toBe(true);
  });

  it("pans by translating the screen-space offset directly", () => {
    const camera = new Camera();
    camera.scale = 2;
    camera.offsetX = 10;
    camera.offsetY = 20;

    camera.pan(5, -8);

    expect(camera.offsetX).toBe(15);
    expect(camera.offsetY).toBe(12);
  });
});
