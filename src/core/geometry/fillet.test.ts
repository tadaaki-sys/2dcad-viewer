// FILLET・CHAMFER の幾何(Phase 13)
import { describe, expect, it } from "vitest";
import type { CadArc, CadCircle, CadEntity, CadLine, CadPolyline, Point2D } from "../../types/cad";
import {
  ARC_CHORD_ERROR,
  CORNER_AMBIGUOUS_SIDE_REASON,
  CORNER_MIXED_REASON,
  CORNER_NOT_ADJACENT_REASON,
  CORNER_NOTHING_CHANGES_REASON,
  CORNER_PARALLEL_REASON,
  CORNER_PRECISION_REASON,
  CORNER_SAME_LINE_REASON,
  CORNER_SAME_SEGMENT_REASON,
  cornerEntities,
  FILLET_TYPES,
  validateCornerMode,
} from "./fillet";
import type { CornerMode, CornerResult } from "./fillet";
import { normalizeArcSpan } from "./geometry";

const line = (id: string, x1: number, y1: number, x2: number, y2: number, extra: Partial<CadLine> = {}): CadLine => ({
  id,
  type: "LINE",
  layer: "0",
  color: "#ffffff",
  start: { x: x1, y: y1 },
  end: { x: x2, y: y2 },
  ...extra,
});

const polyline = (id: string, points: Array<[number, number]>, closed: boolean, extra: Partial<CadPolyline> = {}): CadPolyline => ({
  id,
  type: "LWPOLYLINE",
  layer: "0",
  color: "#ffffff",
  vertices: points.map(([x, y]) => ({ x, y })),
  closed,
  ...extra,
});

const fillet = (radius: number): CornerMode => ({ kind: "fillet", radius });
const chamfer = (distance1: number, distance2: number): CornerMode => ({ kind: "chamfer", distance1, distance2 });

function ok(result: CornerResult): { replaced: CadEntity[]; added: CadEntity[] } {
  if (!result.ok) throw new Error(`失敗: ${result.reason}`);
  return result;
}

const close = (a: number, b: number, tolerance = 1e-9): boolean => Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(a), Math.abs(b));
const samePoint = (a: Point2D, b: Point2D, tolerance = 1e-9): boolean => close(a.x, b.x, tolerance) && close(a.y, b.y, tolerance);
const onArc = (arc: CadArc, angle: number): Point2D => ({ x: arc.center.x + arc.radius * Math.cos(angle), y: arc.center.y + arc.radius * Math.sin(angle) });

/** 点から、線(無限に延ばした直線)までの距離 */
function distanceToInfiniteLine(p: Point2D, a: Point2D, b: Point2D): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / Math.hypot(dx, dy);
}

/** 2本の線(延ばした直線)の交点 */
function intersection(a: CadLine, b: CadLine): Point2D {
  const d1x = a.end.x - a.start.x;
  const d1y = a.end.y - a.start.y;
  const d2x = b.end.x - b.start.x;
  const d2y = b.end.y - b.start.y;
  const s = ((b.start.x - a.start.x) * d2y - (b.start.y - a.start.y) * d2x) / (d1x * d2y - d1y * d2x);
  return { x: a.start.x + d1x * s, y: a.start.y + d1y * s };
}

/** 結果の円弧が、2本の新しい線に接していることの確認(丸め誤差の範囲で) */
function expectTangentArc(a: CadLine, b: CadLine, a2: CadLine, b2: CadLine, arc: CadArc, radius: number): void {
  expect(arc.type).toBe("ARC");
  expect(close(arc.radius, radius)).toBe(true);
  const scale = Math.max(1, radius);
  // 中心から、元の2本の直線までの距離が、半径
  expect(Math.abs(distanceToInfiniteLine(arc.center, a.start, a.end) - radius)).toBeLessThan(1e-9 * scale * 10);
  expect(Math.abs(distanceToInfiniteLine(arc.center, b.start, b.end) - radius)).toBeLessThan(1e-9 * scale * 10);
  // 円弧の両端が、新しい2本の線の端と、同じ位置(1本に1つずつ)
  const start = onArc(arc, arc.startAngle);
  const end = onArc(arc, arc.endAngle);
  const endsOf = (l: CadLine): Point2D[] => [l.start, l.end];
  const touches = (p: Point2D, l: CadLine): boolean => endsOf(l).some((e) => samePoint(e, p, 1e-8));
  expect((touches(start, a2) && touches(end, b2)) || (touches(start, b2) && touches(end, a2))).toBe(true);
  // 短い方の円弧(180°未満)
  expect(normalizeArcSpan(arc.startAngle, arc.endAngle)).toBeLessThan(Math.PI);
}

