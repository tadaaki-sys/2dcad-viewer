import { describe, expect, it } from "vitest";
import type { CadEntity } from "../../types/cad";
import { findEntitiesInBox, findEntitiesNearPoint } from "../selection/Selection";
import { findSnapPoint } from "../snap/SnapEngine";
import { BOUNDS_STRIDE, computeAllEntityBounds, unionOfEntityBounds, writeEntityBounds } from "./entityBounds";
import { SpatialGrid } from "./SpatialGrid";
import { buildSpatialIndex } from "./SpatialIndex";

function boundsOf(entity: CadEntity): number[] {
  const out = new Float64Array(BOUNDS_STRIDE);
  writeEntityBounds(entity, out, 0);
  return Array.from(out);
}

const base = { id: "e", layer: "A", color: "#fff" } as const;

describe("writeEntityBounds", () => {
  it("covers LINE, polyline, and spline points", () => {
    expect(boundsOf({ ...base, type: "LINE", start: { x: 5, y: 9 }, end: { x: -2, y: 3 } })).toEqual([-2, 3, 5, 9]);
    expect(
      boundsOf({ ...base, type: "LWPOLYLINE", closed: false, vertices: [{ x: 0, y: 0 }, { x: 4, y: -1 }, { x: 2, y: 7 }] }),
    ).toEqual([0, -1, 4, 7]);
    expect(
      boundsOf({ ...base, type: "SPLINE", closed: false, points: [{ x: 1, y: 1 }, { x: 3, y: 8 }] }),
    ).toEqual([1, 1, 3, 8]);
  });

  it("uses the analytic extent of a CIRCLE", () => {
    expect(boundsOf({ ...base, type: "CIRCLE", center: { x: 10, y: 20 }, radius: 5 })).toEqual([5, 15, 15, 25]);
  });

  it("includes axis extremes only when the ARC sweeps through them", () => {
    // 10度〜80度: +X/+Yの極値は含まない(端点だけ)
    const small = boundsOf({
      ...base, type: "ARC", center: { x: 0, y: 0 }, radius: 10, startAngle: (10 * Math.PI) / 180, endAngle: (80 * Math.PI) / 180,
    });
    expect(small[2]).toBeCloseTo(10 * Math.cos((10 * Math.PI) / 180), 9);
    expect(small[3]).toBeCloseTo(10 * Math.sin((80 * Math.PI) / 180), 9);

    // 300度〜60度(0度をまたぐ): +Xの極値(半径)を含む
    const wrap = boundsOf({
      ...base, type: "ARC", center: { x: 0, y: 0 }, radius: 10, startAngle: (300 * Math.PI) / 180, endAngle: (60 * Math.PI) / 180,
    });
    expect(wrap[2]).toBeCloseTo(10, 9);
    expect(wrap[1]).toBeCloseTo(-10 * Math.sin((60 * Math.PI) / 180), 9);
  });

  it("contains the whole tessellated ELLIPSE with a safety margin", () => {
    const b = boundsOf({
      ...base, type: "ELLIPSE", center: { x: 0, y: 0 }, majorRadius: 10, minorRadius: 4, rotation: 0, startParam: 0, endParam: Math.PI * 2,
    });
    expect(b[0]).toBeLessThanOrEqual(-10);
    expect(b[2]).toBeGreaterThanOrEqual(10);
    expect(b[1]).toBeLessThanOrEqual(-4);
    expect(b[3]).toBeGreaterThanOrEqual(4);
  });

  it("treats entities with non-finite coordinates as covering everything", () => {
    expect(boundsOf({ ...base, type: "LINE", start: { x: NaN, y: 0 }, end: { x: 1, y: 1 } })).toEqual([-Infinity, -Infinity, Infinity, Infinity]);
  });
});

describe("unionOfEntityBounds", () => {
  it("ignores unbounded entries and returns null when nothing is finite", () => {
    const entities: CadEntity[] = [
      { ...base, type: "LINE", start: { x: 0, y: 0 }, end: { x: 10, y: 5 } },
      { ...base, type: "LINE", start: { x: NaN, y: 0 }, end: { x: 1, y: 1 } },
      { ...base, type: "CIRCLE", center: { x: -20, y: 30 }, radius: 2 },
    ];
    expect(unionOfEntityBounds(computeAllEntityBounds(entities))).toEqual({ min: { x: -22, y: 0 }, max: { x: 10, y: 32 } });
    expect(unionOfEntityBounds(new Float64Array(0))).toBeNull();
  });
});

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomEntities(count: number, seed: number): CadEntity[] {
  const rand = mulberry32(seed);
  const range = 1000;
  const entities: CadEntity[] = [];
  for (let i = 0; i < count; i++) {
    const x = rand() * range;
    const y = rand() * range;
    const common = { id: `e${i}`, layer: rand() < 0.2 ? "B" : "A", color: "#fff" } as const;
    const kind = Math.floor(rand() * 6);
    if (kind === 0) entities.push({ ...common, type: "LINE", start: { x, y }, end: { x: x + rand() * 60 - 30, y: y + rand() * 60 - 30 } });
    else if (kind === 1) entities.push({ ...common, type: "CIRCLE", center: { x, y }, radius: 1 + rand() * 25 });
    else if (kind === 2) {
      entities.push({ ...common, type: "ARC", center: { x, y }, radius: 1 + rand() * 25, startAngle: rand() * 6, endAngle: rand() * 6 });
    } else if (kind === 3) {
      entities.push({
        ...common, type: "LWPOLYLINE", closed: rand() < 0.5,
        vertices: [{ x, y }, { x: x + rand() * 40, y: y + rand() * 40 }, { x: x + rand() * 40 - 20, y: y + rand() * 40 }],
      });
    } else if (kind === 4) {
      entities.push({
        ...common, type: "TEXT", position: { x, y }, text: "ABC", height: 2 + rand() * 6, rotation: rand() * 6,
        horizontalAlign: "left", verticalAlign: "baseline",
      });
    } else {
      entities.push({ ...common, type: "LINE", start: { x: 0, y: y }, end: { x: range, y: y + 3 } }); // 全幅にまたがる長い線
    }
  }
  return entities;
}

