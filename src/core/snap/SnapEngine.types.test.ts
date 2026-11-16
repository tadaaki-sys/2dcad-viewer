// 新しい Snap の種類(中心・四半円点・垂線・接線・延長・グリッド・円が絡む交点)のテスト(Phase 7)
import { describe, expect, it } from "vitest";
import type { CadEntity, Point2D } from "../../types/cad";
import { computeAllEntityBounds, unionOfEntityBounds } from "../spatial/entityBounds";
import { buildSpatialIndex } from "../spatial/SpatialIndex";
import { findSnapPoint, nearestGridPoint } from "./SnapEngine";
import type { SnapOptions, SnapType } from "./SnapEngine";

const base = { layer: "A", color: "#ffffff" };
const line = (id: string, x0: number, y0: number, x1: number, y1: number): CadEntity => ({
  ...base,
  id,
  type: "LINE",
  start: { x: x0, y: y0 },
  end: { x: x1, y: y1 },
});
const circle = (id: string, x: number, y: number, r: number): CadEntity => ({ ...base, id, type: "CIRCLE", center: { x, y }, radius: r });
const deg = (d: number) => (d * Math.PI) / 180;
const arc = (id: string, x: number, y: number, r: number, from: number, to: number): CadEntity => ({
  ...base,
  id,
  type: "ARC",
  center: { x, y },
  radius: r,
  startAngle: deg(from),
  endAngle: deg(to),
});

const visible = new Set(["A"]);
const only = (...types: SnapType[]): SnapOptions => ({ enabledTypes: new Set(types) });
const snap = (entities: CadEntity[], p: Point2D, tol: number, options: SnapOptions) => findSnapPoint(entities, visible, p, tol, undefined, options);

function indexOf(entities: CadEntity[]) {
  const bounds = computeAllEntityBounds(entities);
  return buildSpatialIndex({ entityBounds: bounds, bounds: unionOfEntityBounds(bounds) });
}