describe("line and line: FILLET", () => {
  const horizontal = line("h", -100, 0, 100, 0);
  const vertical = line("v", 0, -100, 0, 100);

  it.each([
    [1, 1],
    [-1, 1],
    [-1, -1],
    [1, -1],
  ])("keeps the arms that were clicked (quadrant sx=%i, sy=%i), and rounds the corner there", (sx, sy) => {
    const r = ok(cornerEntities(horizontal, { x: sx * 50, y: 0 }, vertical, { x: 0, y: sy * 50 }, fillet(10)));
    const [h2, v2] = r.replaced as CadLine[];
    const arc = r.added[0] as CadArc;
    expect(r.added).toHaveLength(1);
    expect(arc.center).toEqual({ x: sx * 10, y: sy * 10 });
    expect(arc.radius).toBe(10);
    // 横の線: 交点側の端を、接点(±10, 0)へ。遠い端は、そのまま
    expect(h2.id).toBe("h");
    const keptEnd = sx > 0 ? h2.end : h2.start;
    const movedEnd = sx > 0 ? h2.start : h2.end;
    expect(keptEnd).toEqual({ x: sx * 100, y: 0 });
    expect(movedEnd).toEqual({ x: sx * 10, y: 0 });
    // 縦の線
    const keptEndV = sy > 0 ? v2.end : v2.start;
    const movedEndV = sy > 0 ? v2.start : v2.end;
    expect(keptEndV).toEqual({ x: 0, y: sy * 100 });
    expect(movedEndV).toEqual({ x: 0, y: sy * 10 });
    expectTangentArc(horizontal, vertical, h2, v2, arc, 10);
  });

  it("the arc takes the attributes of the first figure (layer, color, dash, weight), not the second", () => {
    const first = line("a", 0, 0, 100, 0, { layer: "wall", color: "#ff0000", lineDash: { pattern: [4, 2] } as CadLine["lineDash"], lineWeight: 50 });
    const second = line("b", 0, 0, 0, 100, { layer: "other", color: "#00ff00" });
    const r = ok(cornerEntities(first, { x: 50, y: 0 }, second, { x: 0, y: 50 }, fillet(10)));
    const arc = r.added[0] as CadArc;
    expect(arc).toMatchObject({ type: "ARC", layer: "wall", color: "#ff0000", lineWeight: 50 });
    expect(arc.lineDash).toEqual(first.lineDash);
    // 置き換えた2本は、それぞれの属性のまま
    expect(r.replaced[0]).toMatchObject({ id: "a", layer: "wall" });
    expect(r.replaced[1]).toMatchObject({ id: "b", layer: "other", color: "#00ff00" });
  });

  it("extends lines that do not reach the corner, and trims lines that cross it", () => {
    // 交点 (0,0) に届かない2本(端は、交点から 20 の所)。半径 10 → 接点は 10 の所。延ばす
    const a = line("a", -100, 0, -20, 0);
    const b = line("b", 0, -100, 0, -20);
    const r = ok(cornerEntities(a, { x: -60, y: 0 }, b, { x: 0, y: -60 }, fillet(10)));
    const [a2, b2] = r.replaced as CadLine[];
    expect(a2.start).toEqual({ x: -100, y: 0 });
    expect(a2.end).toEqual({ x: -10, y: 0 });
    expect(b2.start).toEqual({ x: 0, y: -100 });
    expect(b2.end).toEqual({ x: 0, y: -10 });
    expect((r.added[0] as CadArc).center).toEqual({ x: -10, y: -10 });
    // 交点を越えている2本(端は、交点の向こう側 30 の所)。短くする
    const c = line("c", -100, 0, 30, 0);
    const d = line("d", 0, -100, 0, 30);
    const r2 = ok(cornerEntities(c, { x: -60, y: 0 }, d, { x: 0, y: -60 }, fillet(10)));
    expect((r2.replaced[0] as CadLine).end).toEqual({ x: -10, y: 0 });
    expect((r2.replaced[1] as CadLine).end).toEqual({ x: 0, y: -10 });
  });

  it("keeps the direction (start/end) of lines drawn the other way round", () => {
    const a = line("a", 100, 0, -100, 0);
    const b = line("b", 0, 100, 0, -100);
    const r = ok(cornerEntities(a, { x: 50, y: 0 }, b, { x: 0, y: 50 }, fillet(10)));
    expect((r.replaced[0] as CadLine).start).toEqual({ x: 100, y: 0 });
    expect((r.replaced[0] as CadLine).end).toEqual({ x: 10, y: 0 });
    expect((r.replaced[1] as CadLine).start).toEqual({ x: 0, y: 100 });
    expect((r.replaced[1] as CadLine).end).toEqual({ x: 0, y: 10 });
  });

  it("refuses when the radius is too large for the length of a line (also when the tangent point is exactly the end)", () => {
    const a = line("a", 0, 0, 20, 0);
    const b = line("b", 0, 0, 0, 30);
    expect(cornerEntities(a, { x: 10, y: 0 }, b, { x: 0, y: 10 }, fillet(30))).toMatchObject({ ok: false, reason: expect.stringContaining("半径が大きすぎます") });
    // 接点が、短い方の線の端と同じ(残る長さが 0)
    expect(cornerEntities(a, { x: 10, y: 0 }, b, { x: 0, y: 10 }, fillet(20))).toMatchObject({ ok: false, reason: expect.stringContaining("半径が大きすぎます") });
    expect(cornerEntities(a, { x: 10, y: 0 }, b, { x: 0, y: 10 }, fillet(19.99)).ok).toBe(true);
    expect(cornerEntities(a, { x: 10, y: 0 }, b, { x: 0, y: 10 }, fillet(Number.MAX_VALUE))).toMatchObject({ ok: false });
  });

  it("radius 0: joins the two lines at the intersection, with no arc", () => {
    const a = line("a", -100, 0, -20, 0);
    const b = line("b", 0, -100, 0, 50);
    const r = ok(cornerEntities(a, { x: -60, y: 0 }, b, { x: 0, y: -60 }, fillet(0)));
    expect(r.added).toEqual([]);
    expect((r.replaced[0] as CadLine).end).toEqual({ x: 0, y: 0 });
    expect((r.replaced[1] as CadLine).end).toEqual({ x: 0, y: 0 });
    expect((r.replaced[1] as CadLine).start).toEqual({ x: 0, y: -100 });
  });

  it("refuses parallel and collinear lines, the same line twice, and a click on the intersection", () => {
    expect(cornerEntities(line("a", 0, 0, 100, 0), { x: 50, y: 0 }, line("b", 0, 10, 100, 10), { x: 50, y: 10 }, fillet(5))).toEqual({ ok: false, reason: CORNER_PARALLEL_REASON });
    expect(cornerEntities(line("a", 0, 0, 100, 0), { x: 50, y: 0 }, line("b", 200, 0, 300, 0), { x: 250, y: 0 }, fillet(5))).toEqual({ ok: false, reason: CORNER_PARALLEL_REASON });
    const a = line("a", 0, 0, 100, 0);
    expect(cornerEntities(a, { x: 10, y: 0 }, a, { x: 90, y: 0 }, fillet(5))).toEqual({ ok: false, reason: CORNER_SAME_LINE_REASON });
    // 交点の位置をクリックしたら、どちら側の腕か決まらない
    expect(cornerEntities(line("h", -100, 0, 100, 0), { x: 0, y: 0 }, line("v", 0, -100, 0, 100), { x: 0, y: 50 }, fillet(5))).toEqual({ ok: false, reason: CORNER_AMBIGUOUS_SIDE_REASON });
  });

  it("works with lines at any angle: acute, obtuse, rotated (the arc is tangent to both)", () => {
    for (const degrees of [10, 30, 45, 60, 90, 120, 150, 170]) {
      const angle = (degrees * Math.PI) / 180;
      const a = line("a", 0, 0, 200, 0);
      const b = line("b", 0, 0, 200 * Math.cos(angle), 200 * Math.sin(angle));
      const r = ok(cornerEntities(a, { x: 100, y: 0 }, b, { x: 100 * Math.cos(angle), y: 100 * Math.sin(angle) }, fillet(7)));
      expectTangentArc(a, b, r.replaced[0] as CadLine, r.replaced[1] as CadLine, r.added[0] as CadArc, 7);
    }
  });
});

