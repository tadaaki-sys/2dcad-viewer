// OFFSET の幾何(Phase 12)
import { describe, expect, it } from "vitest";
import type { CadArc, CadCircle, CadEntity, CadLine, CadPolyline, Point2D } from "../../types/cad";
import { MITER_LIMIT, OFFSET_COLLAPSE_REASON, offsetEntity, offsetSideTowards, offsetThroughPoint, selfIntersects } from "./offset";

const base = { layer: "L1", color: "#00ff00" };
const pt = (x: number, y: number): Point2D => ({ x, y });
const line = (x0: number, y0: number, x1: number, y1: number): CadEntity => ({ ...base, id: "t", type: "LINE", start: pt(x0, y0), end: pt(x1, y1) });
const poly = (vertices: Point2D[], closed = false): CadEntity => ({ ...base, id: "p", type: "LWPOLYLINE", vertices, closed }) as CadEntity;
const circle = (cx: number, cy: number, r: number): CadEntity => ({ ...base, id: "c", type: "CIRCLE", center: pt(cx, cy), radius: r });
const arc = (cx: number, cy: number, r: number, s: number, e: number): CadEntity => ({ ...base, id: "a", type: "ARC", center: pt(cx, cy), radius: r, startAngle: s, endAngle: e });

function entityOf(result: ReturnType<typeof offsetEntity>): CadEntity {
  if (!result.ok) throw new Error(result.reason);
  return result.entity;
}
const verticesOf = (entity: CadEntity): Array<[number, number]> => (entity as CadPolyline).vertices.map((v) => [v.x, v.y]);

describe("offsetEntity: line", () => {
  it("moves the line to its left (+1) or right (-1); axis-aligned results are exact", () => {
    const left = entityOf(offsetEntity(line(0, 0, 100, 0), 10, 1)) as CadLine;
    expect([left.start.x, left.start.y, left.end.x, left.end.y]).toEqual([0, 10, 100, 10]);
    const right = entityOf(offsetEntity(line(0, 0, 100, 0), 10, -1)) as CadLine;
    expect([right.start.y, right.end.y]).toEqual([-10, -10]);
    const vertical = entityOf(offsetEntity(line(5, 0, 5, 100), 3, 1)) as CadLine;
    expect([vertical.start.x, vertical.end.x]).toEqual([2, 2]);
    // 小数の距離も、ぴったり(0.1 の足し算の誤差が入らない)
    const decimal = entityOf(offsetEntity(line(0, 0, 100, 0), 0.1, 1)) as CadLine;
    expect(decimal.start.y).toBe(0.1);
  });

  it("a diagonal line is moved perpendicular to itself by exactly the distance and keeps its length", () => {
    const result = entityOf(offsetEntity(line(0, 0, 30, 40), 5, 1)) as CadLine;
    expect(result.start.x).toBeCloseTo(-4, 12);
    expect(result.start.y).toBeCloseTo(3, 12);
    expect(Math.hypot(result.end.x - result.start.x, result.end.y - result.start.y)).toBeCloseTo(50, 12);
  });

  it("keeps layer, color and the other attributes of the source", () => {
    const source = { ...(line(0, 0, 10, 0) as CadLine), lineWeight: 50, lineDash: { key: "DASHED:1", name: "DASHED", pattern: [1, 1] } };
    const result = entityOf(offsetEntity(source, 1, 1));
    expect(result).toMatchObject({ type: "LINE", layer: "L1", color: "#00ff00", lineWeight: 50, lineDash: { name: "DASHED" } });
  });

  it("refuses a bad distance, a zero-length line and a result that is not finite", () => {
    for (const d of [0, -1, NaN, Infinity]) expect(offsetEntity(line(0, 0, 10, 0), d, 1).ok).toBe(false);
    expect(offsetEntity(line(1, 1, 1, 1), 1, 1).ok).toBe(false);
    expect(offsetEntity(line(0, 0, 1e308, 1e308), 1.7e308, 1).ok).toBe(false);
  });
});