describe("center", () => {
  it("snaps to the center of a circle, an arc and an ellipse, only when enabled", () => {
    const entities = [circle("c", 50, 50, 10)];
    expect(snap(entities, { x: 50.3, y: 49.8 }, 1, only("center"))).toEqual({ point: { x: 50, y: 50 }, type: "center" });
    expect(snap(entities, { x: 50.3, y: 49.8 }, 1, only("endpoint"))).toBeNull();
    expect(snap(entities, { x: 53, y: 50 }, 1, only("center"))).toBeNull(); // 許容距離の外

    const arcs = [arc("a", 5, 5, 10, 30, 60)];
    expect(snap(arcs, { x: 5.2, y: 5.1 }, 1, only("center"))?.point).toEqual({ x: 5, y: 5 });

    const ellipse: CadEntity = { ...base, id: "e", type: "ELLIPSE", center: { x: 20, y: 20 }, majorRadius: 10, minorRadius: 5, rotation: 0, startParam: 0, endParam: Math.PI * 2 };
    expect(snap([ellipse], { x: 20.2, y: 19.9 }, 1, only("center"))?.point).toEqual({ x: 20, y: 20 });
  });

  it("an arc's center is found even when the arc's bounding box is far from it (with a spatial index)", () => {
    // 30〜60度の円弧。中心 (0,0) は、円弧の外接の矩形(中心から約 5〜10 離れる)の外にある
    const entities = [arc("a", 0, 0, 10, 30, 60), line("far", 500, 500, 600, 600)];
    const index = indexOf(entities);
    const result = findSnapPoint(entities, visible, { x: 0.2, y: 0.1 }, 1, index, only("center"));
    expect(result).toEqual({ point: { x: 0, y: 0 }, type: "center" });
    // 索引を使っても使わなくても同じ
    expect(findSnapPoint(entities, visible, { x: 0.2, y: 0.1 }, 1, undefined, only("center"))).toEqual(result);
  });

  it("with candidates at the same distance, the result does not depend on the spatial index (Codex review)", () => {
    // 同じ形の2つの円弧。中心 (1,0) と (-1,0)。カーソル (0,0) から、どちらも距離1。図面の並びで、あとの方が選ばれる
    const entities = [arc("right", 1, 0, 100, 0, 6), arc("left", -1, 0, 100, 0, 6)];
    const index = indexOf(entities);
    const withIndex = findSnapPoint(entities, visible, { x: 0, y: 0 }, 2, index, only("center"));
    const without = findSnapPoint(entities, visible, { x: 0, y: 0 }, 2, undefined, only("center"));
    expect(withIndex).toEqual(without);
    expect(withIndex?.point).toEqual({ x: -1, y: 0 });
    // 並びを逆にすると、選ばれる方も逆になる(どちらの場合も、索引の有無で同じ)
    const reversed = [entities[1], entities[0]];
    const reversedIndex = indexOf(reversed);
    expect(findSnapPoint(reversed, visible, { x: 0, y: 0 }, 2, reversedIndex, only("center"))?.point).toEqual({ x: 1, y: 0 });
    expect(findSnapPoint(reversed, visible, { x: 0, y: 0 }, 2, undefined, only("center"))?.point).toEqual({ x: 1, y: 0 });
    // 円と円弧が同じ距離のときも、同じ
    const mixed = [circle("c", 1, 0, 5), arc("a", -1, 0, 100, 0, 6), circle("d", 0, 1, 5)];
    const mixedIndex = indexOf(mixed);
    expect(findSnapPoint(mixed, visible, { x: 0, y: 0 }, 2, mixedIndex, only("center"))).toEqual(findSnapPoint(mixed, visible, { x: 0, y: 0 }, 2, undefined, only("center")));
  });

  it("a column of arcs with the same x: only the ones near the cursor in y are found (Codex review)", () => {
    // x=0 に、y=1000 から縦に 2000 個の円弧。カーソルの近く (0,0) には無い。1つだけ、(0,1500) にある
    const entities: CadEntity[] = [];
    for (let i = 0; i < 2000; i++) entities.push(arc(`a${i}`, 0, 1000 + i, 5, 0, 90));
    const index = indexOf(entities);
    expect(findSnapPoint(entities, visible, { x: 0.2, y: 0.2 }, 2, index, only("center"))).toBeNull();
    const found = findSnapPoint(entities, visible, { x: 0.3, y: 1500.4 }, 2, index, only("center"));
    expect(found).toEqual({ point: { x: 0, y: 1500 }, type: "center" });
    expect(findSnapPoint(entities, visible, { x: 0.3, y: 1500.4 }, 2, undefined, only("center"))).toEqual(found);
  });

  it("hidden layers are not snapped to", () => {
    expect(findSnapPoint([circle("c", 0, 0, 5)], new Set(), { x: 0.1, y: 0 }, 1, undefined, only("center"))).toBeNull();
  });
});

describe("quadrant", () => {
  it("a circle has four quadrant points on the axes", () => {
    const entities = [circle("c", 10, 20, 5)];
    expect(snap(entities, { x: 15.2, y: 20.1 }, 1, only("quadrant"))).toEqual({ point: { x: 15, y: 20 }, type: "quadrant" });
    expect(snap(entities, { x: 10.1, y: 25.2 }, 1, only("quadrant"))?.point.y).toBeCloseTo(25, 9);
    expect(snap(entities, { x: 4.9, y: 20 }, 1, only("quadrant"))?.point.x).toBeCloseTo(5, 9);
    expect(snap(entities, { x: 10, y: 14.9 }, 1, only("quadrant"))?.point.y).toBeCloseTo(15, 9);
    expect(snap(entities, { x: 12, y: 24 }, 1, only("quadrant"))).toBeNull(); // 45度付近は対象外
  });

  it("an arc has only the quadrant points inside its range", () => {
    // 45〜135度: 90度の点(上)だけ
    const entities = [arc("a", 0, 0, 10, 45, 135)];
    expect(snap(entities, { x: 0, y: 10.1 }, 1, only("quadrant"))?.point.y).toBeCloseTo(10, 9);
    expect(snap(entities, { x: 10.1, y: 0 }, 1, only("quadrant"))).toBeNull();
    expect(snap(entities, { x: -10.1, y: 0 }, 1, only("quadrant"))).toBeNull();
  });

  it("an ellipse has the ends of the major and minor axes (rotation included)", () => {
    const ellipse: CadEntity = { ...base, id: "e", type: "ELLIPSE", center: { x: 0, y: 0 }, majorRadius: 20, minorRadius: 10, rotation: Math.PI / 2, startParam: 0, endParam: Math.PI * 2 };
    // 長軸が上向き: 長軸の端点は (0, 20)、短軸の端点は (-10, 0)
    expect(snap([ellipse], { x: 0.2, y: 20.1 }, 1, only("quadrant"))?.point.y).toBeCloseTo(20, 9);
    expect(snap([ellipse], { x: -10.1, y: 0.1 }, 1, only("quadrant"))?.point.x).toBeCloseTo(-10, 9);
  });
});

