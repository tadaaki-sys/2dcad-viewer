import type { Point2D } from "../types/cad";

/** 2Dアフィン変換行列。x' = a*x + c*y + e, y' = b*x + d*y + f */
export type Matrix2D = {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
};

export const IDENTITY_MATRIX: Matrix2D = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/** m1とm2を合成する(m2を先に適用してからm1を適用するのと同じ変換になる) */
export function multiplyMatrices(m1: Matrix2D, m2: Matrix2D): Matrix2D {
  return {
    a: m1.a * m2.a + m1.c * m2.b,
    b: m1.b * m2.a + m1.d * m2.b,
    c: m1.a * m2.c + m1.c * m2.d,
    d: m1.b * m2.c + m1.d * m2.d,
    e: m1.a * m2.e + m1.c * m2.f + m1.e,
    f: m1.b * m2.e + m1.d * m2.f + m1.f,
  };
}

export function applyMatrix(point: Point2D, m: Matrix2D): Point2D {
  return {
    x: m.a * point.x + m.c * point.y + m.e,
    y: m.b * point.x + m.d * point.y + m.f,
  };
}

export function translationMatrix(x: number, y: number): Matrix2D {
  return { a: 1, b: 0, c: 0, d: 1, e: x, f: y };
}

export function scaleMatrix(scaleX: number, scaleY: number): Matrix2D {
  return { a: scaleX, b: 0, c: 0, d: scaleY, e: 0, f: 0 };
}

export function rotationMatrix(radians: number): Matrix2D {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
}

/**
 * DXFのINSERT(ブロック参照)1個分のローカル→ワールド変換行列を組み立てる。
 * 変換順序: ブロック基点を原点に戻す → スケール → 回転 → 挿入位置へ平行移動。
 */
export function buildInsertMatrix(params: {
  insertPosition: Point2D;
  rotationRadians: number;
  scaleX: number;
  scaleY: number;
  blockBasePoint: Point2D;
}): Matrix2D {
  const { insertPosition, rotationRadians, scaleX, scaleY, blockBasePoint } = params;
  let m = translationMatrix(-blockBasePoint.x, -blockBasePoint.y);
  m = multiplyMatrices(scaleMatrix(scaleX, scaleY), m);
  m = multiplyMatrices(rotationMatrix(rotationRadians), m);
  m = multiplyMatrices(translationMatrix(insertPosition.x, insertPosition.y), m);
  return m;
}
