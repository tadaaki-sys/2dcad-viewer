import { describe, expect, it } from "vitest";
import { normalizeDashPattern } from "./lineDash";

describe("normalizeDashPattern", () => {
  it("scales a simple dash/gap pattern", () => {
    expect(normalizeDashPattern([6.35, -3.175], 2)).toEqual([12.7, 6.35]);
  });

  it("keeps a multi-element pattern such as PHANTOM", () => {
    expect(normalizeDashPattern([31.75, -6.35, 6.35, -6.35], 1)).toEqual([31.75, 6.35, 6.35, 6.35]);
  });

  it("keeps a dot (zero-length dash) in a dash-dot pattern", () => {
    expect(normalizeDashPattern([12, -3, 0, -3], 1)).toEqual([12, 3, 0, 3]);
  });

  it("appends a zero gap when the pattern ends on a dash so the length stays even", () => {
    expect(normalizeDashPattern([5, -2, 0], 1)).toEqual([5, 2, 0, 0]);
  });

  it("merges consecutive dashes and consecutive gaps", () => {
    expect(normalizeDashPattern([2, 3, -1, -2], 1)).toEqual([5, 3]);
  });

  it("starts with a zero-length dash when the pattern begins with a gap", () => {
    expect(normalizeDashPattern([-3, 2, -1], 1)).toEqual([0, 3, 2, 1]);
  });

  it("returns null for solid or invalid patterns", () => {
    expect(normalizeDashPattern([], 1)).toBeNull();
    expect(normalizeDashPattern([5], 1)).toBeNull();
    expect(normalizeDashPattern([5, 0], 1)).toBeNull();
    expect(normalizeDashPattern([5, -2], 0)).toBeNull();
    expect(normalizeDashPattern([5, -2], -1)).toBeNull();
    expect(normalizeDashPattern([5, Number.NaN], 1)).toBeNull();
  });
});