describe("perpendicular (needs a from point)", () => {
  it("the foot of the perpendicular on a line, only inside the segment", () => {
    const entities = [line("l", 0, 0, 100, 0)];
    const options = { ...only("perpendicular"), fromPoint: { x: 30, y: 50 } };
    expect(snap(entities, { x: 30.4, y: 0.3 }, 1, options)).toEqual({ point: { x: 30, y: 0 }, type: "perpendicular" });
    // 足が線分の外(基準点 (-20, 5) の足は x=-20)なら出さない
    expect(snap(entities, { x: 0.1, y: 0.1 }, 1, { ...only("perpendicular"), fromPoint: { x: -20, y: 5 } })).toBeNull();
  });

  it("nothing without a from point, or when the foot is not near the cursor", () => {
    const entities = [line("l", 0, 0, 100, 0)];
    expect(snap(entities, { x: 30.4, y: 0.3 }, 1, only("perpendicular"))).toBeNull();
    expect(snap(entities, { x: 60, y: 0 }, 1, { ...only("perpendicular"), fromPoint: { x: 30, y: 50 } })).toBeNull();
  });

  it("a circle: the two points on the line through the center; an arc: only the one inside its range", () => {
    const from = { x: 30, y: 0 };
    const options = { ...only("perpendicular"), fromPoint: from };
    const entities = [circle("c", 0, 0, 10)];
    expect(snap(entities, { x: 10.2, y: 0.2 }, 1, options)?.point.x).toBeCloseTo(10, 9); // 近い側
    expect(snap(entities, { x: -9.9, y: 0.2 }, 1, options)?.point.x).toBeCloseTo(-10, 9); // 遠い側
    const upper = [arc("a", 0, 0, 10, 0, 180)];
    expect(snap(upper, { x: 10.2, y: 0.2 }, 1, options)?.point.x).toBeCloseTo(10, 9); // 0度は範囲(端)
    const lower = [arc("a", 0, 0, 10, 180, 360)];
    expect(snap(lower, { x: -10.2, y: -0.2 }, 1, options)?.point.x).toBeCloseTo(-10, 9);
    const quarter = [arc("a", 0, 0, 10, 80, 100)];
    expect(snap(quarter, { x: 10.2, y: 0.2 }, 1, options)).toBeNull();
  });

  it("the foot is at a right angle (random lines)", () => {
    let hits = 0;
    for (let n = 0; n < 200; n++) {
      const a = { x: Math.sin(n * 12.9898) * 100, y: Math.cos(n * 78.233) * 100 };
      const b = { x: Math.sin(n * 3.1) * 100, y: Math.cos(n * 5.7) * 100 };
      const from = { x: Math.sin(n * 1.7) * 100, y: Math.cos(n * 2.3) * 100 };
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      if (!(dx * dx + dy * dy > 100)) continue; // 長さが(ほぼ)0の線は除く
      const t = ((from.x - a.x) * dx + (from.y - a.y) * dy) / (dx * dx + dy * dy);
      if (!(t > 0.05 && t < 0.95)) continue;
      const foot = { x: a.x + dx * t, y: a.y + dy * t };
      const result = snap([line("l", a.x, a.y, b.x, b.y)], { x: foot.x + 0.1, y: foot.y - 0.1 }, 1, { ...only("perpendicular"), fromPoint: from });
      expect(result, `case ${n}`).not.toBeNull();
      hits++;
      const dot = (result!.point.x - from.x) * dx + (result!.point.y - from.y) * dy;
      expect(Math.abs(dot) / (Math.hypot(dx, dy) * Math.hypot(result!.point.x - from.x, result!.point.y - from.y))).toBeLessThan(1e-9);
    }
    expect(hits).toBeGreaterThan(50);
  });
});

