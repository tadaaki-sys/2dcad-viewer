import { describe, expect, it } from "vitest";
import type { CadEntity, Point2D } from "../../types/cad";
import { findSnapPoint } from "../snap/SnapEngine";
import type { SnapOptions, SnapType } from "../snap/SnapEngine";
import { computeAllEntityBounds, unionOfEntityBounds } from "../spatial/entityBounds";
import { buildSpatialIndex } from "../spatial/SpatialIndex";
import { ACQUIRABLE_SNAP_TYPES, resolveCursor } from "./resolveCursor";
import type { ResolveCursorParams } from "./resolveCursor";
import { DEFAULT_TRACKING_SETTINGS } from "./trackingSettings";
import type { TrackingSettings } from "./trackingSettings";

const base0 = { layer: "A", color: "#ffffff" };
const line = (id: string, x0: number, y0: number, x1: number, y1: number): CadEntity => ({ ...base0, id, type: "LINE", start: { x: x0, y: y0 }, end: { x: x1, y: y1 } });
const circle = (id: string, x: number, y: number, r: number): CadEntity => ({ ...base0, id, type: "CIRCLE", center: { x, y }, radius: r });
const visible = new Set(["A"]);
const tracking = (overrides: Partial<TrackingSettings>): TrackingSettings => ({ ...DEFAULT_TRACKING_SETTINGS, ...overrides });

function resolve(entities: CadEntity[], worldPoint: Point2D, overrides: Partial<ResolveCursorParams> & { types: SnapType[] }) {
  const { types, ...rest } = overrides;
  const snapOptions: SnapOptions = { enabledTypes: new Set(types), nearestToleranceWorld: 5, gridSpacing: 10, ...(rest.snapOptions ?? {}) };
  return resolveCursor({
    entities,
    visibleLayerNames: visible,
    worldPoint,
    toleranceWorld: 2,
    snapOptions,
    base: null,
    tracking: DEFAULT_TRACKING_SETTINGS,
    acquired: [],
    ...rest,
  });
}

describe("priority: object snap > tracking > nearest > grid", () => {
  const wall = [line("wall", 0, 0, 1000, 0)]; // y=0 の長い線(端点は (0,0) と (1000,0))

  it("an object snap (endpoint) wins over tracking", () => {
    // 基準点 (1000, 200) から真下への極トラッキングの線は、端点 (1000,0) の近くを通る
    const result = resolve(wall, { x: 1000.5, y: 1 }, { types: ["endpoint", "nearest"], base: { x: 1000, y: 200 }, tracking: tracking({ polar: true, polarAngleIncrement: 90 }) });
    expect(result.snap?.type).toBe("endpoint");
    expect(result.point).toEqual({ x: 1000, y: 0 });
    expect(result.tracking).toBeNull();
  });

  it("tracking wins over the nearest point on a line", () => {
    const options = { types: ["nearest"] as SnapType[], base: { x: 500, y: 200 } };
    // 基準点 (500,200) から真下(270度)への線の近く (500.4, 3)。y=0 の線の上の最近点も、許容(5)の中にある
    const withPolar = resolve(wall, { x: 500.4, y: 3 }, { ...options, tracking: tracking({ polar: true, polarAngleIncrement: 90 }) });
    expect(withPolar.snap).toBeNull();
    expect(withPolar.tracking?.label).toBe("270°");
    expect(withPolar.point.x).toBeCloseTo(500, 9);
    expect(withPolar.point.y).toBeCloseTo(3, 9);
    // 極トラッキングがオフなら、最近点(y=0 の線の上)
    const without = resolve(wall, { x: 500.4, y: 3 }, options);
    expect(without.snap?.type).toBe("nearest");
    expect(without.point).toEqual({ x: 500.4, y: 0 });
  });

  it("nearest and grid still apply when tracking aligns to nothing", () => {
    const options = { base: { x: 500, y: 200 }, tracking: tracking({ polar: true, polarAngleIncrement: 90 }) };
    // 基準点の線から遠い (300, 3): 近接
    expect(resolve(wall, { x: 300, y: 3 }, { ...options, types: ["nearest", "grid"] }).snap?.type).toBe("nearest");
    // 図形からも遠い (303, 47): グリッド (300, 50)
    const grid = resolve(wall, { x: 303, y: 47 }, { ...options, types: ["nearest", "grid"] });
    expect(grid.snap?.type).toBe("grid");
    expect(grid.point).toEqual({ x: 300, y: 50 });
  });

  it("nothing to snap to: the pointer position itself", () => {
    const result = resolve(wall, { x: 303, y: 47 }, { types: [] });
    expect(result).toEqual({ point: { x: 303, y: 47 }, snap: null, tracking: null, acquirable: null });
  });
});

