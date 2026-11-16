// 拡大縮小・鏡像(相似変換)の、図形ごとの変換の正しさ(Phase 10)。
// 図形の輪郭の点を、行列で変換した点が、変換後の図形の上にあること、同じ行列(鏡像)を2回かけると元に戻ること、などを確かめる。
import { describe, expect, it } from "vitest";
import type { Affine2D, CadEntity, Point2D } from "../../types/cad";
import {
  applyAffine,
  composeAffine,
  isReflecting,
  isSimilarity,
  reflectionMatrix,
  rotationMatrix,
  scaleFactorOf,
  scaleMatrix,
  transformEntityGeometry,
  translationMatrix,
} from "./transform";

const base = { layer: "A", color: "#ffffff" };
const TWO_PI = Math.PI * 2;

const line: CadEntity = { ...base, id: "line", type: "LINE", start: { x: 10, y: 20 }, end: { x: 110, y: -40 } };
const polyline = { ...base, id: "pl", type: "LWPOLYLINE", vertices: [{ x: 0, y: 0, bulge: 0.5 }, { x: 50, y: 10 }, { x: 80, y: 70 }], closed: true } as unknown as CadEntity;
const circle: CadEntity = { ...base, id: "circle", type: "CIRCLE", center: { x: 30, y: 40 }, radius: 25 };
const arc: CadEntity = { ...base, id: "arc", type: "ARC", center: { x: -20, y: 5 }, radius: 40, startAngle: 0.3, endAngle: 2.4 };
const ellipse: CadEntity = { ...base, id: "ellipse", type: "ELLIPSE", center: { x: 5, y: 6 }, majorRadius: 30, minorRadius: 12, rotation: 0.5, startParam: 0.4, endParam: 3.9 };
const spline: CadEntity = { ...base, id: "spline", type: "SPLINE", points: [{ x: 0, y: 0 }, { x: 10, y: 15 }, { x: 25, y: -5 }, { x: 40, y: 10 }], closed: false };
const point: CadEntity = { ...base, id: "point", type: "POINT", position: { x: 7, y: -3 } };
const text: CadEntity = { ...base, id: "text", type: "TEXT", position: { x: 15, y: 25 }, text: "ABC", height: 5, rotation: 0.2, horizontalAlign: "left", verticalAlign: "baseline" };

/** 相似変換のいろいろ(倍率・回転・鏡像) */
function similarities(): Array<{ name: string; matrix: Affine2D }> {
  const list: Array<{ name: string; matrix: Affine2D }> = [
    { name: "scale 2 about a point", matrix: scaleMatrix({ x: 10, y: -5 }, 2) },
    { name: "scale 0.25 about a point", matrix: scaleMatrix({ x: -30, y: 8 }, 0.25) },
    { name: "mirror about the Y axis", matrix: reflectionMatrix({ x: 0, y: 0 }, { x: 0, y: 1 })! },
    { name: "mirror about a horizontal line", matrix: reflectionMatrix({ x: 5, y: 7 }, { x: 99, y: 7 })! },
    { name: "mirror about a slanted line", matrix: reflectionMatrix({ x: -3, y: 4 }, { x: 40, y: 31 })! },
    { name: "mirror about a 45 degree line", matrix: reflectionMatrix({ x: 0, y: 0 }, { x: 10, y: 10 })! },
    { name: "rotate then scale", matrix: composeAffine(rotationMatrix({ x: 1, y: 2 }, 0.9), scaleMatrix({ x: 4, y: 4 }, 1.7)) },
    { name: "mirror then scale", matrix: composeAffine(reflectionMatrix({ x: 2, y: 2 }, { x: 9, y: 30 })!, scaleMatrix({ x: 0, y: 0 }, 3)) },
  ];
  return list;
}

const close = (p: Point2D, q: Point2D, tolerance = 1e-8) => {
  expect(Math.abs(p.x - q.x)).toBeLessThan(tolerance);
  expect(Math.abs(p.y - q.y)).toBeLessThan(tolerance);
};
const angleDiff = (a: number, b: number) => {
  const d = (((a - b) % TWO_PI) + TWO_PI) % TWO_PI;
  return Math.min(d, TWO_PI - d);
};
/** 角度 a が、start から反時計回りに sweep の範囲にあるか(許容つき) */
const inSweep = (a: number, start: number, sweep: number, tolerance = 1e-9) => {
  const d = (((a - start) % TWO_PI) + TWO_PI) % TWO_PI;
  return d <= sweep + tolerance || d >= TWO_PI - tolerance;
};