describe("line and line: CHAMFER", () => {
  const horizontal = line("h", -100, 0, 100, 0);
  const vertical = line("v", 0, -100, 0, 100);

  it("connects the points at distance 1 on the first line and distance 2 on the second line", () => {
    const r = ok(cornerEntities(horizontal, { x: 50, y: 0 }, vertical, { x: 0, y: 50 }, chamfer(10, 20)));
    expect(r.added).toHaveLength(1);
    expect(r.added[0]).toMatchObject({ type: "LINE", start: { x: 10, y: 0 }, end: { x: 0, y: 20 } });
    expect((r.replaced[0] as CadLine).start).toEqual({ x: 10, y: 0 });
    expect((r.replaced[0] as CadLine).end).toEqual({ x: 100, y: 0 });
    expect((r.replaced[1] as CadLine).start).toEqual({ x: 0, y: 20 });
    expect((r.replaced[1] as CadLine).end).toEqual({ x: 0, y: 100 });
  });

  it("swapping the order of the clicks swaps which distance goes where", () => {
    const r = ok(cornerEntities(vertical, { x: 0, y: -50 }, horizontal, { x: -50, y: 0 }, chamfer(10, 20)));
    // 1つ目 = 縦の線(下側の腕): 距離 10 → (0,-10)。2つ目 = 横の線(左側の腕): 距離 20 → (-20,0)
    expect(r.added[0]).toMatchObject({ type: "LINE", start: { x: 0, y: -10 }, end: { x: -20, y: 0 } });
  });

  it("the chamfer line takes the attributes of the first figure", () => {
    const first = line("a", 0, 0, 100, 0, { layer: "wall", color: "#ff0000" });
    const second = line("b", 0, 0, 0, 100, { layer: "other" });
    const r = ok(cornerEntities(first, { x: 50, y: 0 }, second, { x: 0, y: 50 }, chamfer(5, 5)));
    expect(r.added[0]).toMatchObject({ type: "LINE", layer: "wall", color: "#ff0000" });
  });

  it("distance 0 and 0 joins the lines at the intersection; one distance 0 only is refused", () => {
    const r = ok(cornerEntities(line("a", -100, 0, -20, 0), { x: -60, y: 0 }, line("b", 0, -100, 0, -20), { x: 0, y: -60 }, chamfer(0, 0)));
    expect(r.added).toEqual([]);
    expect((r.replaced[0] as CadLine).end).toEqual({ x: 0, y: 0 });
    expect(cornerEntities(horizontal, { x: 50, y: 0 }, vertical, { x: 0, y: 50 }, chamfer(0, 5))).toMatchObject({ ok: false, reason: expect.stringContaining("片方だけ 0") });
    expect(cornerEntities(horizontal, { x: 50, y: 0 }, vertical, { x: 0, y: 50 }, chamfer(5, 0))).toMatchObject({ ok: false });
  });

  it("refuses a distance longer than a line (or equal to the whole remaining length)", () => {
    const a = line("a", 0, 0, 20, 0);
    const b = line("b", 0, 0, 0, 30);
    expect(cornerEntities(a, { x: 10, y: 0 }, b, { x: 0, y: 10 }, chamfer(21, 5))).toMatchObject({ ok: false, reason: expect.stringContaining("距離が長すぎます") });
    expect(cornerEntities(a, { x: 10, y: 0 }, b, { x: 0, y: 10 }, chamfer(20, 5))).toMatchObject({ ok: false });
    expect(cornerEntities(a, { x: 10, y: 0 }, b, { x: 0, y: 10 }, chamfer(5, 30))).toMatchObject({ ok: false });
    expect(cornerEntities(a, { x: 10, y: 0 }, b, { x: 0, y: 10 }, chamfer(19, 29)).ok).toBe(true);
  });
});

