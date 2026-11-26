// 寸法の参照(アンカーの解決・一致する位置の探索)(Phase 16)
import { describe, expect, it } from "vitest";
import type { CadEntity, Point2D } from "../../types/cad";
import { anchorMatching, anchorToleranceAt, findAnchorsAt, isReferenceTarget, isSameAnchorPoint, resolveAnchor } from "./dimensionRefs";

const pt = (x: number, y: number): Point2D => ({ x, y });
const base = { layer: "0", color: "#fff" };
const line = (id: string, a: Point2D, b: Point2D, layer = "0"): CadEntity => ({ ...base, layer, id, type: "LINE", start: a, end: b });
const circle = (id: string, c: Point2D, r: number): CadEntity => ({ ...base, id, type: "CIRCLE", center: c, radius: r });
const arc = (id: string, c: Point2D, r: number, s: number, e: number): CadEntity => ({ ...base, id, type: "ARC", center: c, radius: r, startAngle: s, endAngle: e });
const poly = (id: string, vertices: Point2D[], closed = false): CadEntity => ({ ...base, id, type: "LWPOLYLINE", vertices, closed });
const near = (p: Point2D | null, x: number, y: number): void => {
  expect(p).not.toBeNull();
  expect(p!.x).toBeCloseTo(x, 9);
  expect(p!.y).toBeCloseTo(y, 9);
};

describe("resolveAnchor", () => {
  it("a line: start, end and the midpoint; nothing else", () => {
    const l = line("l", pt(0, 0), pt(10, 20));
    expect(resolveAnchor(l, { kind: "start" })).toEqual(pt(0, 0));
    expect(resolveAnchor(l, { kind: "end" })).toEqual(pt(10, 20));
    expect(resolveAnchor(l, { kind: "mid" })).toEqual(pt(5, 10));
    expect(resolveAnchor(l, { kind: "center" })).toBeNull();
    expect(resolveAnchor(l, { kind: "whole" })).toBeNull();
    expect(resolveAnchor(l, { kind: "vertex", index: 0 })).toBeNull();
  });

  it("an arc: start, end, mid (the middle angle) and the center", () => {
    const a = arc("a", pt(100, 100), 50, 0, Math.PI);
    near(resolveAnchor(a, { kind: "start" }), 150, 100);
    near(resolveAnchor(a, { kind: "end" }), 50, 100);
    near(resolveAnchor(a, { kind: "mid" }), 100, 150);
    expect(resolveAnchor(a, { kind: "center" })).toEqual(pt(100, 100));
    // 開始角より終了角が小さい弧は、反時計回りに回って、終点へ
    near(resolveAnchor(arc("a2", pt(0, 0), 10, (3 * Math.PI) / 2, Math.PI / 2), { kind: "mid" }), 10, 0);
  });

  it("a circle has only its center; a polyline only its vertices (in range)", () => {
    const c = circle("c", pt(7, 8), 5);
    expect(resolveAnchor(c, { kind: "center" })).toEqual(pt(7, 8));
    expect(resolveAnchor(c, { kind: "start" })).toBeNull();
    expect(resolveAnchor(c, { kind: "mid" })).toBeNull();
    const p = poly("p", [pt(0, 0), pt(10, 0), pt(10, 5)], true);
    expect(resolveAnchor(p, { kind: "vertex", index: 2 })).toEqual(pt(10, 5));
    for (const index of [-1, 3, 1.5, Number.NaN]) expect(resolveAnchor(p, { kind: "vertex", index })).toBeNull();
    expect(resolveAnchor(p, { kind: "start" })).toBeNull();
  });

  it("the midpoint of a line with huge coordinates does not overflow (1e308 and 1.1e308 give 1.05e308)", () => {
    const l = line("l", pt(1e308, 0), pt(1.1e308, 0));
    expect(resolveAnchor(l, { kind: "mid" })!.x).toBeCloseTo(1.05e308, -300);
    expect(Number.isFinite(resolveAnchor(l, { kind: "mid" })!.x)).toBe(true);
  });

  it("a position with a non-finite coordinate cannot be resolved; other figures have no anchors", () => {
    expect(resolveAnchor(line("l", pt(Number.NaN, 0), pt(1, 1)), { kind: "start" })).toBeNull();
    expect(resolveAnchor(line("l", pt(0, 0), pt(Infinity, 1)), { kind: "mid" })).toBeNull();
    const text: CadEntity = { ...base, id: "t", type: "TEXT", position: pt(0, 0), text: "x", height: 5, rotation: 0, horizontalAlign: "left", verticalAlign: "baseline" };
    expect(resolveAnchor(text, { kind: "start" })).toBeNull();
    expect(isReferenceTarget(text)).toBe(false);
    for (const e of [line("l", pt(0, 0), pt(1, 1)), circle("c", pt(0, 0), 1), arc("a", pt(0, 0), 1, 0, 1), poly("p", [pt(0, 0), pt(1, 1)])]) expect(isReferenceTarget(e)).toBe(true);
  });
});