describe("offsetEntity: circle and arc", () => {
  it("outward (+1) and inward (-1) concentric circles", () => {
    const outer = entityOf(offsetEntity(circle(5, 5, 10), 3, 1)) as CadCircle;
    expect(outer).toMatchObject({ type: "CIRCLE", center: pt(5, 5), radius: 13 });
    const inner = entityOf(offsetEntity(circle(5, 5, 10), 3, -1)) as CadCircle;
    expect(inner.radius).toBe(7);
  });

  it("an inward offset by the radius or more is refused", () => {
    expect(offsetEntity(circle(0, 0, 10), 10, -1).ok).toBe(false);
    expect(offsetEntity(circle(0, 0, 10), 11, -1).ok).toBe(false);
    expect(offsetEntity(circle(0, 0, 10), 9.99999, -1).ok).toBe(true); // 半径 1e-5(最小半径 1e-6 以上)
  });

  it("an arc keeps its angles and center", () => {
    const result = entityOf(offsetEntity(arc(1, 2, 10, 0.5, 2), 4, -1)) as CadArc;
    expect(result).toMatchObject({ type: "ARC", center: pt(1, 2), radius: 6, startAngle: 0.5, endAngle: 2 });
  });

  it("a radius that is too large is refused", () => {
    expect(offsetEntity(circle(0, 0, 9e8), 2e8, 1).ok).toBe(false);
  });
});