describe("a random set of line pairs (tangency, arms, collinearity)", () => {
  function random(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it("every accepted result is a tangent arc on the clicked side, and the new lines stay on the original lines", () => {
    const rand = random(13);
    const between = (lo: number, hi: number): number => lo + (hi - lo) * rand();
    let accepted = 0;
    let refused = 0;
    for (let i = 0; i < 600; i++) {
      const a = line("a", between(-100, 100), between(-100, 100), between(-100, 100), between(-100, 100));
      const b = line("b", between(-100, 100), between(-100, 100), between(-100, 100), between(-100, 100));
      const at = (l: CadLine, t: number): Point2D => ({ x: l.start.x + (l.end.x - l.start.x) * t, y: l.start.y + (l.end.y - l.start.y) * t });
      const ca = at(a, between(0.05, 0.95));
      const cb = at(b, between(0.05, 0.95));
      const radius = between(0.1, 25);
      const result = cornerEntities(a, ca, b, cb, fillet(radius));
      if (!result.ok) {
        refused++;
        continue;
      }
      accepted++;
      const [a2, b2] = result.replaced as CadLine[];
      const arc = result.added[0] as CadArc;
      expectTangentArc(a, b, a2, b2, arc, radius);
      // 新しい線は、元の線の上にある(座標の大きさに対する丸め誤差の範囲で)
      for (const [orig, next] of [[a, a2], [b, b2]] as const) {
        expect(distanceToInfiniteLine(next.start, orig.start, orig.end)).toBeLessThan(1e-8);
        expect(distanceToInfiniteLine(next.end, orig.start, orig.end)).toBeLessThan(1e-8);
      }
      // クリックした側の腕が残る: 元の端のうち、残っている端は、交点から見て、クリックと同じ側
      const x = intersection(a, b);
      for (const [orig, next, click] of [[a, a2, ca], [b, b2, cb]] as const) {
        const kept = samePoint(next.start, orig.start, 1e-12) || samePoint(next.end, orig.end, 1e-12) ? (samePoint(next.start, orig.start, 1e-12) ? orig.start : orig.end) : null;
        expect(kept).not.toBeNull();
        const dx = orig.end.x - orig.start.x;
        const dy = orig.end.y - orig.start.y;
        const sideOfKept = (kept!.x - x.x) * dx + (kept!.y - x.y) * dy;
        const sideOfClick = (click.x - x.x) * dx + (click.y - x.y) * dy;
        expect(Math.sign(sideOfKept)).toBe(Math.sign(sideOfClick));
      }
    }
    // 受け付ける組と、断る組の、どちらも出る(検証が空振りしていない)
    expect(accepted).toBeGreaterThan(100);
    expect(refused).toBeGreaterThan(20);
  });
});

describe("polyline: two adjacent segments", () => {
  const rect = (): CadPolyline => polyline("r", [[0, 0], [100, 0], [100, 50], [0, 50]], true);

  /** 円弧の頂点が、すべて円の上にあり、隣り合う頂点の弦の誤差が上限以内 */
  function expectArcVertices(points: Point2D[], center: Point2D, radius: number): void {
    for (const p of points) expect(Math.abs(Math.hypot(p.x - center.x, p.y - center.y) - radius)).toBeLessThan(1e-9 * Math.max(1, radius));
    for (let i = 0; i + 1 < points.length; i++) {
      const mid = { x: (points[i].x + points[i + 1].x) / 2, y: (points[i].y + points[i + 1].y) / 2 };
      const sagitta = radius - Math.hypot(mid.x - center.x, mid.y - center.y);
      expect(sagitta).toBeLessThanOrEqual(radius * ARC_CHORD_ERROR * (1 + 1e-6));
      expect(sagitta).toBeGreaterThanOrEqual(-1e-9);
    }
  }

  it("rounds a corner of a closed rectangle: the vertex becomes an arc of vertices (about 56 segments for 90°)", () => {
    const r = ok(cornerEntities(rect(), { x: 50, y: 0 }, rect(), { x: 100, y: 25 }, fillet(10)));
    expect(r.added).toEqual([]);
    const result = r.replaced[0] as CadPolyline;
    expect(result.id).toBe("r");
    expect(result.closed).toBe(true);
    expect(result.vertices[0]).toEqual({ x: 0, y: 0 });
    const arcStartIndex = 1;
    // 最後の2つは、元の頂点(100,50)・(0,50)
    expect(result.vertices.slice(-2)).toEqual([{ x: 100, y: 50 }, { x: 0, y: 50 }]);
    const arc = result.vertices.slice(arcStartIndex, -2);
    expect(arc[0]).toEqual({ x: 90, y: 0 });
    expect(arc[arc.length - 1]).toEqual({ x: 100, y: 10 });
    expect(arc.length - 1).toBeGreaterThanOrEqual(55);
    expect(arc.length - 1).toBeLessThanOrEqual(57);
    expectArcVertices(arc, { x: 90, y: 10 }, 10);
  });

  it("the order of the two clicks does not change the shape (only the chamfer distances are tied to the order)", () => {
    const a = ok(cornerEntities(rect(), { x: 50, y: 0 }, rect(), { x: 100, y: 25 }, fillet(10)));
    const b = ok(cornerEntities(rect(), { x: 100, y: 25 }, rect(), { x: 50, y: 0 }, fillet(10)));
    expect(b.replaced).toEqual(a.replaced);
    const c1 = ok(cornerEntities(rect(), { x: 50, y: 0 }, rect(), { x: 100, y: 25 }, chamfer(10, 20))).replaced[0] as CadPolyline;
    expect(c1.vertices).toEqual([{ x: 0, y: 0 }, { x: 90, y: 0 }, { x: 100, y: 20 }, { x: 100, y: 50 }, { x: 0, y: 50 }]);
    // 1つ目 = 縦の線分(距離 10 → (100,10))、2つ目 = 横の線分(距離 20 → (80,0))
    const c2 = ok(cornerEntities(rect(), { x: 100, y: 25 }, rect(), { x: 50, y: 0 }, chamfer(10, 20))).replaced[0] as CadPolyline;
    expect(c2.vertices).toEqual([{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 100, y: 10 }, { x: 100, y: 50 }, { x: 0, y: 50 }]);
  });

  it("each of the four corners of a closed rectangle, including the joint of the last and the first segment", () => {
    // 頂点0 (0,0): 最後の線分(0,50)→(0,0) と、最初の線分
    const v0 = ok(cornerEntities(rect(), { x: 0, y: 25 }, rect(), { x: 50, y: 0 }, fillet(10))).replaced[0] as CadPolyline;
    expect(v0.vertices.slice(-3)).toEqual([{ x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }]);
    expect(v0.vertices[0]).toEqual({ x: 0, y: 10 });
    expect(v0.vertices[v0.vertices.length - 4]).toEqual({ x: 10, y: 0 });
    expectArcVertices(v0.vertices.slice(0, -3), { x: 10, y: 10 }, 10);
    expect(v0.closed).toBe(true);
    // 頂点2 (100,50)
    const v2 = ok(cornerEntities(rect(), { x: 100, y: 25 }, rect(), { x: 50, y: 50 }, fillet(10))).replaced[0] as CadPolyline;
    expect(v2.vertices.slice(0, 2)).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }]);
    expect(v2.vertices.slice(-1)).toEqual([{ x: 0, y: 50 }]);
    expectArcVertices(v2.vertices.slice(2, -1), { x: 90, y: 40 }, 10);
    // 頂点3 (0,50): 最後の頂点
    const v3 = ok(cornerEntities(rect(), { x: 50, y: 50 }, rect(), { x: 0, y: 25 }, fillet(10))).replaced[0] as CadPolyline;
    expect(v3.vertices.slice(0, 3)).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }]);
    expectArcVertices(v3.vertices.slice(3), { x: 10, y: 40 }, 10);
    expect(v3.vertices[3]).toEqual({ x: 10, y: 50 });
    expect(v3.vertices[v3.vertices.length - 1]).toEqual({ x: 0, y: 40 });
  });

  it("an open polyline: only adjacent segments (the first and the last segment are not adjacent)", () => {
    const open = polyline("p", [[0, 0], [100, 0], [100, 50], [0, 50]], false);
    const r = ok(cornerEntities(open, { x: 50, y: 0 }, open, { x: 100, y: 25 }, chamfer(10, 10))).replaced[0] as CadPolyline;
    expect(r.closed).toBe(false);
    expect(r.vertices).toEqual([{ x: 0, y: 0 }, { x: 90, y: 0 }, { x: 100, y: 10 }, { x: 100, y: 50 }, { x: 0, y: 50 }]);
    // 最初の線分と最後の線分は、開いた折れ線では、隣り合わない
    expect(cornerEntities(open, { x: 50, y: 0 }, open, { x: 50, y: 50 }, fillet(5))).toEqual({ ok: false, reason: CORNER_NOT_ADJACENT_REASON });
    // 離れた線分
    const long = polyline("q", [[0, 0], [10, 0], [10, 10], [20, 10], [20, 20]], false);
    expect(cornerEntities(long, { x: 5, y: 0 }, long, { x: 15, y: 10 }, fillet(1))).toEqual({ ok: false, reason: CORNER_NOT_ADJACENT_REASON });
  });

  it("the same segment twice is refused", () => {
    expect(cornerEntities(rect(), { x: 20, y: 0 }, rect(), { x: 80, y: 0 }, fillet(5))).toEqual({ ok: false, reason: CORNER_SAME_SEGMENT_REASON });
  });

  it("a tangent point at the neighbouring vertex reuses that vertex (no zero-length segment); beyond it is refused", () => {
    // 辺 (100,0)-(100,50) の長さは 50。半径 50 → 接点が (100,50) と同じ
    const exact = ok(cornerEntities(rect(), { x: 50, y: 0 }, rect(), { x: 100, y: 25 }, fillet(50))).replaced[0] as CadPolyline;
    expect(exact.vertices.slice(-2)).toEqual([{ x: 100, y: 50 }, { x: 0, y: 50 }]);
    expect(exact.vertices[exact.vertices.length - 3]).not.toEqual({ x: 100, y: 50 });
    for (let i = 0; i < exact.vertices.length; i++) {
      const next = exact.vertices[(i + 1) % exact.vertices.length];
      expect(samePoint(exact.vertices[i], next, 1e-12)).toBe(false);
    }
    expect(cornerEntities(rect(), { x: 50, y: 0 }, rect(), { x: 100, y: 25 }, fillet(50.01))).toMatchObject({ ok: false, reason: expect.stringContaining("半径が大きすぎます") });
    expect(cornerEntities(rect(), { x: 50, y: 0 }, rect(), { x: 100, y: 25 }, chamfer(10, 51))).toMatchObject({ ok: false, reason: expect.stringContaining("距離が長すぎます") });
  });

  it("radius 0 and distance 0 change nothing (the segments already meet at the vertex): refused", () => {
    expect(cornerEntities(rect(), { x: 50, y: 0 }, rect(), { x: 100, y: 25 }, fillet(0))).toEqual({ ok: false, reason: CORNER_NOTHING_CHANGES_REASON });
    expect(cornerEntities(rect(), { x: 50, y: 0 }, rect(), { x: 100, y: 25 }, chamfer(0, 0))).toEqual({ ok: false, reason: CORNER_NOTHING_CHANGES_REASON });
  });

  it("a chamfer that would remove a whole closed triangle's vertices is refused (fewer than 3 vertices)", () => {
    const triangle = polyline("t", [[0, 0], [10, 0], [0, 10]], true);
    const hypotenuse = Math.hypot(10, 10);
    expect(cornerEntities(triangle, { x: 5, y: 0 }, triangle, { x: 5, y: 5 }, chamfer(10, hypotenuse))).toMatchObject({ ok: false, reason: expect.stringContaining("成り立ちません") });
  });

  it("a straight joint (collinear segments) and a fold-back have no corner: refused", () => {
    const straight = polyline("s", [[0, 0], [50, 0], [100, 0]], false);
    expect(cornerEntities(straight, { x: 25, y: 0 }, straight, { x: 75, y: 0 }, fillet(5))).toMatchObject({ ok: false, reason: expect.stringContaining("一直線") });
    const fold = polyline("f", [[0, 0], [50, 0], [0, 0]], false);
    expect(cornerEntities(fold, { x: 10, y: 0 }, fold, { x: 40, y: 0 }, fillet(5))).toMatchObject({ ok: false });
  });

  it("works with a polyline that has an acute and an obtuse corner at any rotation (tangent points at distance t, arc on the circle)", () => {
    for (const degrees of [20, 45, 90, 135, 160]) {
      for (const rotate of [0, 33]) {
        const angle = (degrees * Math.PI) / 180;
        const turn = (rotate * Math.PI) / 180;
        const pts: Array<[number, number]> = [[200, 0], [0, 0], [200 * Math.cos(angle), 200 * Math.sin(angle)]];
        const rotated = pts.map(([x, y]) => [x * Math.cos(turn) - y * Math.sin(turn), x * Math.sin(turn) + y * Math.cos(turn)] as [number, number]);
        const pl = polyline("p", rotated, false);
        const radius = 9;
        const r = ok(cornerEntities(pl, { x: rotated[0][0] / 2, y: rotated[0][1] / 2 }, pl, { x: rotated[2][0] / 2, y: rotated[2][1] / 2 }, fillet(radius))).replaced[0] as CadPolyline;
        const t = radius / Math.tan(angle / 2);
        const arc = r.vertices.slice(1, -1);
        // 接点は、角から t の所
        expect(close(Math.hypot(arc[0].x - rotated[1][0], arc[0].y - rotated[1][1]), t, 1e-9)).toBe(true);
        expect(close(Math.hypot(arc[arc.length - 1].x - rotated[1][0], arc[arc.length - 1].y - rotated[1][1]), t, 1e-9)).toBe(true);
        // 中心は、角から、二等分線の上で r / sin(θ/2) の所
        const ux = rotated[0][0] / 200;
        const uy = rotated[0][1] / 200;
        const wx = rotated[2][0] / 200;
        const wy = rotated[2][1] / 200;
        const bx = ux + wx;
        const by = uy + wy;
        const bl = Math.hypot(bx, by);
        const distance = radius / Math.sin(angle / 2);
        const center = { x: rotated[1][0] + (bx / bl) * distance, y: rotated[1][1] + (by / bl) * distance };
        expectArcVertices(arc, center, radius);
      }
    }
  });

  it("keeps the attributes of the polyline and its other vertices (the same objects)", () => {
    const source = polyline("r", [[0, 0], [100, 0], [100, 50], [0, 50]], true, { layer: "wall", color: "#123456", lineWeight: 35 });
    const r = ok(cornerEntities(source, { x: 50, y: 0 }, source, { x: 100, y: 25 }, chamfer(5, 5))).replaced[0] as CadPolyline;
    expect(r).toMatchObject({ id: "r", type: "LWPOLYLINE", layer: "wall", color: "#123456", lineWeight: 35, closed: true });
    expect(r.vertices[0]).toBe(source.vertices[0]);
    expect(r.vertices[r.vertices.length - 1]).toBe(source.vertices[3]);
    const poly2 = polyline("x", [[0, 0], [10, 0], [10, 10]], false, { type: "POLYLINE" });
    expect((ok(cornerEntities(poly2, { x: 5, y: 0 }, poly2, { x: 10, y: 5 }, chamfer(2, 2))).replaced[0] as CadPolyline).type).toBe("POLYLINE");
  });

  it("refuses a polyline with a zero-length segment at the corner", () => {
    const degenerate = polyline("d", [[0, 0], [10, 0], [10, 0], [10, 10]], false);
    expect(cornerEntities(degenerate, { x: 5, y: 0 }, degenerate, { x: 10, y: 0 }, fillet(1))).toMatchObject({ ok: false });
  });

  it("a closed polyline of two vertices (back and forth) has no corner", () => {
    const two = polyline("two", [[0, 0], [10, 0]], true);
    expect(cornerEntities(two, { x: 2, y: 0 }, two, { x: 8, y: 0 }, fillet(1))).toMatchObject({ ok: false });
  });
});