describe("tangent (needs a from point outside the circle)", () => {
  it("the tangent point of a circle seen from a point outside", () => {
    const entities = [circle("c", 0, 0, 5)];
    const options = { ...only("tangent"), fromPoint: { x: 10, y: 0 } };
    const result = snap(entities, { x: 2.6, y: 4.2 }, 1, options);
    expect(result?.type).toBe("tangent");
    expect(result?.point.x).toBeCloseTo(2.5, 9);
    expect(result?.point.y).toBeCloseTo(Math.sqrt(18.75), 9);
    // 接点での半径は、基準点からの線と直角
    const p = result!.point;
    expect((p.x - 0) * (p.x - 10) + (p.y - 0) * (p.y - 0)).toBeCloseTo(0, 9);
  });

  it("nothing from a point inside the circle, without a from point, or for an arc whose range excludes the tangent point", () => {
    const entities = [circle("c", 0, 0, 5)];
    expect(snap(entities, { x: 2.6, y: 4.2 }, 1, { ...only("tangent"), fromPoint: { x: 1, y: 0 } })).toBeNull();
    expect(snap(entities, { x: 2.6, y: 4.2 }, 1, only("tangent"))).toBeNull();
    // 下半分の弧には、上側の接点は無い
    const lower = [arc("a", 0, 0, 5, 180, 360)];
    expect(snap(lower, { x: 2.6, y: 4.2 }, 1, { ...only("tangent"), fromPoint: { x: 10, y: 0 } })).toBeNull();
    expect(snap(lower, { x: 2.6, y: -4.2 }, 1, { ...only("tangent"), fromPoint: { x: 10, y: 0 } })?.type).toBe("tangent");
  });
});

describe("extension", () => {
  const options = (extra: SnapOptions = {}): SnapOptions => ({ ...only("extension"), extensionAcquireWorld: 50, ...extra });

  it("on the line beyond an endpoint, not on the line itself", () => {
    const entities = [line("l", 0, 0, 100, 0)];
    // 終点 (100,0) の先
    expect(snap(entities, { x: 130, y: 0.4 }, 1, options())).toEqual({ point: { x: 130, y: 0 }, type: "extension" });
    // 始点 (0,0) の手前
    expect(snap(entities, { x: -20, y: -0.3 }, 1, options())?.point).toEqual({ x: -20, y: 0 });
    // 線の上(終点より手前)は延長ではない
    expect(snap(entities, { x: 90, y: 0.3 }, 1, options())).toBeNull();
    // 延長線から離れている
    expect(snap(entities, { x: 130, y: 5 }, 1, options())).toBeNull();
  });

  it("only near an endpoint (the acquire distance), and only when the option is given", () => {
    const entities = [line("l", 0, 0, 100, 0)];
    expect(snap(entities, { x: 400, y: 0 }, 1, options())).toBeNull(); // 端点から 300 離れている
    expect(snap(entities, { x: 400, y: 0 }, 1, options({ extensionAcquireWorld: 500 }))?.point).toEqual({ x: 400, y: 0 });
    expect(snap(entities, { x: 130, y: 0.4 }, 1, only("extension"))).toBeNull(); // acquire が無い
  });

  it("a diagonal line and the end segments of an open polyline", () => {
    const diagonal = [line("l", 0, 0, 10, 10)];
    const result = snap(diagonal, { x: 20.3, y: 19.7 }, 1, options());
    expect(result?.point.x).toBeCloseTo(20, 9);
    expect(result?.point.y).toBeCloseTo(20, 9);
    const polyline: CadEntity = { ...base, id: "p", type: "LWPOLYLINE", vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], closed: false };
    expect(snap([polyline], { x: 10.2, y: 25 }, 1, options())?.point.y).toBeCloseTo(25, 9);
    expect(snap([{ ...polyline, closed: true } as CadEntity], { x: 10.2, y: 25 }, 1, options())).toBeNull();
  });

  it("an arc continues as the same circle beyond its range", () => {
    // 0〜90度の弧 (中心 (0,0)、半径 10)。90度の先(135度の方向)は、円周の続き
    const entities = [arc("a", 0, 0, 10, 0, 90)];
    const result = snap(entities, { x: -7, y: 7.3 }, 1, options());
    expect(result?.type).toBe("extension");
    expect(Math.hypot(result!.point.x, result!.point.y)).toBeCloseTo(10, 9);
    // 弧の範囲の中は、延長ではない
    expect(snap(entities, { x: 7.1, y: 7.1 }, 1, options())).toBeNull();
  });

  it("works with a spatial index (the entity's box is far from the cursor)", () => {
    const entities = [line("l", 0, 0, 100, 0), line("other", 1000, 1000, 1100, 1100)];
    const index = indexOf(entities);
    const withIndex = findSnapPoint(entities, visible, { x: 130, y: 0.4 }, 1, index, options());
    expect(withIndex).toEqual({ point: { x: 130, y: 0 }, type: "extension" });
  });
});

