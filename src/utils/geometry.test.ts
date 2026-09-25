import { describe, expect, it } from "vitest";
import { distance, pointToSegmentDistance, polylineLength, segmentsIntersect } from "./geometry";

describe("distance", () => {
  it("computes euclidean distance between two points", () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
});

describe("pointToSegmentDistance", () => {
  it("returns 0 for a point on the segment", () => {
    expect(pointToSegmentDistance({ x: 5, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(0);
  });

  it("returns perpendicular distance for a point beside the segment", () => {
    expect(pointToSegmentDistance({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(3);
  });

  it("returns distance to the nearest endpoint when the closest point is beyond the segment", () => {
    expect(pointToSegmentDistance({ x: -4, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(4);
    expect(pointToSegmentDistance({ x: 14, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(4);
  });

  it("falls back to point distance for a degenerate zero-length segment", () => {
    expect(pointToSegmentDistance({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(5);
  });
});

describe("segmentsIntersect", () => {
  it("detects a simple crossing X shape", () => {
    expect(segmentsIntersect({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 })).toBe(true);
  });

  it("returns false for segments that do not cross", () => {
    expect(segmentsIntersect({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 5 }, { x: 10, y: 5 })).toBe(false);
  });

  it("returns false for parallel segments", () => {
    expect(segmentsIntersect({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 1 }, { x: 10, y: 1 })).toBe(false);
  });

  it("treats a touching endpoint as an intersection", () => {
    expect(segmentsIntersect({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 })).toBe(true);
  });

  it("returns false when segments would cross only if extended beyond their endpoints", () => {
    expect(segmentsIntersect({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 10 }, { x: 1, y: 9 })).toBe(false);
  });
});

describe("polylineLength", () => {
  it("sums segment lengths for an open polyline", () => {
    const vertices = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];
    expect(polylineLength(vertices, false)).toBe(20);
  });

  it("adds the closing segment for a closed polyline", () => {
    const vertices = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(polylineLength(vertices, true)).toBe(40);
  });

  it("does not add a closing segment for a closed polyline with fewer than 3 vertices", () => {
    const vertices = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ];
    expect(polylineLength(vertices, true)).toBe(10);
  });
});