describe("matrices for scaling and mirroring", () => {
  it("scaleMatrix keeps the base point fixed, and a factor of 1 is the identity", () => {
    close(applyAffine(scaleMatrix({ x: 10, y: -5 }, 3), { x: 10, y: -5 }), { x: 10, y: -5 });
    close(applyAffine(scaleMatrix({ x: 10, y: -5 }, 3), { x: 12, y: -5 }), { x: 16, y: -5 });
    expect(scaleMatrix({ x: 7, y: 9 }, 1)).toEqual([1, 0, 0, 1, 0, 0]);
  });

  it("reflectionMatrix is exact for axis-aligned and 45 degree lines, and the points on the line stay", () => {
    expect(reflectionMatrix({ x: 0, y: 0 }, { x: 0, y: 5 })).toEqual([-1, 0, 0, 1, 0, 0]); // Y 軸
    expect(reflectionMatrix({ x: 0, y: 3 }, { x: 8, y: 3 })).toEqual([1, 0, 0, -1, 0, 6]); // y = 3
    expect(reflectionMatrix({ x: 0, y: 0 }, { x: 4, y: 4 })).toEqual([0, 1, 1, 0, 0, 0]); // 45度
    expect(applyAffine(reflectionMatrix({ x: 0, y: 0 }, { x: -4, y: 0 })!, { x: 3, y: 5 })).toEqual({ x: 3, y: -5 }); // -0 を含まない
    for (const m of [reflectionMatrix({ x: -3, y: 4 }, { x: 40, y: 31 })!]) {
      close(applyAffine(m, { x: -3, y: 4 }), { x: -3, y: 4 });
      close(applyAffine(m, { x: 40, y: 31 }), { x: 40, y: 31 });
      // 2回かけると、元に戻る
      const twice = composeAffine(m, m);
      for (let i = 0; i < 6; i++) expect(Math.abs(twice[i] - [1, 0, 0, 1, 0, 0][i])).toBeLessThan(1e-9);
    }
    expect(reflectionMatrix({ x: 2, y: 2 }, { x: 2, y: 2 })).toBeNull();
    expect(reflectionMatrix({ x: 0, y: 0 }, { x: Number.NaN, y: 1 })).toBeNull();
  });

  it("isSimilarity accepts moves, rotations, uniform scaling and mirroring; refuses non-uniform scaling, shearing, collapse and non-finite", () => {
    expect(isSimilarity(translationMatrix(3, 4))).toBe(true);
    expect(isSimilarity(rotationMatrix({ x: 5, y: 5 }, 1.1))).toBe(true);
    expect(isSimilarity([2, 0, 0, 2, 0, 0])).toBe(true);
    expect(isSimilarity([1, 0, 0, -1, 0, 0])).toBe(true);
    expect(isSimilarity([0.5, 0, 0, -0.5, 1, 1])).toBe(true);
    expect(isSimilarity([2, 0, 0, 1, 0, 0])).toBe(false);
    expect(isSimilarity([1, 0, 0.5, 1, 0, 0])).toBe(false);
    expect(isSimilarity([0, 0, 0, 0, 1, 1])).toBe(false);
    expect(isSimilarity([Number.NaN, 0, 0, 1, 0, 0])).toBe(false);
    expect(isSimilarity([Infinity, 0, 0, Infinity, 0, 0])).toBe(false);
    expect(isReflecting([1, 0, 0, -1, 0, 0])).toBe(true);
    expect(isReflecting([2, 0, 0, 2, 0, 0])).toBe(false);
    expect(scaleFactorOf(composeAffine(reflectionMatrix({ x: 0, y: 0 }, { x: 1, y: 2 })!, scaleMatrix({ x: 0, y: 0 }, 3)))).toBeCloseTo(3, 12);
  });
});