describe("grid", () => {
  it("snaps to the nearest grid point (also negative and large coordinates) when nothing else is snapped", () => {
    expect(snap([], { x: 13, y: 27 }, 1, { ...only("grid"), gridSpacing: 10 })).toEqual({ point: { x: 10, y: 30 }, type: "grid" });
    expect(snap([], { x: -14, y: -26 }, 1, { ...only("grid"), gridSpacing: 10 })?.point).toEqual({ x: -10, y: -30 });
    expect(snap([], { x: 123456.7, y: -98765.4 }, 1, { ...only("grid"), gridSpacing: 25 })?.point).toEqual({ x: 123450, y: -98775 });
    expect(snap([], { x: 0.4, y: -0.4 }, 1, { ...only("grid"), gridSpacing: 1 })?.point).toEqual({ x: 0, y: 0 }); // -0 は 0
  });

  it("an object snap wins over the grid; the grid applies when there is none", () => {
    const entities = [line("l", 0, 0, 100, 0)];
    const options = { ...only("endpoint", "grid"), gridSpacing: 10 };
    expect(snap(entities, { x: 0.4, y: 0.3 }, 1, options)?.type).toBe("endpoint");
    expect(snap(entities, { x: 53, y: 47 }, 1, options)).toEqual({ point: { x: 50, y: 50 }, type: "grid" });
  });

  it("not used when disabled, or when the spacing is missing or unusable", () => {
    expect(snap([], { x: 13, y: 27 }, 1, { ...only("endpoint"), gridSpacing: 10 })).toBeNull();
    expect(snap([], { x: 13, y: 27 }, 1, only("grid"))).toBeNull();
    for (const spacing of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(nearestGridPoint({ x: 1, y: 1 }, spacing)).toBeNull();
    }
    expect(nearestGridPoint({ x: Number.MAX_VALUE, y: 1 }, 1e-300)).toBeNull(); // 結果が有限でない
  });

  it("nearest point wins over the grid (near a line)", () => {
    const entities = [line("l", 0, 0, 100, 0)];
    const options = { ...only("nearest", "grid"), nearestToleranceWorld: 5, gridSpacing: 10 };
    expect(snap(entities, { x: 33, y: 2 }, 1, options)).toEqual({ point: { x: 33, y: 0 }, type: "nearest" });
  });
});