describe("SpatialGrid", () => {
  const entities = randomEntities(2000, 1);
  const bounds = computeAllEntityBounds(entities);
  const world = unionOfEntityBounds(bounds);
  const grid = new SpatialGrid(bounds, world);

  function bruteForce(minX: number, minY: number, maxX: number, maxY: number): number[] {
    const result: number[] = [];
    for (let i = 0; i < entities.length; i++) {
      const o = i * BOUNDS_STRIDE;
      if (bounds[o] <= maxX && bounds[o + 2] >= minX && bounds[o + 1] <= maxY && bounds[o + 3] >= minY) result.push(i);
    }
    return result;
  }

  it("returns exactly the entities whose bounds intersect the rectangle, in ascending order, without duplicates", () => {
    const rand = mulberry32(7);
    for (let n = 0; n < 200; n++) {
      const x = rand() * 1100 - 50;
      const y = rand() * 1100 - 50;
      const w = rand() * 300;
      const h = rand() * 300;
      expect(grid.queryRect(x, y, x + w, y + h)).toEqual(bruteForce(x, y, x + w, y + h));
    }
  });

  it("returns the same set unsorted when ordering is not needed", () => {
    const sorted = grid.queryRect(100, 100, 400, 400);
    const unsorted = grid.queryRect(100, 100, 400, 400, false);
    expect([...unsorted].sort((a, b) => a - b)).toEqual(sorted);
  });

  it("finds entities when the query rectangle extends beyond the world bounds", () => {
    expect(grid.queryRect(-1e9, -1e9, 1e9, 1e9)).toEqual(bruteForce(-1e9, -1e9, 1e9, 1e9));
  });

  it("finds unbounded entities from anywhere", () => {
    const withUnbounded: CadEntity[] = [
      { ...base, id: "inf", type: "LINE", start: { x: NaN, y: 0 }, end: { x: 1, y: 1 } },
      { ...base, id: "near", type: "LINE", start: { x: 0, y: 0 }, end: { x: 1, y: 1 } },
    ];
    const b = computeAllEntityBounds(withUnbounded);
    const g = new SpatialGrid(b, unionOfEntityBounds(b));
    expect(g.queryRect(500, 500, 501, 501)).toEqual([0]);
  });

  it("handles an empty model", () => {
    const g = new SpatialGrid(new Float64Array(0), null);
    expect(g.queryRect(0, 0, 10, 10)).toEqual([]);
  });
});

describe("indexed selection and snapping match a full scan", () => {
  const entities = randomEntities(3000, 3);
  const model = { entityBounds: computeAllEntityBounds(entities), bounds: null as ReturnType<typeof unionOfEntityBounds> };
  model.bounds = unionOfEntityBounds(model.entityBounds);
  const index = buildSpatialIndex(model);
  const visible = new Set(["A"]);

  it("findEntitiesNearPoint returns identical results in identical order", () => {
    const rand = mulberry32(11);
    for (let n = 0; n < 150; n++) {
      const p = { x: rand() * 1000, y: rand() * 1000 };
      const tol = [0.5, 3, 25][n % 3];
      const full = findEntitiesNearPoint(entities, visible, p, tol).map((e) => e.id);
      const indexed = findEntitiesNearPoint(entities, visible, p, tol, index).map((e) => e.id);
      expect(indexed).toEqual(full);
    }
  });

  it("findEntitiesInBox returns identical results for both modes", () => {
    const rand = mulberry32(13);
    for (let n = 0; n < 60; n++) {
      const x = rand() * 900;
      const y = rand() * 900;
      const box = { min: { x, y }, max: { x: x + rand() * 200, y: y + rand() * 200 } };
      for (const mode of ["window", "crossing"] as const) {
        const full = findEntitiesInBox(entities, visible, box, mode).map((e) => e.id);
        const indexed = findEntitiesInBox(entities, visible, box, mode, index).map((e) => e.id);
        expect(indexed).toEqual(full);
      }
    }
  });

  it("findSnapPoint returns the identical snap candidate", () => {
    const rand = mulberry32(17);
    for (let n = 0; n < 150; n++) {
      const p = { x: rand() * 1000, y: rand() * 1000 };
      const tol = [1, 5, 20][n % 3];
      expect(findSnapPoint(entities, visible, p, tol, index)).toEqual(findSnapPoint(entities, visible, p, tol));
    }
  });
});