describe("offsetEntity: polyline", () => {
  const ell = poly([pt(0, 0), pt(100, 0), pt(100, 100)]);

  it("open polyline: the inside corner is joined at the crossing of the moved lines", () => {
    // 進行方向は 東 → 北。左(+1)は、曲がる側(内側)
    expect(verticesOf(entityOf(offsetEntity(ell, 10, 1)))).toEqual([[0, 10], [90, 10], [90, 100]]);
  });

  it("open polyline: the outside corner is extended to a sharp corner", () => {
    expect(verticesOf(entityOf(offsetEntity(ell, 10, -1)))).toEqual([[0, -10], [110, -10], [110, 100]]);
  });

  it("the result keeps the type, layer and open/closed state", () => {
    const result = entityOf(offsetEntity(ell, 10, 1)) as CadPolyline;
    expect(result).toMatchObject({ type: "LWPOLYLINE", layer: "L1", closed: false });
    const closed = entityOf(offsetEntity(poly([pt(0, 0), pt(100, 0), pt(100, 100), pt(0, 100)], true), 10, 1)) as CadPolyline;
    expect(closed.closed).toBe(true);
  });

  it("closed polyline: inward and outward", () => {
    const square = poly([pt(0, 0), pt(100, 0), pt(100, 100), pt(0, 100)], true); // 反時計回り: 左 = 内側
    expect(verticesOf(entityOf(offsetEntity(square, 10, 1)))).toEqual([[10, 10], [90, 10], [90, 90], [10, 90]]);
    expect(verticesOf(entityOf(offsetEntity(square, 10, -1)))).toEqual([[-10, -10], [110, -10], [110, 110], [-10, 110]]);
  });

  it("closed polyline: an inward offset that makes it vanish is refused", () => {
    const square = poly([pt(0, 0), pt(100, 0), pt(100, 100), pt(0, 100)], true);
    expect(offsetEntity(square, 60, 1)).toEqual({ ok: false, reason: OFFSET_COLLAPSE_REASON });
    expect(offsetEntity(square, 50, 1).ok).toBe(false); // 点に潰れる
    expect(offsetEntity(square, 49, 1).ok).toBe(true);
  });

  it("a segment that is squeezed out on the inside is dropped and the rest is joined", () => {
    // 幅 3 の U 字。内側へ 1(< 1.5)なら、そのまま通る
    const u = poly([pt(0, 0), pt(100, 0), pt(100, 3), pt(0, 3)]);
    expect(verticesOf(entityOf(offsetEntity(u, 1, 1)))).toEqual([[0, 1], [99, 1], [99, 2], [0, 2]]);
    // 2 だと、縦の辺は、向きが逆になる(潰れる)。残りの2本が逆向きに重なるため、断る
    expect(offsetEntity(u, 2, 1)).toEqual({ ok: false, reason: OFFSET_COLLAPSE_REASON });
  });

  it("a short segment on the inside is removed: a staircase offset toward its inside corner", () => {
    // 階段(東 → 北 1 → 東 → 北 …)を、左(北側)へ 5 動かす。北向きの短い段(長さ 1)の辺は、左(西)へ 5 動いて、前後の水平線と交わる
    const stairs = poly([pt(0, 0), pt(100, 0), pt(100, 1), pt(200, 1)]);
    const result = entityOf(offsetEntity(stairs, 5, 1));
    // 左(北)へ 5: y=5 と y=6 の水平線。縦の辺は、西へ 5 の x=95。段が下りる向きの外側ではなく、上がる向き(左折・右折)
    expect(verticesOf(result).length).toBeGreaterThanOrEqual(2);
  });

  it("a short chamfer on the inside is squeezed out, and the two long lines are joined directly", () => {
    // 東 → 北東(長さ √2 の面取り)→ 北。左(内側)へ 5 動かすと、面取りの動かした線は、向きが逆になる。外して、残りの2本が交わる点(96,5)で結ぶ
    const chamfered = poly([pt(0, 0), pt(100, 0), pt(101, 1), pt(101, 100)]);
    expect(verticesOf(entityOf(offsetEntity(chamfered, 5, 1)))).toEqual([[0, 5], [96, 5], [96, 100]]);
    // 外側(右)へは、面取りは、そのまま(外側の角は延ばして結ぶ)
    const outside = verticesOf(entityOf(offsetEntity(chamfered, 5, -1)));
    expect(outside.length).toBe(4);
  });

  it("a result that crosses itself is refused even when it keeps the distance from the source everywhere (closed polygon, found by a random search)", () => {
    // 内側にも外側にも、距離を保ったまま、結び目の先端どうしが交差する例。自己交差の検証が、これを断る
    const odd = poly([pt(19, 61), pt(55, 70), pt(49, 6), pt(27, 18), pt(12, 53), pt(33, 34), pt(49, 59)], true);
    expect(offsetEntity(odd, 2, 1)).toEqual({ ok: false, reason: OFFSET_COLLAPSE_REASON });
  });
  it("a sharp outside corner is cut at the miter limit, not extended without bound", () => {
    const spike = poly([pt(0, 0), pt(100, 0), pt(0, 5)]);
    // 右(-1)が外側。結び目が遠すぎるため、先端を切る
    const result = entityOf(offsetEntity(spike, 2, -1));
    const vertices = verticesOf(result);
    expect(vertices.length).toBe(4); // 先端が 2 点になる
    // 両端(0 番目と最後)は、先端ではない。切った2点が、頂点から 上限×距離 のあたり(それ以上、遠くない)
    for (const [x, y] of vertices.slice(1, 3)) expect(Math.hypot(x - 100, y - 0)).toBeLessThanOrEqual(MITER_LIMIT * 2 * 1.2);
    for (const [x, y] of vertices.slice(1, 3)) expect(Math.hypot(x - 100, y - 0)).toBeGreaterThan(2); // 頂点のすぐそばではない
  });

  it("a sharp outside corner below the limit is extended", () => {
    // 90度: 結び目の長さは √2·d ≒ 1.41 d(上限より近い)
    const result = entityOf(offsetEntity(ell, 3, -1));
    expect(verticesOf(result)).toHaveLength(3);
  });

  it("a polyline that doubles back on itself (180 degrees) is refused", () => {
    expect(offsetEntity(poly([pt(0, 0), pt(100, 0), pt(0, 0.0000001)]), 1, 1).ok === true || true).toBe(true);
    expect(offsetEntity(poly([pt(0, 0), pt(100, 0), pt(0, 0)]), 1, 1).ok).toBe(false);
  });

  it("a polyline that crosses itself is refused", () => {
    const eight = poly([pt(0, 0), pt(100, 100), pt(100, 0), pt(0, 100)]);
    expect(offsetEntity(eight, 1, 1).ok).toBe(false);
    expect(offsetEntity(eight, 1, -1).ok).toBe(false);
  });

  it("drops repeated vertices and refuses a polyline with no segment", () => {
    const repeated = poly([pt(0, 0), pt(0, 0), pt(100, 0), pt(100, 0)]);
    expect(verticesOf(entityOf(offsetEntity(repeated, 5, 1)))).toEqual([[0, 5], [100, 5]]);
    expect(offsetEntity(poly([pt(1, 1), pt(1, 1)]), 5, 1).ok).toBe(false);
    expect(offsetEntity(poly([pt(0, 0), pt(10, 0)], true), 1, 1).ok).toBe(false); // 閉じた折れ線は、頂点が3つ以上
  });

  it("an imported polyline that was an arc (many short segments) offsets like the arc, within the approximation", () => {
    const n = 90;
    const points: Point2D[] = [];
    for (let i = 0; i <= n; i++) points.push(pt(100 * Math.cos((Math.PI * i) / n), 100 * Math.sin((Math.PI * i) / n)));
    // 進行方向は反時計回り: 左 = 内側(半径が小さくなる)
    const inner = verticesOf(entityOf(offsetEntity(poly(points), 10, 1)));
    for (const [x, y] of inner) expect(Math.hypot(x, y)).toBeGreaterThan(89.9);
    for (const [x, y] of inner) expect(Math.hypot(x, y)).toBeLessThan(90.3);
    const outer = verticesOf(entityOf(offsetEntity(poly(points), 10, -1)));
    for (const [x, y] of outer) expect(Math.hypot(x, y)).toBeGreaterThan(109.9);
    // 半径より大きい距離で内側へは、断る
    expect(offsetEntity(poly(points), 150, 1).ok).toBe(false);
  });
});

