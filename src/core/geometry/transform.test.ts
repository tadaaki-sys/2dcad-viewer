import { describe, expect, it } from "vitest";
import type { CadEntity, Point2D } from "../../types/cad";
import { getEntityPoints } from "./entityGeometry";
import {
  applyAffine,
  composeAffine,
  exactCosSin,
  IDENTITY_MATRIX,
  isIdentity,
  isRigid,
  rotationAngleOf,
  rotationMatrix,
  transformEntityGeometry,
  translationMatrix,
} from "./transform";

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const base = { layer: "A", color: "#ffffff" };

const SAMPLES: CadEntity[] = [
  { ...base, id: "line", type: "LINE", start: { x: 10, y: 20 }, end: { x: 110, y: -40 } },
  { ...base, id: "pl", type: "LWPOLYLINE", vertices: [{ x: 0, y: 0 }, { x: 50, y: 10 }, { x: 80, y: 70 }], closed: true },
  { ...base, id: "circle", type: "CIRCLE", center: { x: 30, y: 40 }, radius: 25 },
  { ...base, id: "arc", type: "ARC", center: { x: -20, y: 5 }, radius: 40, startAngle: 0.3, endAngle: 2.4 },
  { ...base, id: "ellipse", type: "ELLIPSE", center: { x: 5, y: 6 }, majorRadius: 30, minorRadius: 12, rotation: 0.5, startParam: 0, endParam: Math.PI * 2 },
  { ...base, id: "spline", type: "SPLINE", points: [{ x: 0, y: 0 }, { x: 10, y: 15 }, { x: 25, y: -5 }, { x: 40, y: 10 }], closed: false },
  { ...base, id: "point", type: "POINT", position: { x: 7, y: -3 } },
  { ...base, id: "text", type: "TEXT", position: { x: 15, y: 25 }, text: "ABC", height: 5, rotation: 0.2, horizontalAlign: "left", verticalAlign: "baseline" },
];

const close = (p: Point2D, q: Point2D, tolerance = 1e-9) => {
  expect(Math.abs(p.x - q.x)).toBeLessThan(tolerance);
  expect(Math.abs(p.y - q.y)).toBeLessThan(tolerance);
};

describe("matrices", () => {
  it("translation and rotation move points as expected", () => {
    expect(applyAffine(translationMatrix(5, -3), { x: 1, y: 2 })).toEqual({ x: 6, y: -1 });
    close(applyAffine(rotationMatrix({ x: 10, y: 10 }, Math.PI / 2), { x: 20, y: 10 }), { x: 10, y: 20 });
    close(applyAffine(rotationMatrix({ x: 0, y: 0 }, Math.PI / 6), { x: 1, y: 0 }), { x: Math.cos(Math.PI / 6), y: Math.sin(Math.PI / 6) });
  });

  it("a rotation by a multiple of 90 degrees is exact (no 6e-17 left over)", () => {
    expect(exactCosSin(Math.PI / 2)).toEqual({ cos: 0, sin: 1 });
    expect(exactCosSin(Math.PI)).toEqual({ cos: -1, sin: 0 });
    expect(exactCosSin(-Math.PI / 2)).toEqual({ cos: 0, sin: -1 });
    expect(exactCosSin(3 * Math.PI)).toEqual({ cos: -1, sin: 0 });
    expect(exactCosSin(0)).toEqual({ cos: 1, sin: 0 });
    // 数値で打った 90 度(度→ラジアン)も、正確
    expect(exactCosSin((90 * Math.PI) / 180)).toEqual({ cos: 0, sin: 1 });
    expect(applyAffine(rotationMatrix({ x: 0, y: 0 }, Math.PI / 2), { x: 100, y: 0 })).toEqual({ x: 0, y: 100 });
    expect(applyAffine(rotationMatrix({ x: 50, y: 50 }, Math.PI), { x: 100, y: 50 })).toEqual({ x: 0, y: 50 });
    // 90度の倍数でない角は、普通に計算する
    expect(exactCosSin(0.5).cos).toBeCloseTo(Math.cos(0.5), 15);
  });

  it("compose applies the first change and then the second; the identity does nothing", () => {
    const move = translationMatrix(10, 0);
    const turn = rotationMatrix({ x: 0, y: 0 }, Math.PI / 2);
    // (1,0) を、移動して (11,0)、回転して (0,11)
    close(applyAffine(composeAffine(move, turn), { x: 1, y: 0 }), { x: 0, y: 11 });
    // 逆の順: 回転して (0,1)、移動して (10,1)
    close(applyAffine(composeAffine(turn, move), { x: 1, y: 0 }), { x: 10, y: 1 });
    expect(composeAffine(IDENTITY_MATRIX, move)).toEqual(move);
    expect(composeAffine(move, IDENTITY_MATRIX)).toEqual(move);
    expect(isIdentity(IDENTITY_MATRIX)).toBe(true);
    expect(isIdentity(move)).toBe(false);
  });

  it("composition is associative (random rigid motions)", () => {
    const rand = mulberry32(1);
    const random = () => composeAffine(rotationMatrix({ x: rand() * 100, y: rand() * 100 }, rand() * 6.28), translationMatrix(rand() * 50, rand() * 50));
    for (let n = 0; n < 100; n++) {
      const [a, b, c] = [random(), random(), random()];
      const left = composeAffine(composeAffine(a, b), c);
      const right = composeAffine(a, composeAffine(b, c));
      for (let i = 0; i < 6; i++) expect(Math.abs(left[i] - right[i])).toBeLessThan(1e-9);
    }
  });

  it("isRigid accepts moves and rotations, and refuses scaling, mirroring and shearing", () => {
    expect(isRigid(translationMatrix(3, 4))).toBe(true);
    expect(isRigid(rotationMatrix({ x: 5, y: 5 }, 1.1))).toBe(true);
    expect(isRigid([2, 0, 0, 2, 0, 0])).toBe(false); // 拡大
    expect(isRigid([1, 0, 0, -1, 0, 0])).toBe(false); // 鏡像
    expect(isRigid([1, 0, 0.5, 1, 0, 0])).toBe(false); // せん断
    expect(isRigid([Number.NaN, 0, 0, 1, 0, 0])).toBe(false);
    expect(rotationAngleOf(rotationMatrix({ x: 0, y: 0 }, 0.7))).toBeCloseTo(0.7, 12);
  });
});