describe("combinations that are not supported are refused with a reason", () => {
  it("a polyline with another figure, two different polylines, arcs and circles", () => {
    const pl = polyline("p", [[0, 0], [10, 0], [10, 10]], false);
    const other = polyline("o", [[0, 0], [10, 0], [10, 10]], false);
    const l = line("l", 0, 0, 10, 10);
    expect(cornerEntities(pl, { x: 5, y: 0 }, l, { x: 5, y: 5 }, fillet(1))).toEqual({ ok: false, reason: CORNER_MIXED_REASON });
    expect(cornerEntities(l, { x: 5, y: 5 }, pl, { x: 5, y: 0 }, fillet(1))).toEqual({ ok: false, reason: CORNER_MIXED_REASON });
    expect(cornerEntities(pl, { x: 5, y: 0 }, other, { x: 10, y: 5 }, fillet(1))).toEqual({ ok: false, reason: CORNER_MIXED_REASON });
    const arc: CadArc = { id: "a", type: "ARC", layer: "0", color: "#fff", center: { x: 0, y: 0 }, radius: 5, startAngle: 0, endAngle: 1 };
    const circle: CadCircle = { id: "c", type: "CIRCLE", layer: "0", color: "#fff", center: { x: 0, y: 0 }, radius: 5 };
    expect(cornerEntities(arc, { x: 5, y: 0 }, l, { x: 5, y: 5 }, fillet(1))).toMatchObject({ ok: false, reason: expect.stringContaining("ARC は、処理できません") });
    expect(cornerEntities(l, { x: 5, y: 5 }, circle, { x: 5, y: 0 }, fillet(1))).toMatchObject({ ok: false, reason: expect.stringContaining("CIRCLE は、処理できません") });
    expect([...FILLET_TYPES].sort()).toEqual(["LINE", "LWPOLYLINE", "POLYLINE"]);
  });
});

