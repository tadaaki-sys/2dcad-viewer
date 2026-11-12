import { describe, expect, it } from "vitest";
import { applyMatrix, multiplyMatrices, rotationMatrix, scaleMatrix } from "./matrix2d";
import type { Matrix2D } from "./matrix2d";
import { ellipseFromConjugateDiameters, isReflection, isSimilarityTransform, linearBasis } from "./ellipseTransform";
import { normalizeArcSpan, pointOnEllipse } from "./geometry";

describe("isSimilarityTransform / isReflection", () => {
  it("accepts rotation, uniform scale and mirror; rejects non-uniform scale and shear", () => {
    expect(isSimilarityTransform(scaleMatrix(2, 2))).toBe(true);
    expect(isSimilarityTransform(rotationMatrix(0.7))).toBe(true);
    expect(isSimilarityTransform(scaleMatrix(-2, 2))).toBe(true);
    expect(isSimilarityTransform(scaleMatrix(2, 1))).toBe(false);
    expect(isSimilarityTransform({ a: 1, b: 0, c: 0.5, d: 1, e: 0, f: 0 })).toBe(false);
    expect(isSimilarityTransform({ a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 })).toBe(false);
  });

  it("detects reflections by the sign of the determinant", () => {
    expect(isReflection(scaleMatrix(-1, 1))).toBe(true);
    expect(isReflection(scaleMatrix(1, -1))).toBe(true);
    expect(isReflection(scaleMatrix(-1, -1))).toBe(false);
    expect(isReflection(rotationMatrix(1))).toBe(false);
  });
});

/** 変換した円(半径r、パラメータ範囲[s,e])上の点を、ellipseFromConjugateDiametersの結果から再構成して比較する */
function expectSamePoints(m: Matrix2D, radius: number, start: number, end: number): void {
  const { lx, ly } = linearBasis(m);
  const result = ellipseFromConjugateDiameters({ x: radius * lx.x, y: radius * lx.y }, { x: radius * ly.x, y: radius * ly.y }, start, end);
  expect(result).not.toBeNull();
  const span = normalizeArcSpan(result!.startParam, result!.endParam);
  const originalSpan = normalizeArcSpan(start, end);
  expect(span).toBeCloseTo(originalSpan, 9);

  // 鏡像では同じ点の集合を逆向きにたどる(標準形は常にCCW)ので、再構成側は割合を反転して比べる
  const reversed = isReflection(m);
  for (let i = 0; i <= 8; i++) {
    const fraction = i / 8;
    const original = applyMatrix({ x: radius * Math.cos(start + originalSpan * fraction), y: radius * Math.sin(start + originalSpan * fraction) }, {
      ...m,
      e: 0,
      f: 0,
    });
    const rebuiltFraction = reversed ? 1 - fraction : fraction;
    const rebuilt = pointOnEllipse({ x: 0, y: 0 }, result!.majorRadius, result!.minorRadius, result!.rotation, result!.startParam + span * rebuiltFraction);
    expect(rebuilt.x).toBeCloseTo(original.x, 7);
    expect(rebuilt.y).toBeCloseTo(original.y, 7);
  }
}

describe("ellipseFromConjugateDiameters", () => {
  it("returns the same circle for an identity map", () => {
    const result = ellipseFromConjugateDiameters({ x: 5, y: 0 }, { x: 0, y: 5 }, 0, Math.PI * 2);
    expect(result!.majorRadius).toBeCloseTo(5, 9);
    expect(result!.minorRadius).toBeCloseTo(5, 9);
  });

  it("turns a circle under non-uniform scale into the matching ellipse", () => {
    const result = ellipseFromConjugateDiameters({ x: 10, y: 0 }, { x: 0, y: 5 }, 0, Math.PI * 2);
    expect(result!.majorRadius).toBeCloseTo(10, 9);
    expect(result!.minorRadius).toBeCloseTo(5, 9);
    expect(Math.cos(result!.rotation) ** 2).toBeCloseTo(1, 9);
  });

  it("reproduces the exact points of an arc under rotation, non-uniform scale, shear and mirroring", () => {
    const cases: Matrix2D[] = [
      rotationMatrix(0.6),
      scaleMatrix(2, 1),
      multiplyMatrices(rotationMatrix(0.5), scaleMatrix(3, 1.2)),
      { a: 1, b: 0, c: 0.7, d: 1, e: 0, f: 0 },
      scaleMatrix(-1, 1),
      scaleMatrix(1, -2),
      multiplyMatrices(rotationMatrix(1.1), scaleMatrix(-2.5, 1)),
    ];
    for (const m of cases) {
      expectSamePoints(m, 4, 0, Math.PI * 2);
      expectSamePoints(m, 4, 0.3, 1.9);
      expectSamePoints(m, 4, 5, 1); // 0度をまたぐ弧
    }
  });

  it("keeps the swept side of a mirrored arc (reflection reverses the parameter direction)", () => {
    // 上半分の弧(0〜180度)を上下反転すると、下半分になる
    const result = ellipseFromConjugateDiameters({ x: 10, y: 0 }, { x: 0, y: -10 }, 0, Math.PI);
    const span = normalizeArcSpan(result!.startParam, result!.endParam);
    const mid = pointOnEllipse({ x: 0, y: 0 }, result!.majorRadius, result!.minorRadius, result!.rotation, result!.startParam + span / 2);
    expect(mid.y).toBeCloseTo(-10, 7);
  });

  it("returns null for degenerate input", () => {
    expect(ellipseFromConjugateDiameters({ x: 0, y: 0 }, { x: 0, y: 0 }, 0, 1)).toBeNull();
    expect(ellipseFromConjugateDiameters({ x: Number.NaN, y: 0 }, { x: 0, y: 1 }, 0, 1)).toBeNull();
  });
});