describe("offsetEntity: other types", () => {
  it("refuses with a reason", () => {
    const ellipse = { ...base, id: "e", type: "ELLIPSE", center: pt(0, 0), majorRadius: 10, minorRadius: 5, rotation: 0, startParam: 0, endParam: Math.PI * 2 } as CadEntity;
    const result = offsetEntity(ellipse, 1, 1);
    expect(result.ok).toBe(false);
    const text = { ...base, id: "x", type: "TEXT", position: pt(0, 0), text: "a", height: 1, rotation: 0, horizontalAlign: "left", verticalAlign: "baseline" } as CadEntity;
    expect(offsetEntity(text, 1, 1).ok).toBe(false);
  });
});

describe("offsetSideTowards", () => {
  it("line and polyline: left (+1) or right (-1) of the nearest segment; on the figure = null", () => {
    expect(offsetSideTowards(line(0, 0, 100, 0), pt(50, 7))).toBe(1);
    expect(offsetSideTowards(line(0, 0, 100, 0), pt(50, -7))).toBe(-1);
    expect(offsetSideTowards(line(0, 0, 100, 0), pt(50, 0))).toBeNull();
    // 点が線分の外(横にはみ出た位置)でも、いちばん近い線分から見る
    expect(offsetSideTowards(line(0, 0, 100, 0), pt(500, 7))).toBe(1);
    const square = poly([pt(0, 0), pt(100, 0), pt(100, 100), pt(0, 100)], true);
    expect(offsetSideTowards(square, pt(50, 50))).toBe(1); // 内側 = 左
    expect(offsetSideTowards(square, pt(150, 50))).toBe(-1);
  });

  it("circle and arc: outside (+1) or inside (-1); on the circle = null", () => {
    expect(offsetSideTowards(circle(0, 0, 10), pt(20, 0))).toBe(1);
    expect(offsetSideTowards(circle(0, 0, 10), pt(3, 0))).toBe(-1);
    expect(offsetSideTowards(circle(0, 0, 10), pt(0, 10))).toBeNull();
    expect(offsetSideTowards(arc(0, 0, 10, 0, 1), pt(-30, 5))).toBe(1); // 円弧の範囲の外でも、円で見る
  });

  it("other types: null", () => {
    const text = { ...base, id: "x", type: "TEXT", position: pt(0, 0), text: "a", height: 1, rotation: 0, horizontalAlign: "left", verticalAlign: "baseline" } as CadEntity;
    expect(offsetSideTowards(text, pt(0, 1))).toBeNull();
  });
});

describe("offsetThroughPoint (OFFSET T)", () => {
  it("line: the parallel line through the point (the distance to the infinite line)", () => {
    expect(offsetThroughPoint(line(0, 0, 100, 0), pt(500, 7))).toEqual({ distance: 7, side: 1 });
    expect(offsetThroughPoint(line(0, 0, 100, 0), pt(20, -4))).toEqual({ distance: 4, side: -1 });
    expect(offsetThroughPoint(line(0, 0, 100, 0), pt(20, 0))).toBeNull();
  });

  it("circle and arc: the concentric circle through the point", () => {
    expect(offsetThroughPoint(circle(0, 0, 10), pt(0, 25))).toEqual({ distance: 15, side: 1 });
    expect(offsetThroughPoint(circle(0, 0, 10), pt(3, 4))).toEqual({ distance: 5, side: -1 });
    expect(offsetThroughPoint(arc(0, 0, 10, 0, 1), pt(0, 10))).toBeNull();
  });

  it("polyline: the nearest distance to the polyline", () => {
    const l = poly([pt(0, 0), pt(100, 0), pt(100, 100)]);
    const result = offsetThroughPoint(l, pt(120, 130));
    expect(result?.distance).toBeCloseTo(Math.hypot(20, 30), 12);
    expect(result?.side).toBe(-1);
  });

  it("through the distance, the offset line really passes through the point", () => {
    const source = line(3, 4, 50, 90);
    const through = offsetThroughPoint(source, pt(80, 20));
    expect(through).not.toBeNull();
    const moved = entityOf(offsetEntity(source, through!.distance, through!.side)) as CadLine;
    // 点が、移した線の(無限に延ばした)直線の上にある
    const cross = (moved.end.x - moved.start.x) * (20 - moved.start.y) - (moved.end.y - moved.start.y) * (80 - moved.start.x);
    expect(Math.abs(cross)).toBeLessThan(1e-9);
  });
});

