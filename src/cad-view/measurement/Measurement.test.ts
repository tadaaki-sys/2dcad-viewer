import { describe, expect, it } from "vitest";
import { computeMeasurementDistances, findMeasurementAtPoint } from "./Measurement";
import type { Measurement } from "../../types/cad";

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

describe("findMeasurementAtPoint", () => {
  const measurementA: Measurement = { id: "m-1", pointA: { x: 0, y: 0 }, pointB: { x: 10, y: 10 } };
  const measurementB: Measurement = { id: "m-2", pointA: { x: 20, y: 0 }, pointB: { x: 30, y: 0 } };

  it("finds a measurement by its Point A marker", () => {
    const result = findMeasurementAtPoint([measurementA, measurementB], { x: 0.2, y: 0.1 }, 1);
    expect(result?.id).toBe("m-1");
  });

  it("finds a measurement by its direct line", () => {
    const result = findMeasurementAtPoint([measurementA, measurementB], { x: 5, y: 5.2 }, 1);
    expect(result?.id).toBe("m-1");
  });

  it("finds a measurement by its horizontal helper line", () => {
    // horizontal helper for measurementA runs from (0,0) to (10,0)
    const result = findMeasurementAtPoint([measurementA, measurementB], { x: 5, y: 0.2 }, 1);
    expect(result?.id).toBe("m-1");
  });

  it("finds a measurement by its vertical helper line", () => {
    // vertical helper for measurementA runs from (10,0) to (10,10)
    const result = findMeasurementAtPoint([measurementA, measurementB], { x: 10.2, y: 5 }, 1);
    expect(result?.id).toBe("m-1");
  });

  it("returns the nearest measurement when multiple are within tolerance", () => {
    const result = findMeasurementAtPoint([measurementA, measurementB], { x: 20.1, y: 0.1 }, 5);
    expect(result?.id).toBe("m-2");
  });

  it("returns null when nothing is within tolerance", () => {
    const result = findMeasurementAtPoint([measurementA, measurementB], { x: 100, y: 100 }, 1);
    expect(result).toBeNull();
  });
});
