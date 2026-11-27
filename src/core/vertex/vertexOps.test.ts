// 折れ線の頂点の追加・削除・開閉(Phase 18)
import { describe, expect, it } from "vitest";
import type { CadEntity, Point2D } from "../../types/cad";
import { deleteVertexNear, insertVertexNear, minimumVertexCount, nearestVertex, setPolylineClosed } from "./vertexOps";

const pt = (x: number, y: number): Point2D => ({ x, y });
const base = { layer: "0", color: "#ffffff" };
const poly = (vertices: Point2D[], closed = false): CadEntity => ({ ...base, id: "p", type: "LWPOLYLINE", vertices, closed });
const verticesOf = (e: CadEntity) => (e.type === "LWPOLYLINE" ? e.vertices : []);
const square = (closed: boolean) => poly([pt(0, 0), pt(100, 0), pt(100, 100), pt(0, 100)], closed);

describe("insertVertexNear", () => {
  it("adds a vertex on the nearest segment, at the point of the segment closest to the click", () => {
    const r = insertVertexNear(square(false), pt(40, 7));
    expect(r.ok && verticesOf(r.entity)).toEqual([pt(0, 0), pt(40, 0), pt(100, 0), pt(100, 100), pt(0, 100)]);
  });

  it("the closing segment of a closed polyline counts; the new vertex goes at the end", () => {
    const r = insertVertexNear(square(true), pt(-5, 40));
    expect(r.ok && verticesOf(r.entity)).toEqual([pt(0, 0), pt(100, 0), pt(100, 100), pt(0, 100), pt(0, 40)]);
    // 開いた折れ線には、閉じる線分は無い
    const open = insertVertexNear(square(false), pt(-5, 40));
    expect(open.ok).toBe(false); // いちばん近い線分は、始点に当たるため、頂点と同じ位置として断られる
  });

  it("keeps the values the other vertices carry (bulge), and does not change the original", () => {
    const original = poly([{ x: 0, y: 0, bulge: 1 } as Point2D, pt(10, 0)]);
    const copy = JSON.stringify(original);
    const r = insertVertexNear(original, pt(5, 1));
    expect(r.ok && verticesOf(r.entity)[0]).toEqual({ x: 0, y: 0, bulge: 1 });
    expect(JSON.stringify(original)).toBe(copy);
  });

  it("refuses a click that lands on an existing vertex, non-polylines and bad points", () => {
    expect(insertVertexNear(square(false), pt(100, 0)).ok).toBe(false);
    expect(insertVertexNear(square(false), pt(0.0000000001, 0)).ok).toBe(false);
    expect(insertVertexNear({ ...base, id: "l", type: "LINE", start: pt(0, 0), end: pt(1, 1) }, pt(0.5, 0.5)).ok).toBe(false);
    expect(insertVertexNear(square(false), pt(Number.NaN, 0)).ok).toBe(false);
  });
});

describe("deleteVertexNear", () => {
  it("deletes the nearest vertex when the click is within the tolerance", () => {
    const r = deleteVertexNear(square(false), pt(98, 2), 5);
    expect(r.ok && verticesOf(r.entity)).toEqual([pt(0, 0), pt(100, 100), pt(0, 100)]);
  });

  it("refuses a click far from every vertex (a click in the middle of a segment must not remove a distant vertex)", () => {
    expect(deleteVertexNear(square(false), pt(50, 0), 5).ok).toBe(false);
  });

  it("keeps the minimum vertex count: 2 for an open polyline, 3 for a closed one", () => {
    expect(minimumVertexCount(false)).toBe(2);
    expect(minimumVertexCount(true)).toBe(3);
    expect(deleteVertexNear(poly([pt(0, 0), pt(10, 0)]), pt(0, 0), 5).ok).toBe(false);
    expect(deleteVertexNear(poly([pt(0, 0), pt(10, 0), pt(10, 10)], true), pt(0, 0), 5).ok).toBe(false);
    expect(deleteVertexNear(poly([pt(0, 0), pt(10, 0), pt(10, 10)], false), pt(0, 0), 5).ok).toBe(true);
  });

  it("nearestVertex finds the closest vertex, or null for a non-polyline", () => {
    expect(nearestVertex(square(false), pt(99, 99))).toMatchObject({ index: 2 });
    expect(nearestVertex({ ...base, id: "c", type: "CIRCLE", center: pt(0, 0), radius: 1 }, pt(0, 0))).toBeNull();
  });
});

describe("setPolylineClosed", () => {
  it("closes and opens; the same state, too few vertices and non-polylines are refused", () => {
    const closed = setPolylineClosed(square(false), true);
    expect(closed.ok && closed.entity.type === "LWPOLYLINE" && closed.entity.closed).toBe(true);
    const open = setPolylineClosed(square(true), false);
    expect(open.ok && open.entity.type === "LWPOLYLINE" && open.entity.closed).toBe(false);
    expect(setPolylineClosed(square(true), true).ok).toBe(false);
    expect(setPolylineClosed(square(false), false).ok).toBe(false);
    expect(setPolylineClosed(poly([pt(0, 0), pt(10, 0)]), true).ok).toBe(false);
    expect(setPolylineClosed({ ...base, id: "l", type: "LINE", start: pt(0, 0), end: pt(1, 1) }, true).ok).toBe(false);
  });
});