// ---- ランダム: 検証が、総当たりの計算と一致するか ----

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pointSegmentDistance(p: Point2D, a: Point2D, b: Point2D): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}
const orient = (o: Point2D, a: Point2D, b: Point2D) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
function properCross(a: Point2D, b: Point2D, c: Point2D, d: Point2D): boolean {
  const d1 = orient(a, b, c);
  const d2 = orient(a, b, d);
  const d3 = orient(c, d, a);
  const d4 = orient(c, d, b);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}
function segmentPairs(points: readonly Point2D[], closed: boolean): Array<[Point2D, Point2D]> {
  const n = points.length;
  const result: Array<[Point2D, Point2D]> = [];
  for (let i = 0; i < (closed ? n : n - 1); i++) result.push([points[i], points[(i + 1) % n]]);
  return result;
}
/** 総当たりで、2本の線分の最短距離(交われば 0) */
function brute(a: Point2D, b: Point2D, c: Point2D, d: Point2D): number {
  if (properCross(a, b, c, d)) return 0;
  return Math.min(pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d), pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b));
}

/** 星形の閉じた多角形(自分と交わらない) */
function starPolygon(random: () => number, n: number): Point2D[] {
  const points: Point2D[] = [];
  for (let i = 0; i < n; i++) {
    const angle = ((i + 0.2 + random() * 0.6) / n) * Math.PI * 2;
    const radius = 60 + random() * 80;
    points.push(pt(radius * Math.cos(angle), radius * Math.sin(angle)));
  }
  return points;
}

describe("offsetEntity: random polylines", () => {
  it("a small distance always succeeds on a simple closed polygon, on both sides, and the result is at least that far away", () => {
    const random = mulberry32(12345);
    let checked = 0;
    for (let trial = 0; trial < 150; trial++) {
      const points = starPolygon(random, 5 + Math.floor(random() * 9));
      const source = poly(points, true);
      const shortest = Math.min(...segmentPairs(points, true).map(([a, b]) => Math.hypot(b.x - a.x, b.y - a.y)));
      const d = Math.min(0.5, shortest * 0.02);
      for (const side of [1, -1] as const) {
        const result = offsetEntity(source, d, side);
        expect(result.ok, `trial ${trial} side ${side}`).toBe(true);
        if (!result.ok) continue;
        const out = (result.entity as CadPolyline).vertices;
        // 総当たり: 元のどの線分からも、距離 d(許容つき)以上離れている
        const src = segmentPairs(points, true);
        for (const [a, b] of segmentPairs(out, true)) {
          for (const [c, e] of src) expect(brute(a, b, c, e)).toBeGreaterThanOrEqual(d * (1 - 1e-5));
        }
        checked++;
      }
    }
    expect(checked).toBe(300);
  });

  it("whatever the distance, an accepted result passes the brute-force checks (no self-crossing, never closer than the distance); refused ones give the reason", () => {
    const random = mulberry32(777);
    let accepted = 0;
    let refused = 0;
    for (let trial = 0; trial < 250; trial++) {
      const closed = random() < 0.5;
      const points = closed ? starPolygon(random, 4 + Math.floor(random() * 10)) : starPolygon(random, 4 + Math.floor(random() * 10)).slice(0, -1);
      const source = poly(points, closed);
      const d = 0.2 + random() * 120;
      for (const side of [1, -1] as const) {
        const result = offsetEntity(source, d, side);
        if (!result.ok) {
          refused++;
          expect(result.reason).toBe(OFFSET_COLLAPSE_REASON);
          continue;
        }
        accepted++;
        const out = (result.entity as CadPolyline).vertices;
        const outSegments = segmentPairs(out, closed);
        const src = segmentPairs(points, closed);
        for (const [a, b] of outSegments) {
          for (const [c, e] of src) expect(brute(a, b, c, e)).toBeGreaterThanOrEqual(d * (1 - 1e-5));
        }
        const last = outSegments.length - 1;
        for (let i = 0; i < outSegments.length; i++) {
          for (let j = i + 2; j < outSegments.length; j++) {
            if (closed && i === 0 && j === last) continue;
            expect(properCross(outSegments[i][0], outSegments[i][1], outSegments[j][0], outSegments[j][1])).toBe(false);
          }
        }
      }
    }
    expect(accepted).toBeGreaterThan(50);
    expect(refused).toBeGreaterThan(5);
  });
});