describe("values and robustness", () => {
  it("validateCornerMode: radius and distances", () => {
    expect(validateCornerMode(fillet(0))).toBeNull();
    expect(validateCornerMode(fillet(5))).toBeNull();
    expect(validateCornerMode(fillet(-1))).toContain("0 以上");
    expect(validateCornerMode(fillet(Number.NaN))).toContain("0 以上");
    expect(validateCornerMode(fillet(Number.POSITIVE_INFINITY))).toContain("0 以上");
    expect(validateCornerMode(chamfer(0, 0))).toBeNull();
    expect(validateCornerMode(chamfer(3, 4))).toBeNull();
    expect(validateCornerMode(chamfer(-1, 4))).toContain("0 以上");
    expect(validateCornerMode(chamfer(0, 4))).toContain("片方だけ 0");
    expect(validateCornerMode(chamfer(4, 0))).toContain("片方だけ 0");
  });

  it("invalid values and clicks are refused before anything is computed", () => {
    const a = line("a", 0, 0, 100, 0);
    const b = line("b", 0, 0, 0, 100);
    expect(cornerEntities(a, { x: 50, y: 0 }, b, { x: 0, y: 50 }, fillet(-1))).toMatchObject({ ok: false });
    expect(cornerEntities(a, { x: Number.NaN, y: 0 }, b, { x: 0, y: 50 }, fillet(1))).toMatchObject({ ok: false });
    expect(cornerEntities(a, { x: 50, y: 0 }, b, { x: 0, y: Number.POSITIVE_INFINITY }, fillet(1))).toMatchObject({ ok: false });
  });

  it("never throws or returns non-finite coordinates for extreme inputs (fail closed)", () => {
    const big = 1e308;
    const cases: Array<[CadEntity, CadEntity]> = [
      [line("a", -big, 0, big, 0), line("b", 0, -big, 0, big)],
      [line("a", 0, 0, 1e-300, 0), line("b", 0, 0, 0, 1e-300)],
      [line("a", 1e9, 1e9, 1e9 + 100, 1e9), line("b", 1e9, 1e9, 1e9, 1e9 + 100)],
      [line("a", 0, 0, 1, 1e-12), line("b", 0, 0, 1, -1e-12)],
    ];
    for (const [a, b] of cases) {
      for (const mode of [fillet(1), fillet(1e-9), fillet(1e12), chamfer(1, 2), chamfer(1e-9, 1e-9)]) {
        const result = cornerEntities(a, { x: (a as CadLine).end.x / 2, y: (a as CadLine).end.y / 2 }, b, { x: (b as CadLine).end.x / 2, y: (b as CadLine).end.y / 2 }, mode);
        if (!result.ok) continue;
        const text = JSON.stringify([...result.replaced, ...result.added]);
        expect(text).not.toContain("null");
      }
    }
  });

  it("does not change the figures it was given", () => {
    const a = Object.freeze(line("a", -100, 0, 100, 0));
    const b = Object.freeze(line("b", 0, -100, 0, 100));
    const before = JSON.stringify([a, b]);
    cornerEntities(a, { x: 50, y: 0 }, b, { x: 0, y: 50 }, fillet(10));
    cornerEntities(a, { x: 50, y: 0 }, b, { x: 0, y: 50 }, chamfer(10, 20));
    const pl = polyline("p", [[0, 0], [100, 0], [100, 50]], false);
    const copy = JSON.stringify(pl);
    cornerEntities(pl, { x: 50, y: 0 }, pl, { x: 100, y: 25 }, fillet(10));
    expect(JSON.stringify([a, b])).toBe(before);
    expect(JSON.stringify(pl)).toBe(copy);
  });

  it("a large radius on a short angle is refused, not clipped (tangent point beyond the end of the line)", () => {
    const a = line("a", 0, 0, 100, 0);
    const b = line("b", 0, 0, 100 * Math.cos(0.1), 100 * Math.sin(0.1));
    // 鋭角 0.1 rad: 接点までの距離は、半径の約 20 倍。半径 10 → 約 200 > 100
    expect(cornerEntities(a, { x: 50, y: 0 }, b, { x: 50 * Math.cos(0.1), y: 50 * Math.sin(0.1) }, fillet(10))).toMatchObject({ ok: false });
    expect(cornerEntities(a, { x: 50, y: 0 }, b, { x: 50 * Math.cos(0.1), y: 50 * Math.sin(0.1) }, fillet(2)).ok).toBe(true);
  });
});