describe("transformEntityGeometry", () => {
  it("a move shifts every coordinate and keeps everything else (id, layer, color, dash, extra fields)", () => {
    const withExtras = { ...SAMPLES[0], lineWeight: 50, sourceRecord: { id: "e9", matrix: IDENTITY_MATRIX } } as CadEntity;
    const moved = transformEntityGeometry(withExtras, translationMatrix(100, 200));
    expect(moved).toEqual({ ...withExtras, start: { x: 110, y: 220 }, end: { x: 210, y: 160 } });
    // 元の図形は、変わらない
    expect((withExtras as { start: Point2D }).start).toEqual({ x: 10, y: 20 });
  });

  it("a pure move leaves angles untouched (not even a rounding change)", () => {
    const arc = SAMPLES[3];
    const moved = transformEntityGeometry(arc, translationMatrix(0.1, 0.2)) as typeof arc & { startAngle: number; endAngle: number };
    expect(moved.startAngle).toBe(0.3);
    expect(moved.endAngle).toBe(2.4);
    const text = SAMPLES[7];
    expect((transformEntityGeometry(text, translationMatrix(1, 1)) as { rotation: number }).rotation).toBe(0.2);
  });

  it("each type: the rotated shape is the original points rotated (checked through the outline points)", () => {
    const matrix = rotationMatrix({ x: 12, y: -7 }, 0.9);
    for (const entity of SAMPLES) {
      if (entity.type === "TEXT") continue; // 文字は、別に確かめる
      if (entity.type === "CIRCLE") continue; // 円は、角度の起点が無い(近似の頂点が 0° から始まる)ので、中心と半径で確かめる
      const rotated = transformEntityGeometry(entity, matrix);
      const before = getEntityPoints(entity);
      const after = getEntityPoints(rotated);
      expect(after.length, entity.id).toBe(before.length);
      before.forEach((p, i) => close(applyAffine(matrix, p), after[i], 1e-9));
    }
  });

  it("a circle: the center is rotated and the radius is kept", () => {
    const circle = SAMPLES[2] as CadEntity & { center: Point2D; radius: number };
    const matrix = rotationMatrix({ x: 12, y: -7 }, 0.9);
    const rotated = transformEntityGeometry(circle, matrix) as typeof circle;
    close(rotated.center, applyAffine(matrix, circle.center));
    expect(rotated.radius).toBe(25);
  });

  it("text: the position moves and the rotation angle adds up (in 0 - 2π)", () => {
    const text = SAMPLES[7];
    const rotated = transformEntityGeometry(text, rotationMatrix({ x: 0, y: 0 }, Math.PI / 2)) as typeof text & { rotation: number; position: Point2D };
    expect(rotated.position).toEqual({ x: -25, y: 15 });
    expect(rotated.rotation).toBeCloseTo(0.2 + Math.PI / 2, 12);
    const wrapped = transformEntityGeometry(text, rotationMatrix({ x: 0, y: 0 }, 6.2)) as typeof text & { rotation: number };
    expect(wrapped.rotation).toBeGreaterThanOrEqual(0);
    expect(wrapped.rotation).toBeLessThan(Math.PI * 2);
  });

  it("an arc keeps its sweep when rotated (also across 0 degrees), and an ellipse keeps its parameters", () => {
    const arc = SAMPLES[3] as { startAngle: number; endAngle: number } & CadEntity;
    const rotated = transformEntityGeometry(arc, rotationMatrix({ x: 0, y: 0 }, 5.5)) as typeof arc;
    const span = (s: number, e: number) => (((e - s) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    expect(span(rotated.startAngle, rotated.endAngle)).toBeCloseTo(span(arc.startAngle, arc.endAngle), 12);
    const ellipse = SAMPLES[4] as CadEntity & { startParam: number; endParam: number; majorRadius: number };
    const turned = transformEntityGeometry(ellipse, rotationMatrix({ x: 0, y: 0 }, 1)) as typeof ellipse;
    expect(turned.startParam).toBe(ellipse.startParam);
    expect(turned.endParam).toBe(ellipse.endParam);
    expect(turned.majorRadius).toBe(ellipse.majorRadius);
  });

  it("rotating and then rotating back gives the original shape, for every type (random)", () => {
    const rand = mulberry32(9);
    for (let n = 0; n < 200; n++) {
      const entity = SAMPLES[n % SAMPLES.length];
      const center = { x: (rand() - 0.5) * 1e4, y: (rand() - 0.5) * 1e4 };
      const angle = rand() * 6.2;
      const there = transformEntityGeometry(entity, rotationMatrix(center, angle));
      const back = transformEntityGeometry(there, rotationMatrix(center, -angle));
      // 円・円弧・楕円は、近似の頂点が同じ位置から始まるので、そのまま比べられる(円は、回して戻すと、同じ位置に戻る)
      const original = getEntityPoints(entity);
      const result = getEntityPoints(back);
      original.forEach((p, i) => close(p, result[i], 1e-7));
    }
  });

  it("moving and moving back is exact for integer coordinates", () => {
    for (const entity of SAMPLES) {
      const back = transformEntityGeometry(transformEntityGeometry(entity, translationMatrix(1234, -5678)), translationMatrix(-1234, 5678));
      expect(back).toEqual(entity);
    }
  });

  it("a rotation by 90 degrees of integer coordinates stays integer (no rounding noise)", () => {
    const line = SAMPLES[0];
    const rotated = transformEntityGeometry(line, rotationMatrix({ x: 0, y: 0 }, Math.PI / 2)) as typeof line & { start: Point2D; end: Point2D };
    expect(rotated.start).toEqual({ x: -20, y: 10 });
    expect(rotated.end).toEqual({ x: 40, y: 110 });
  });

  it("keeps the extra values of polyline vertices (such as a bulge)", () => {
    const polyline = { ...base, id: "pb", type: "LWPOLYLINE", vertices: [{ x: 0, y: 0, bulge: 0.5 }, { x: 10, y: 0 }], closed: false } as unknown as CadEntity;
    const moved = transformEntityGeometry(polyline, translationMatrix(5, 5)) as unknown as { vertices: Array<Point2D & { bulge?: number }> };
    expect(moved.vertices[0]).toEqual({ x: 5, y: 5, bulge: 0.5 });
  });

  it("refuses a transform that is not a move or a rotation", () => {
    expect(() => transformEntityGeometry(SAMPLES[0], [2, 0, 0, 2, 0, 0])).toThrow();
    expect(() => transformEntityGeometry(SAMPLES[0], [1, 0, 0, -1, 0, 0])).toThrow();
  });
});

describe("overflow and huge angles", () => {
  it("a finite coordinate that would overflow makes the whole transform throw; broken (non-finite) input is passed through as before", () => {
    const point: CadEntity = { ...base, id: "p", type: "POINT", position: { x: 1e308, y: 0 } };
    expect(() => transformEntityGeometry(point, translationMatrix(1e308, 0))).toThrow(/大きすぎ/);
    const broken: CadEntity = { ...base, id: "q", type: "POINT", position: { x: Number.NaN, y: 0 } };
    const moved = transformEntityGeometry(broken, translationMatrix(5, 5));
    expect(moved.type === "POINT" && Number.isNaN(moved.position.x)).toBe(true);
  });

  it("exactCosSin does not mistake a huge angle for a multiple of 90 degrees", () => {
    for (const angle of [1e20, -1e20, 1e15, 12345678.9]) {
      expect(exactCosSin(angle)).toEqual({ cos: Math.cos(angle), sin: Math.sin(angle) });
    }
    expect(exactCosSin(Math.PI)).toEqual({ cos: -1, sin: 0 });
    expect(exactCosSin(-Math.PI / 2)).toEqual({ cos: 0, sin: -1 });
  });
});