describe("intersections with circles and arcs are exact", () => {
  const opts = only("intersection");

  it("line × circle, circle × circle and line × arc (only inside the arc's range)", () => {
    // 円 (0,0) 半径 100 と、x 軸上の線。交点は (±100, 0)。折れ線の近似ではなく、ちょうど円周の上
    const entities = [circle("c", 0, 0, 100), line("l", -200, 0, 200, 0)];
    const hit = snap(entities, { x: 100.3, y: 0.2 }, 1, opts);
    expect(hit?.type).toBe("intersection");
    expect(hit?.point.x).toBeCloseTo(100, 9);
    expect(hit?.point.y).toBeCloseTo(0, 9);

    const circles = [circle("a", 0, 0, 5), circle("b", 6, 0, 5)];
    const both = snap(circles, { x: 3.2, y: 4.1 }, 1, opts);
    expect(both?.point.x).toBeCloseTo(3, 9);
    expect(both?.point.y).toBeCloseTo(4, 9);

    // 上半分の弧 (0〜180度) と、y 軸上の縦線: 上の交点 (0,100) は弧の範囲内、下の交点 (0,-100) は弧の範囲外
    const arcs = [arc("a", 0, 0, 100, 0, 180), line("v", 0, 200, 0, -200)];
    expect(snap(arcs, { x: 0.2, y: 99.7 }, 1, opts)?.point.y).toBeCloseTo(100, 9);
    expect(snap(arcs, { x: 0.2, y: -99.7 }, 1, opts)).toBeNull();
  });

  it("random line × circle: the snapped point is exactly on the circle (the old polyline approximation was not)", () => {
    let hits = 0;
    for (let n = 0; n < 150; n++) {
      const r = 50 + (n % 7) * 30;
      const theta = (n * 2.399963) % (Math.PI * 2);
      const target = { x: r * Math.cos(theta), y: r * Math.sin(theta) };
      // 円の外から内へ貫く線
      const through = [circle("c", 0, 0, r), line("l", target.x * 2, target.y * 2, -target.x * 0.5, -target.y * 0.5)];
      const result = snap(through, { x: target.x + 0.2, y: target.y - 0.2 }, 2, opts);
      if (result === null) continue;
      hits++;
      expect(Math.abs(Math.hypot(result.point.x, result.point.y) - r)).toBeLessThan(1e-9);
    }
    expect(hits).toBeGreaterThan(100);
  });

  it("with and without a spatial index the result is identical", () => {
    const entities = [circle("c", 0, 0, 100), line("l", -200, 0, 200, 0), arc("a", 50, 50, 70, 20, 250), line("m", 0, -300, 0, 300)];
    const index = indexOf(entities);
    for (let n = 0; n < 60; n++) {
      const p = { x: ((n * 37) % 300) - 150, y: ((n * 91) % 300) - 150 };
      const a = findSnapPoint(entities, visible, p, 8, index, only("intersection", "center", "quadrant"));
      const b = findSnapPoint(entities, visible, p, 8, undefined, only("intersection", "center", "quadrant"));
      expect(a).toEqual(b);
    }
  });
});

describe("an approximation vertex is not an intersection (found while testing ORTHO/OTRACK)", () => {
  const ellipse: CadEntity = { ...base, id: "e", type: "ELLIPSE", center: { x: 500, y: 150 }, majorRadius: 80, minorRadius: 40, rotation: 0, startParam: 0, endParam: Math.PI * 2 };
  const opts = only("intersection");

  it("the corner points of the polyline that approximates an ellipse or a spline are not snapped to as intersections", () => {
    // 48 分割の頂点 (563.468..., 174.350...) の近く
    expect(snap([ellipse], { x: 557, y: 170 }, 12.5, opts)).toBeNull();
    const spline: CadEntity = { ...base, id: "s", type: "SPLINE", points: [{ x: 0, y: 0 }, { x: 10, y: 8 }, { x: 20, y: 0 }, { x: 30, y: 8 }], closed: false };
    expect(snap([spline], { x: 10.2, y: 8.1 }, 3, opts)).toBeNull();
  });

  it("a real crossing with another entity on the ellipse is still found", () => {
    // 楕円 (500,150) 長軸 80 短軸 40 と、x 軸に平行な線 y=150 の交点 (580,150)・(420,150)
    const crossing = snap([ellipse, line("l", 300, 150, 700, 150)], { x: 580.4, y: 150.3 }, 3, opts);
    expect(crossing?.type).toBe("intersection");
    expect(crossing?.point.x).toBeCloseTo(580, 3);
    expect(crossing?.point.y).toBeCloseTo(150, 9);
  });

  it("a polyline that crosses itself still has its intersection; its ordinary corners are endpoints, not intersections", () => {
    const figureEight: CadEntity = { ...base, id: "p", type: "LWPOLYLINE", vertices: [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 10, y: 0 }, { x: 0, y: 10 }], closed: false };
    const cross = snap([figureEight], { x: 5.2, y: 5.1 }, 2, opts);
    expect(cross?.type).toBe("intersection");
    expect(cross?.point.x).toBeCloseTo(5, 9);
    expect(cross?.point.y).toBeCloseTo(5, 9);
    // 角 (10,10) は、端点としては吸着できる
    expect(snap([figureEight], { x: 10.1, y: 10.1 }, 1, opts)).toBeNull();
    expect(snap([figureEight], { x: 10.1, y: 10.1 }, 1, only("endpoint"))?.point).toEqual({ x: 10, y: 10 });
  });
});