describe("results that cannot be represented, and extreme coordinates (Codex review)", () => {
  it("a distance or radius too small for the coordinates is refused: no duplicate vertices, no zero-length line, no arc without a centre", () => {
    // 角が (1,1): 1 ± 1e-20 は、1 に丸まる(角と同じ位置の頂点が、連続してしまう)
    const open = polyline("p", [[0, 1], [1, 1], [1, 2]], false);
    expect(cornerEntities(open, { x: 0.5, y: 1 }, open, { x: 1, y: 1.5 }, chamfer(1e-20, 1e-20))).toEqual({ ok: false, reason: CORNER_PRECISION_REASON });
    expect(cornerEntities(open, { x: 0.5, y: 1 }, open, { x: 1, y: 1.5 }, fillet(1e-20))).toEqual({ ok: false, reason: CORNER_PRECISION_REASON });
    const a = line("a", 1, 1, 2, 1);
    const b = line("b", 1, 1, 1, 2);
    expect(cornerEntities(a, { x: 1.5, y: 1 }, b, { x: 1, y: 1.5 }, chamfer(1e-20, 1e-20))).toEqual({ ok: false, reason: CORNER_PRECISION_REASON });
    expect(cornerEntities(a, { x: 1.5, y: 1 }, b, { x: 1, y: 1.5 }, fillet(1e-20))).toEqual({ ok: false, reason: CORNER_PRECISION_REASON });
    // 角が原点なら、1e-20 は表現できる(0 の近くは細かい)。重複のない、有効な(とても短い)結果になる
    const origin = polyline("o", [[0, 0], [1, 0], [1, 1]], false);
    const tiny = (ok(cornerEntities(origin, { x: 0.5, y: 0 }, origin, { x: 1, y: 0.5 }, chamfer(1e-20, 1e-20))).replaced[0] as CadPolyline).vertices;
    for (let i = 0; i + 1 < tiny.length; i++) expect(tiny[i].x === tiny[i + 1].x && tiny[i].y === tiny[i + 1].y).toBe(false);
    // 座標が 1e16(1 が表現できない桁)の、直交する長さ 100 の2本に、半径 1
    const far1 = line("a", 1e16, 1e16, 1e16 + 100, 1e16);
    const far2 = line("b", 1e16, 1e16, 1e16, 1e16 + 100);
    expect(cornerEntities(far1, { x: 1e16 + 50, y: 1e16 }, far2, { x: 1e16, y: 1e16 + 50 }, fillet(1))).toEqual({ ok: false, reason: CORNER_PRECISION_REASON });
    const farPoly = polyline("f", [[1e16, 1e16 + 100], [1e16, 1e16], [1e16 + 100, 1e16]], false);
    expect(cornerEntities(farPoly, { x: 1e16, y: 1e16 + 50 }, farPoly, { x: 1e16 + 50, y: 1e16 }, fillet(1))).toEqual({ ok: false, reason: CORNER_PRECISION_REASON });
    // 同じ座標の桁でも、表現できる大きさの半径なら、できる
    expect(cornerEntities(far1, { x: 1e16 + 50, y: 1e16 }, far2, { x: 1e16, y: 1e16 + 50 }, fillet(40)).ok).toBe(true);
  });

  it("normal results are not refused by the precision checks (small radius on a large drawing, large coordinates)", () => {
    const a = line("a", 1e6, 1e6, 1e6 + 1000, 1e6);
    const b = line("b", 1e6, 1e6, 1e6, 1e6 + 1000);
    for (const r of [1e-3, 0.5, 100]) {
      const result = ok(cornerEntities(a, { x: 1e6 + 500, y: 1e6 }, b, { x: 1e6, y: 1e6 + 500 }, fillet(r)));
      expectTangentArc(a, b, result.replaced[0] as CadLine, result.replaced[1] as CadLine, result.added[0] as CadArc, r);
    }
  });

  it("coordinates beyond 1e154 (squares overflow): the right segments and the right corner are used, or the result is refused honestly", () => {
    const big = 1e155;
    // 隣り合う線分(0,1)の組が、同じ線分と取り違えられない
    const pl = polyline("p", [[0, 0], [big, 0], [big, big]], false);
    const result = ok(cornerEntities(pl, { x: big / 2, y: 0 }, pl, { x: big, y: big / 2 }, fillet(1e150)));
    const vertices = (result.replaced[0] as CadPolyline).vertices;
    expect(vertices[0]).toEqual({ x: 0, y: 0 });
    expect(vertices[vertices.length - 1]).toEqual({ x: big, y: big });
    expect(vertices.length).toBeGreaterThan(50);
    expect(vertices.every((v) => Number.isFinite(v.x) && Number.isFinite(v.y))).toBe(true);
    // 交わる2本の線(長さの積が桁あふれ)が、平行と取り違えられない
    const a = line("a", 0, 0, big, 0);
    const b = line("b", 0, 0, 0, big);
    const lines = ok(cornerEntities(a, { x: big / 2, y: 0 }, b, { x: 0, y: big / 2 }, fillet(1e150)));
    expect((lines.added[0] as CadArc).center).toEqual({ x: 1e150, y: 1e150 });
    // 長さの積が 0 に潰れる極小の座標も、平行と取り違えない
    const tinyA = line("a", 0, 0, 1e-200, 0);
    const tinyB = line("b", 0, 0, 0, 1e-200);
    const tiny = ok(cornerEntities(tinyA, { x: 5e-201, y: 0 }, tinyB, { x: 0, y: 5e-201 }, fillet(1e-201)));
    expect((tiny.added[0] as CadArc).center).toEqual({ x: 1e-201, y: 1e-201 });
    // 本当に平行なものは、どの大きさでも、平行として断る
    expect(cornerEntities(a, { x: big / 2, y: 0 }, line("c", 0, 1, big, 1), { x: big / 2, y: 1 }, fillet(1))).toEqual({ ok: false, reason: CORNER_PARALLEL_REASON });
  });
});