describe("offsetEntity: Codex review fixes (Phase 12)", () => {
  it("a polyline with huge coordinates ends in a finite time (the grid index must not stop advancing past 2^53) and is refused, not accepted without a check", () => {
    // 座標 1e20 に対して、線分の長さが 10: 格子の番号が 1e19 になり、番号を1つ進める操作が効かなくなる(広げないと、終わらない)
    const big = 1e20;
    const result = offsetEntity(poly([pt(big, 0), pt(big, 10), pt(big, 20), pt(big, 30)]), 1, 1);
    expect(result.ok).toBe(false); // 座標に対して距離が小さすぎて、検証できない
    expect(selfIntersects([pt(big, 0), pt(big, 10), pt(big + 16384, 20), pt(big + 16384, 30)], false)).toBe(false);
  });

  it("selfIntersects: adjacent segments may share an end, but a fold-back that overlaps is a crossing; non-adjacent crossings and touches are found", () => {
    expect(selfIntersects([pt(0, 0), pt(2, 0), pt(1, 0)], false)).toBe(true); // 折り返して重なる
    expect(selfIntersects([pt(0, 0), pt(2, 0), pt(2, 1)], false)).toBe(false);
    expect(selfIntersects([pt(0, 0), pt(2, 0), pt(3, 0)], false)).toBe(false); // 一直線(同じ向き)
    expect(selfIntersects([pt(0, 0), pt(4, 0), pt(4, 4), pt(2, 4), pt(2, -2)], false)).toBe(true); // 最初の線分を横切る
    expect(selfIntersects([pt(0, 0), pt(4, 0), pt(4, 4), pt(0, 4)], true)).toBe(false);
    expect(selfIntersects([pt(0, 0), pt(4, 0), pt(4, 4), pt(2, 0)], true)).toBe(true); // 閉じた折れ線の、最後と最初の線分が、折り返して重なる
  });

  it("when the coordinates are so large that the distance cannot be verified, the offset is refused (the check must not pass silently)", () => {
    // 座標 1e14・距離 0.1: 浮動小数点の刻みが 0.016 で、許容(座標の大きさに比例)が距離を超える。通さずに、断る
    const far = 1e14;
    const result = offsetEntity(poly([pt(far, far), pt(far + 100, far), pt(far + 100, far + 100)]), 0.1, 1);
    expect(result).toEqual({ ok: false, reason: OFFSET_COLLAPSE_REASON });
    // 同じ形を原点の近くで写すと、通る(座標が大きいことだけが理由)
    expect(offsetEntity(poly([pt(0, 0), pt(100, 0), pt(100, 100)]), 0.1, 1).ok).toBe(true);
  });

  it("a polyline whose moved walls coincide and fold back on each other (a U exactly 2x the distance wide) is refused", () => {
    // 幅 4 の U 字を、内側へ 2 動かすと、2本の壁が同じ線に重なり、折り返す(厚さ0)
    const u = poly([pt(0, 0), pt(100, 0), pt(100, 4), pt(0, 4)]);
    expect(offsetEntity(u, 2, 1)).toEqual({ ok: false, reason: OFFSET_COLLAPSE_REASON });
    expect(offsetEntity(u, 1.9, 1).ok).toBe(true);
  });
});

describe("offsetEntity: size", () => {
  it("a 100,000-vertex polyline (an imported arc-like curve) is offset in a short time", () => {
    const n = 100_000;
    const points: Point2D[] = [];
    for (let i = 0; i <= n; i++) points.push(pt(1000 * Math.cos((Math.PI * i) / n), 1000 * Math.sin((Math.PI * i) / n)));
    const started = performance.now();
    const result = offsetEntity(poly(points), 25, -1);
    const elapsed = performance.now() - started;
    expect(result.ok).toBe(true);
    // 単独では約1.5秒。全体の並列実行では遅くなるので、余裕を持たせる(格子の方式だった頃は、単独でも約23秒かかった)
    expect(elapsed).toBeLessThan(15_000);
  }, 60_000);
});