describe("priority and options", () => {
  it("the candidate nearest to the cursor wins across types; at the same distance the older types win", () => {
    // 円の右の四半円点 (10,0) と、同じ点にある線の端点: 距離が同じなら、端点(従来の種類)が選ばれる
    const entities = [circle("c", 0, 0, 10), line("l", 10, 0, 20, 0)];
    const withoutIntersection = new Set<SnapType>(["endpoint", "midpoint", "center", "quadrant"]);
    expect(snap(entities, { x: 10, y: 0 }, 1, { enabledTypes: withoutIntersection })?.type).toBe("endpoint");
    // 交点も有効なら、その点には交点もある。従来どおり、距離が同じときは交点が選ばれる(端点・中点・交点の順は変えていない)
    const all = new Set<SnapType>(["endpoint", "midpoint", "intersection", "center", "quadrant"]);
    expect(snap(entities, { x: 10, y: 0 }, 1, { enabledTypes: all })?.type).toBe("intersection");
    // 四半円点だけに近いとき
    expect(snap(entities, { x: 0.1, y: 10 }, 1, { enabledTypes: all })?.type).toBe("quadrant");
  });

  it("the default (no enabledTypes) keeps the old behavior: endpoint, midpoint, intersection and (with the option) nearest only", () => {
    const entities = [circle("c", 0, 0, 10)];
    // 円には端点も中点も無く、中心・四半円点は、指定しないと出ない
    expect(findSnapPoint(entities, visible, { x: 10, y: 0.1 }, 1)).toBeNull();
    expect(findSnapPoint(entities, visible, { x: 0.1, y: 0.1 }, 1)).toBeNull();
  });

  it("turning a type off removes only that type", () => {
    const entities = [line("l", 0, 0, 10, 0)];
    expect(snap(entities, { x: 0.2, y: 0.1 }, 1, only("endpoint", "midpoint"))?.type).toBe("endpoint");
    expect(snap(entities, { x: 0.2, y: 0.1 }, 1, only("midpoint"))).toBeNull();
    expect(snap(entities, { x: 0.2, y: 0.1 }, 1, { enabledTypes: new Set() })).toBeNull();
  });

  it("indexed and full-scan results agree for random drawings and all types", () => {
    const entities: CadEntity[] = [];
    for (let i = 0; i < 300; i++) {
      const x = ((i * 53) % 1000) - 500;
      const y = ((i * 97) % 1000) - 500;
      if (i % 3 === 0) entities.push(circle(`c${i}`, x, y, 5 + (i % 40)));
      else if (i % 3 === 1) entities.push(line(`l${i}`, x, y, x + ((i * 7) % 120) - 60, y + ((i * 11) % 120) - 60));
      else entities.push(arc(`a${i}`, x, y, 10 + (i % 50), (i * 13) % 360, ((i * 13) % 360) + 30 + (i % 200)));
    }
    const index = indexOf(entities);
    const all = new Set<SnapType>(["endpoint", "midpoint", "intersection", "center", "quadrant", "perpendicular", "tangent", "nearest", "extension", "grid"]);
    for (let n = 0; n < 200; n++) {
      const p = { x: ((n * 131) % 1000) - 500, y: ((n * 71) % 1000) - 500 };
      const options: SnapOptions = { enabledTypes: all, nearestToleranceWorld: 8, fromPoint: { x: 7, y: -3 }, gridSpacing: 10, extensionAcquireWorld: 60 };
      expect(findSnapPoint(entities, visible, p, 6, index, options), `case ${n}`).toEqual(findSnapPoint(entities, visible, p, 6, undefined, options));
    }
  });
});