describe("precision at large coordinates: every accepted arc is consistent (property)", () => {
  it("at 1e16 and 1e12 the lines and the polyline either are refused, or give tangent points exactly one radius from the centre", () => {
    let refused = 0;
    for (const base of [1e16, 1e12]) {
    const a = line("a", base, base, base + 100, base);
    const b = line("b", base, base, base, base + 100);
    const pl = polyline("p", [[base, base + 100], [base, base], [base + 100, base]], false);
    for (const r of [1, 1.5, 2, 2.5, 3, 3.7, 5, 7.3, 10, 25]) {
      const lines = cornerEntities(a, { x: base + 50, y: base }, b, { x: base, y: base + 50 }, fillet(r));
      if (lines.ok) {
        const arc = lines.added[0] as CadArc;
        for (const angle of [arc.startAngle, arc.endAngle]) {
          const p = onArc(arc, angle);
          expect(Math.abs(Math.hypot(p.x - arc.center.x, p.y - arc.center.y) - r)).toBeLessThanOrEqual(1e-6 * r + 1e-9);
        }
      } else {
        refused++;
        expect(lines.reason).toBe(CORNER_PRECISION_REASON);
      }
      const poly = cornerEntities(pl, { x: base, y: base + 50 }, pl, { x: base + 50, y: base }, fillet(r));
      if (poly.ok) {
        const vertices = (poly.replaced[0] as CadPolyline).vertices;
        for (let i = 0; i + 1 < vertices.length; i++) expect(vertices[i].x === vertices[i + 1].x && vertices[i].y === vertices[i + 1].y).toBe(false);
        // この向き(手前が真上、次が真右の直角)では、中心は (最後の接点の x, 最初の接点の y)。円弧の頂点は、すべて、そこから半径だけ離れている
        const arcVertices = vertices.slice(1, -1);
        const centre = { x: arcVertices[arcVertices.length - 1].x, y: arcVertices[0].y };
        for (const v of arcVertices) expect(Math.abs(Math.hypot(v.x - centre.x, v.y - centre.y) - r)).toBeLessThanOrEqual(1e-6 * r + 1e-9);
      } else {
        expect(poly.reason).toBe(CORNER_PRECISION_REASON);
      }
    }
    }
    // 座標が大きいと、小さい半径の多くは断られる(検証が空振りしていない)
    expect(refused).toBeGreaterThan(8);
  });

  it("segments whose length overflows (1e308) cannot be told apart: refused, not mistaken for the first segment", () => {
    const pl = polyline("p", [[-1e308, 0], [1e308, 0], [1e308, 1e308]], false);
    expect(cornerEntities(pl, { x: 0, y: 0 }, pl, { x: 1e308, y: 5e307 }, fillet(1))).toEqual({ ok: false, reason: expect.stringContaining("計算できません") });
  });
});