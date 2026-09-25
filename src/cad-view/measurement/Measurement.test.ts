import { describe, expect, it } from "vitest";
import { computeMeasurementDistances } from "./Measurement";

describe("computeMeasurementDistances", () => {
  it("computes horizontal, vertical, and direct distance for a 3-4-5 triangle", () => {
    const result = computeMeasurementDistances({ x: 0, y: 0 }, { x: 3, y: 4 });
    expect(result.horizontal).toBe(3);
    expect(result.vertical).toBe(4);
    expect(result.direct).toBe(5);
  });

  it("uses absolute values regardless of point order", () => {
    const result = computeMeasurementDistances({ x: 10, y: 10 }, { x: 3, y: 4 });
    expect(result.horizontal).toBe(7);
    expect(result.vertical).toBe(6);
  });

  it("returns zero vertical distance for a purely horizontal measurement", () => {
    const result = computeMeasurementDistances({ x: 0, y: 5 }, { x: 12, y: 5 });
    expect(result.horizontal).toBe(12);
    expect(result.vertical).toBe(0);
    expect(result.direct).toBe(12);
  });

  it("returns zero horizontal distance for a purely vertical measurement", () => {
    const result = computeMeasurementDistances({ x: 5, y: 0 }, { x: 5, y: 8 });
    expect(result.horizontal).toBe(0);
    expect(result.vertical).toBe(8);
    expect(result.direct).toBe(8);
  });
});