describe("matching a point to an anchor", () => {
  it("finds the anchor at the point (start, end, mid, center, then vertex)", () => {
    const l = line("l", pt(0, 0), pt(10, 0));
    expect(anchorMatching(l, pt(0, 0))).toEqual({ kind: "start" });
    expect(anchorMatching(l, pt(10, 0))).toEqual({ kind: "end" });
    expect(anchorMatching(l, pt(5, 0))).toEqual({ kind: "mid" });
    expect(anchorMatching(l, pt(5, 1))).toBeNull();
    expect(anchorMatching(circle("c", pt(3, 4), 9), pt(3, 4))).toEqual({ kind: "center" });
    expect(anchorMatching(poly("p", [pt(0, 0), pt(10, 0), pt(10, 5)]), pt(10, 5))).toEqual({ kind: "vertex", index: 2 });
    expect(anchorMatching(arc("a", pt(0, 0), 10, 0, Math.PI), pt(0, 0))).toEqual({ kind: "center" });
  });

  it("a point on the figure but not at an anchor does not match; a point a little off does not either", () => {
    const l = line("l", pt(0, 0), pt(10, 0));
    expect(anchorMatching(l, pt(3, 0))).toBeNull();
    expect(anchorMatching(l, pt(1e-5, 0))).toBeNull();
    expect(anchorMatching(l, pt(1e-7, 0))).toEqual({ kind: "start" });
  });

  it("the tolerance grows a little with huge coordinates (rounding), and is symmetric", () => {
    expect(anchorToleranceAt(pt(0, 0))).toBeCloseTo(1e-6, 12);
    expect(anchorToleranceAt(pt(1e5, 0))).toBeGreaterThan(1e-6);
    // 上限がある(巨大な座標で、離れた点どうしを、一致とみなさない)
    expect(anchorToleranceAt(pt(1e9, 0))).toBeLessThanOrEqual(1e-4);
    expect(anchorToleranceAt(pt(1e12, 0))).toBeLessThanOrEqual(1e-4);
    expect(isSameAnchorPoint(pt(1e9, 0), pt(1e9 + 5e-5, 0))).toBe(true);
    expect(isSameAnchorPoint(pt(1e12, 0), pt(1e12 + 0.5, 0))).toBe(false);
    expect(isSameAnchorPoint(pt(0, 0), pt(1e-4, 0))).toBe(false);
    expect(isSameAnchorPoint(pt(1, 1), pt(1, 1.0000001))).toBe(true);
  });
});

describe("findAnchorsAt", () => {
  const visible = new Set(["0"]);

  it("finds the figure and its anchor for each point; points with no figure give null", () => {
    const entities = [line("a", pt(0, 0), pt(100, 0)), circle("c", pt(500, 500), 50)];
    expect(findAnchorsAt(entities, visible, [pt(100, 0), pt(500, 500), pt(40, 40)])).toEqual([
      { id: "a", anchor: { kind: "end" } },
      { id: "c", anchor: { kind: "center" } },
      null,
    ]);
    expect(findAnchorsAt(entities, visible, [])).toEqual([]);
  });

  it("at a shared corner, the figure drawn last (on top) is chosen", () => {
    const entities = [line("under", pt(0, 0), pt(100, 0)), line("over", pt(100, 0), pt(100, 100))];
    expect(findAnchorsAt(entities, visible, [pt(100, 0)])).toEqual([{ id: "over", anchor: { kind: "start" } }]);
    expect(findAnchorsAt([...entities].reverse(), visible, [pt(100, 0)])).toEqual([{ id: "under", anchor: { kind: "end" } }]);
  });

  it("figures on a hidden layer, and figures that cannot be referenced, are skipped", () => {
    const hidden = line("hidden", pt(0, 0), pt(100, 0), "OFF");
    const text: CadEntity = { ...base, id: "t", type: "TEXT", position: pt(100, 0), text: "x", height: 5, rotation: 0, horizontalAlign: "left", verticalAlign: "baseline" };
    expect(findAnchorsAt([hidden, text], visible, [pt(100, 0)])).toEqual([null]);
    expect(findAnchorsAt([hidden, line("shown", pt(100, 0), pt(100, 9))], visible, [pt(100, 0)])).toEqual([{ id: "shown", anchor: { kind: "start" } }]);
  });

  it("a figure with a non-finite coordinate does not match (and does not break the search)", () => {
    const broken = line("broken", pt(Number.NaN, 0), pt(1, 1));
    expect(findAnchorsAt([broken, line("ok", pt(0, 0), pt(5, 5))], visible, [pt(5, 5)])).toEqual([{ id: "ok", anchor: { kind: "end" } }]);
  });

  it("handles a large drawing quickly (one bounds pass for all the points)", () => {
    const entities: CadEntity[] = [];
    for (let i = 0; i < 50_000; i++) entities.push(line(`l${i}`, pt(i, 0), pt(i, 10)));
    const started = Date.now();
    const found = findAnchorsAt(entities, visible, [pt(25_000, 10), pt(10, 0), pt(-5, -5)]);
    expect(found.map((f) => f?.id ?? null)).toEqual(["l25000", "l10", null]);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