describe("transformEntityGeometry with scaling and mirroring", () => {
  for (const { name, matrix } of similarities()) {
    const factor = scaleFactorOf(matrix);
    const reflecting = isReflecting(matrix);

    describe(name, () => {
      it("LINE, polyline (keeps bulge), spline, point: every point is moved by the matrix", () => {
        const moved = transformEntityGeometry(line, matrix) as typeof line & { start: Point2D; end: Point2D };
        close(moved.start, applyAffine(matrix, { x: 10, y: 20 }));
        close(moved.end, applyAffine(matrix, { x: 110, y: -40 }));

        const poly = transformEntityGeometry(polyline, matrix) as unknown as { vertices: Array<Point2D & { bulge?: number }> };
        poly.vertices.forEach((v, i) => close(v, applyAffine(matrix, (polyline as unknown as { vertices: Point2D[] }).vertices[i])));
        expect(poly.vertices[0].bulge).toBe(0.5); // 頂点が持つほかの値は、そのまま

        const sp = transformEntityGeometry(spline, matrix) as typeof spline & { points: Point2D[] };
        sp.points.forEach((p, i) => close(p, applyAffine(matrix, (spline as unknown as { points: Point2D[] }).points[i])));

        close((transformEntityGeometry(point, matrix) as typeof point & { position: Point2D }).position, applyAffine(matrix, { x: 7, y: -3 }));
      });

      it("CIRCLE: the center moves and the radius is multiplied by the factor", () => {
        const moved = transformEntityGeometry(circle, matrix) as typeof circle & { center: Point2D; radius: number };
        close(moved.center, applyAffine(matrix, { x: 30, y: 40 }));
        expect(moved.radius).toBeCloseTo(25 * factor, 9);
      });

      it("ARC: the transformed arc passes through every transformed original point, still counter-clockwise from start to end", () => {
        const source = arc as typeof arc & { center: Point2D; radius: number; startAngle: number; endAngle: number };
        const moved = transformEntityGeometry(arc, matrix) as typeof source;
        expect(moved.radius).toBeCloseTo(source.radius * factor, 9);
        close(moved.center, applyAffine(matrix, source.center));
        const sweep = (((moved.endAngle - moved.startAngle) % TWO_PI) + TWO_PI) % TWO_PI;
        // 弧の長さ(掃く角度)は、鏡像でも変わらない
        expect(sweep).toBeCloseTo(source.endAngle - source.startAngle, 9);
        for (let i = 0; i <= 10; i++) {
          const t = source.startAngle + ((source.endAngle - source.startAngle) * i) / 10;
          const p = applyAffine(matrix, { x: source.center.x + source.radius * Math.cos(t), y: source.center.y + source.radius * Math.sin(t) });
          expect(Math.hypot(p.x - moved.center.x, p.y - moved.center.y)).toBeCloseTo(moved.radius, 7);
          expect(inSweep(Math.atan2(p.y - moved.center.y, p.x - moved.center.x), moved.startAngle, sweep)).toBe(true);
        }
        // 始点は始点の位置へ、終点は終点の位置へ(鏡像では、入れ替わるので、両端が、どちらかの端に一致する)
        const startPoint = applyAffine(matrix, { x: source.center.x + source.radius * Math.cos(source.startAngle), y: source.center.y + source.radius * Math.sin(source.startAngle) });
        const movedStart = { x: moved.center.x + moved.radius * Math.cos(moved.startAngle), y: moved.center.y + moved.radius * Math.sin(moved.startAngle) };
        const movedEnd = { x: moved.center.x + moved.radius * Math.cos(moved.endAngle), y: moved.center.y + moved.radius * Math.sin(moved.endAngle) };
        close(reflecting ? movedEnd : movedStart, startPoint, 1e-7);
      });

      it("ELLIPSE (arc): every transformed point is on the transformed ellipse, within the transformed parameter range", () => {
        const source = ellipse as typeof ellipse & { center: Point2D; majorRadius: number; minorRadius: number; rotation: number; startParam: number; endParam: number };
        const moved = transformEntityGeometry(ellipse, matrix) as typeof source;
        close(moved.center, applyAffine(matrix, source.center));
        expect(moved.majorRadius).toBeGreaterThanOrEqual(moved.minorRadius - 1e-9);
        const cosR = Math.cos(source.rotation);
        const sinR = Math.sin(source.rotation);
        const cosM = Math.cos(moved.rotation);
        const sinM = Math.sin(moved.rotation);
        const sweep = (((moved.endParam - moved.startParam) % TWO_PI) + TWO_PI) % TWO_PI;
        expect(sweep).toBeCloseTo(source.endParam - source.startParam, 9);
        for (let i = 0; i <= 12; i++) {
          const t = source.startParam + ((source.endParam - source.startParam) * i) / 12;
          const local = { x: source.majorRadius * Math.cos(t), y: source.minorRadius * Math.sin(t) };
          const p = applyAffine(matrix, { x: source.center.x + local.x * cosR - local.y * sinR, y: source.center.y + local.x * sinR + local.y * cosR });
          const dx = p.x - moved.center.x;
          const dy = p.y - moved.center.y;
          const u = (dx * cosM + dy * sinM) / moved.majorRadius;
          const v = (-dx * sinM + dy * cosM) / moved.minorRadius;
          expect(Math.hypot(u, v)).toBeCloseTo(1, 7); // 楕円の上
          expect(inSweep(Math.atan2(v, u), moved.startParam, sweep, 1e-7)).toBe(true); // 範囲の中
        }
      });

      it("TEXT: the insertion point moves and the height scales; the text itself is never mirrored (rotation unchanged when mirroring)", () => {
        const moved = transformEntityGeometry(text, matrix) as typeof text & { position: Point2D; height: number; rotation: number };
        close(moved.position, applyAffine(matrix, { x: 15, y: 25 }));
        expect(moved.height).toBeCloseTo(5 * factor, 9);
        if (reflecting) expect(moved.rotation).toBe(0.2);
        else expect(angleDiff(moved.rotation, 0.2 + Math.atan2(matrix[1], matrix[0]))).toBeLessThan(1e-9);
        expect(moved.text).toBe("ABC");
      });
    });
  }

  it("a pure scale leaves angles untouched (no rounding change) and keeps ids, layer, color and extra fields", () => {
    const m = scaleMatrix({ x: 3, y: 3 }, 2);
    const moved = transformEntityGeometry({ ...arc, lineWeight: 50, sourceRecord: { id: "e9", matrix: [1, 0, 0, 1, 0, 0] } } as CadEntity, m) as typeof arc & { startAngle: number; endAngle: number };
    expect(moved.startAngle).toBe(0.3);
    expect(moved.endAngle).toBe(2.4);
    expect(moved).toMatchObject({ id: "arc", layer: "A", color: "#ffffff", lineWeight: 50 });
    const ell = transformEntityGeometry(ellipse, m) as typeof ellipse & { rotation: number; startParam: number; endParam: number };
    expect(ell.rotation).toBe(0.5);
    expect(ell.startParam).toBe(0.4);
  });

  it("mirroring twice with the same line gives the original back, for every type", () => {
    const m = reflectionMatrix({ x: -3, y: 4 }, { x: 40, y: 31 })!;
    for (const entity of [line, polyline, circle, arc, ellipse, spline, point, text]) {
      const back = transformEntityGeometry(transformEntityGeometry(entity, m), m) as unknown as Record<string, unknown>;
      const original = entity as unknown as Record<string, unknown>;
      const compare = (a: unknown, b: unknown, path: string): void => {
        if (typeof a === "number" && typeof b === "number") {
          // 角度は、2π の差を無視する
          const isAngle = /(Angle|rotation|Param)$/.test(path);
          const diff = isAngle ? angleDiff(a, b) : Math.abs(a - b);
          expect(diff, `${entity.id}.${path}`).toBeLessThan(1e-7);
        } else if (Array.isArray(a) && Array.isArray(b)) a.forEach((item, i) => compare(item, b[i], `${path}[${i}]`));
        else if (a !== null && typeof a === "object" && b !== null) for (const key of Object.keys(a as object)) compare((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], key);
        else expect(a, `${entity.id}.${path}`).toEqual(b);
      };
      for (const key of Object.keys(original)) compare(original[key], back[key], key);
    }
  });

  it("scale by f and then by 1/f gives the original back", () => {
    const around = { x: 12, y: -7 };
    for (const entity of [line, polyline, circle, arc, ellipse, spline, point, text]) {
      const there = transformEntityGeometry(entity, scaleMatrix(around, 3.5));
      const back = transformEntityGeometry(there, scaleMatrix(around, 1 / 3.5)) as unknown as Record<string, unknown>;
      expect(JSON.stringify(back, (_k, v) => (typeof v === "number" ? Math.round(v * 1e6) / 1e6 : v))).toBe(JSON.stringify(entity, (_k, v) => (typeof v === "number" ? Math.round(v * 1e6) / 1e6 : v)));
    }
  });

  it("a scale that overflows to a non-finite size is refused as a whole", () => {
    const huge: CadEntity = { ...base, id: "huge", type: "CIRCLE", center: { x: 0, y: 0 }, radius: 1e308 };
    expect(() => transformEntityGeometry(huge, scaleMatrix({ x: 0, y: 0 }, 10))).toThrow(/大きすぎ/);
    const far: CadEntity = { ...base, id: "far", type: "POINT", position: { x: 1e307, y: 0 } };
    expect(() => transformEntityGeometry(far, scaleMatrix({ x: 0, y: 0 }, 100))).toThrow(/大きすぎ/);
  });

  it("the move-and-rotate path is bit-for-bit what it was (the rigid fast path is untouched)", () => {
    const m = rotationMatrix({ x: 12, y: -7 }, 0.9);
    const moved = transformEntityGeometry(arc, m) as typeof arc & { startAngle: number; endAngle: number; center: Point2D };
    expect(moved.startAngle).toBe(((0.3 + Math.atan2(m[1], m[0])) % TWO_PI + TWO_PI) % TWO_PI);
    expect(moved.center).toEqual(applyAffine(m, { x: -20, y: 5 }));
  });
});
