import { describe, expect, it } from "vitest";
import {
  IDENTITY_MATRIX,
  applyMatrix,
  buildInsertMatrix,
  multiplyMatrices,
  rotationMatrix,
  scaleMatrix,
  translationMatrix,
} from "./matrix2d";

function expectPointCloseTo(actual: { x: number; y: number }, expected: { x: number; y: number }) {
  expect(actual.x).toBeCloseTo(expected.x, 9);
  expect(actual.y).toBeCloseTo(expected.y, 9);
}

describe("matrix2d", () => {
  it("identity matrix leaves points unchanged", () => {
    expectPointCloseTo(applyMatrix({ x: 3, y: 4 }, IDENTITY_MATRIX), { x: 3, y: 4 });
  });

  it("translationMatrix shifts points", () => {
    expectPointCloseTo(applyMatrix({ x: 1, y: 2 }, translationMatrix(10, -5)), { x: 11, y: -3 });
  });

  it("scaleMatrix scales each axis independently", () => {
    expectPointCloseTo(applyMatrix({ x: 2, y: 3 }, scaleMatrix(2, 0.5)), { x: 4, y: 1.5 });
  });

  it("rotationMatrix rotates 90 degrees counter-clockwise", () => {
    expectPointCloseTo(applyMatrix({ x: 1, y: 0 }, rotationMatrix(Math.PI / 2)), { x: 0, y: 1 });
  });

  it("multiplyMatrices composes so the right-hand transform applies first", () => {
    const scaleThenTranslate = multiplyMatrices(translationMatrix(10, 0), scaleMatrix(2, 2));
    expectPointCloseTo(applyMatrix({ x: 1, y: 1 }, scaleThenTranslate), { x: 12, y: 2 });
  });

  it("buildInsertMatrix maps the block base point to the insert position", () => {
    const m = buildInsertMatrix({
      insertPosition: { x: 100, y: 200 },
      rotationRadians: 0,
      scaleX: 1,
      scaleY: 1,
      blockBasePoint: { x: 5, y: 5 },
    });
    expectPointCloseTo(applyMatrix({ x: 5, y: 5 }, m), { x: 100, y: 200 });
  });

  it("buildInsertMatrix applies scale and rotation around the block base point before translating", () => {
    const m = buildInsertMatrix({
      insertPosition: { x: 0, y: 0 },
      rotationRadians: Math.PI / 2,
      scaleX: 2,
      scaleY: 2,
      blockBasePoint: { x: 0, y: 0 },
    });
    // local (1,0) -> scaled (2,0) -> rotated 90deg -> (0,2) -> + insertPos(0,0)
    expectPointCloseTo(applyMatrix({ x: 1, y: 0 }, m), { x: 0, y: 2 });
  });
});