describe("acquirable snap points (for OTRACK)", () => {
  it("endpoint, midpoint, intersection, center and quadrant can be acquired; nearest and grid cannot", () => {
    expect([...ACQUIRABLE_SNAP_TYPES].sort()).toEqual(["center", "endpoint", "intersection", "midpoint", "quadrant"]);
    const entities = [line("l", 0, 0, 100, 0), circle("c", 300, 300, 50)];
    const endpoint = resolve(entities, { x: 0.5, y: 0.5 }, { types: ["endpoint", "nearest"] });
    expect(endpoint.acquirable?.type).toBe("endpoint");
    const center = resolve(entities, { x: 300.4, y: 299.6 }, { types: ["center"] });
    expect(center.acquirable).toEqual({ point: { x: 300, y: 300 }, type: "center" });
    const nearest = resolve(entities, { x: 40, y: 3 }, { types: ["nearest"] });
    expect(nearest.snap?.type).toBe("nearest");
    expect(nearest.acquirable).toBeNull();
    expect(resolve(entities, { x: 33, y: 47 }, { types: ["grid"] }).acquirable).toBeNull();
  });
});

describe("ORTHO with SNAP (grid)", () => {
  it("a purely orthogonal point snaps to the nearest grid point along the axis", () => {
    const result = resolve([], { x: 47, y: 4 }, { types: ["grid"], base: { x: 3, y: 3 }, tracking: tracking({ ortho: true }) });
    expect(result.point).toEqual({ x: 50, y: 3 }); // y は基準点のまま、x だけ格子
    const vertical = resolve([], { x: 4, y: -48 }, { types: ["grid"], base: { x: 3, y: 3 }, tracking: tracking({ ortho: true }) });
    expect(vertical.point).toEqual({ x: 3, y: -50 });
  });

  it("without SNAP the orthogonal point is kept exactly; an object snap overrides ORTHO", () => {
    expect(resolve([], { x: 47, y: 4 }, { types: [], base: { x: 3, y: 3 }, tracking: tracking({ ortho: true }) }).point).toEqual({ x: 47, y: 3 });
    const withEndpoint = resolve([line("l", 50, 40, 60, 90)], { x: 50.5, y: 40.4 }, { types: ["endpoint"], base: { x: 3, y: 3 }, tracking: tracking({ ortho: true }) });
    expect(withEndpoint.point).toEqual({ x: 50, y: 40 });
  });
});

describe("with the tracking turned off the result is exactly what findSnapPoint gives (existing behavior)", () => {
  it("random drawings and points, default Snap types", () => {
    const entities: CadEntity[] = [];
    for (let i = 0; i < 200; i++) {
      const x = ((i * 53) % 800) - 400;
      const y = ((i * 97) % 800) - 400;
      if (i % 3 === 0) entities.push(circle(`c${i}`, x, y, 5 + (i % 40)));
      else entities.push(line(`l${i}`, x, y, x + ((i * 7) % 120) - 60, y + ((i * 11) % 120) - 60));
    }
    const bounds = computeAllEntityBounds(entities);
    const index = buildSpatialIndex({ entityBounds: bounds, bounds: unionOfEntityBounds(bounds) });
    const types = new Set<SnapType>(["endpoint", "midpoint", "intersection", "center", "quadrant", "nearest", "grid"]);
    for (let n = 0; n < 200; n++) {
      const p = { x: ((n * 131) % 800) - 400, y: ((n * 71) % 800) - 400 };
      const options: SnapOptions = { enabledTypes: types, nearestToleranceWorld: 6, gridSpacing: 25, fromPoint: null };
      const direct = findSnapPoint(entities, visible, p, 4, index, options);
      const resolved = resolveCursor({
        entities,
        visibleLayerNames: visible,
        worldPoint: p,
        toleranceWorld: 4,
        index,
        snapOptions: options,
        base: null,
        tracking: DEFAULT_TRACKING_SETTINGS,
        acquired: [],
      });
      expect(resolved.point, `case ${n}`).toEqual(direct?.point ?? p);
      expect(resolved.snap?.type, `case ${n}`).toBe(direct?.type);
    }
  });
});
