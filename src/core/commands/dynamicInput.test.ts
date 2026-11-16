import { describe, expect, it } from "vitest";
import type { ActiveCommand } from "./session";
import {
  dynamicModeOf,
  formatDynamicValue,
  inputFieldsOf,
  nextField,
  normalizeDegrees,
  parseFieldText,
  readoutAt,
  resolveDynamicPoint,
} from "./dynamicInput";

const active = (overrides: Partial<ActiveCommand> = {}): ActiveCommand => ({
  name: "LINE",
  prompt: "点を指示してください",
  expect: "point",
  keywords: [],
  acceptsEnter: true,
  hasPreview: true,
  hasPendingChanges: false,
  basePoint: null,
  acceptsDistance: false,
  ...overrides,
});

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

describe("dynamicModeOf", () => {
  it("no command, or a text step: not applicable", () => {
    expect(dynamicModeOf(null)).toBeNull();
    expect(dynamicModeOf(active({ expect: "text" }))).toBeNull();
  });

  it("a point step without a base point is absolute; with a base point it is polar", () => {
    expect(dynamicModeOf(active())).toBe("absolute");
    expect(dynamicModeOf(active({ basePoint: { x: 1, y: 2 } }))).toBe("polar");
  });

  it("a step that also takes a number (radius) and a distance step show only the length", () => {
    expect(dynamicModeOf(active({ basePoint: { x: 0, y: 0 }, acceptsDistance: true }))).toBe("distance");
    expect(dynamicModeOf(active({ expect: "distance", basePoint: { x: 0, y: 0 } }))).toBe("distance");
  });
});

describe("fields", () => {
  it("each mode has its own input fields, and Tab cycles through them", () => {
    expect(inputFieldsOf("absolute")).toEqual(["x", "y"]);
    expect(inputFieldsOf("polar")).toEqual(["length", "angle"]);
    expect(inputFieldsOf("distance")).toEqual(["length"]);
    expect(nextField("polar", "length", false)).toBe("angle");
    expect(nextField("polar", "angle", false)).toBe("length");
    expect(nextField("polar", "length", true)).toBe("angle");
    expect(nextField("absolute", "y", false)).toBe("x");
    expect(nextField("distance", "length", false)).toBe("length");
    // 現在の項目が、このモードに無いとき(モードが変わった直後)は、最初から数える
    expect(nextField("polar", "x", false)).toBe("angle");
  });
});

describe("parseFieldText", () => {
  it("reads plain numbers, including full-width characters", () => {
    expect(parseFieldText("length", "1500")).toEqual({ ok: true, value: 1500 });
    expect(parseFieldText("length", "１２５０．５")).toEqual({ ok: true, value: 1250.5 });
    expect(parseFieldText("x", "-30")).toEqual({ ok: true, value: -30 });
    expect(parseFieldText("y", "−30")).toEqual({ ok: true, value: -30 });
  });

  it("angles are folded into 0 - 360 degrees", () => {
    expect(parseFieldText("angle", "30")).toEqual({ ok: true, value: 30 });
    expect(parseFieldText("angle", "-90")).toEqual({ ok: true, value: 270 });
    expect(parseFieldText("angle", "390")).toEqual({ ok: true, value: 30 });
    expect(parseFieldText("angle", "360")).toEqual({ ok: true, value: 0 });
    expect(normalizeDegrees(-1e-18)).toBeLessThan(360);
  });

  it("refuses a negative length, and anything that is not a plain number", () => {
    expect(parseFieldText("length", "-5").ok).toBe(false);
    expect(parseFieldText("length", "0")).toEqual({ ok: true, value: 0 });
    for (const text of ["", "abc", "1e3", "1,2", "@5,0", "10<30", "1 2", "NaN", "Infinity"]) {
      expect(parseFieldText("length", text).ok, text).toBe(false);
    }
  });
});

describe("readoutAt", () => {
  it("without a base point only X and Y are known", () => {
    expect(readoutAt({ x: 5, y: -7 }, null)).toEqual({ x: 5, y: -7, length: null, angle: null });
  });

  it("with a base point: length and angle (counter-clockwise from +X, 0 - 360)", () => {
    const base = { x: 100, y: 100 };
    const up = readoutAt({ x: 100, y: 150 }, base);
    expect(up.length).toBeCloseTo(50, 12);
    expect(up.angle).toBeCloseTo(90, 12);
    expect(readoutAt({ x: 100, y: 50 }, base).angle).toBeCloseTo(270, 12);
    expect(readoutAt({ x: 150, y: 100 }, base).angle).toBeCloseTo(0, 12);
    // 同じ点: 長さ0、向きは0度とする
    expect(readoutAt(base, base)).toEqual({ x: 100, y: 100, length: 0, angle: 0 });
  });
});

describe("resolveDynamicPoint", () => {
  const base = { x: 1000, y: 500 };
  const cursor = { x: 1000, y: 600 }; // 基準点の真上(90度)、長さ100

  it("polar: length and angle typed -> a point from the base", () => {
    const result = resolveDynamicPoint("polar", base, cursor, { length: 1500, angle: 30 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.point.x).toBeCloseTo(1000 + 1500 * Math.cos(Math.PI / 6), 9);
    expect(result.point.y).toBeCloseTo(500 + 1500 * Math.sin(Math.PI / 6), 9);
  });

  it("polar: only the length typed keeps the direction of the cursor; only the angle typed keeps its length", () => {
    const lengthOnly = resolveDynamicPoint("polar", base, cursor, { length: 250 });
    expect(lengthOnly.ok && lengthOnly.point.x).toBeCloseTo(1000, 9);
    expect(lengthOnly.ok && lengthOnly.point.y).toBeCloseTo(750, 9);
    const angleOnly = resolveDynamicPoint("polar", base, cursor, { angle: 0 });
    expect(angleOnly.ok && angleOnly.point.x).toBeCloseTo(1100, 9);
    expect(angleOnly.ok && angleOnly.point.y).toBeCloseTo(500, 9);
  });

  it("polar: nothing typed gives the cursor itself (up to rounding)", () => {
    const result = resolveDynamicPoint("polar", base, { x: 1234.5, y: 321.25 }, {});
    expect(result.ok && result.point.x).toBeCloseTo(1234.5, 9);
    expect(result.ok && result.point.y).toBeCloseTo(321.25, 9);
  });

  it("absolute: typed X and Y; an untyped one follows the cursor", () => {
    expect(resolveDynamicPoint("absolute", null, cursor, { x: 10, y: 20 })).toEqual({ ok: true, point: { x: 10, y: 20 } });
    expect(resolveDynamicPoint("absolute", null, cursor, { x: 10 })).toEqual({ ok: true, point: { x: 10, y: 600 } });
    expect(resolveDynamicPoint("absolute", null, cursor, { y: -5 })).toEqual({ ok: true, point: { x: 1000, y: -5 } });
  });

  it("distance: the typed length goes in the direction of the cursor; without a cursor the direction is 0 degrees", () => {
    const withCursor = resolveDynamicPoint("distance", base, cursor, { length: 40 });
    expect(withCursor.ok && withCursor.point.y).toBeCloseTo(540, 9);
    const withoutCursor = resolveDynamicPoint("distance", base, null, { length: 40 });
    expect(withoutCursor).toEqual({ ok: true, point: { x: 1040, y: 500 } });
  });

  it("without a cursor, a value that is not typed cannot be filled in", () => {
    expect(resolveDynamicPoint("absolute", null, null, { x: 1 }).ok).toBe(false);
    expect(resolveDynamicPoint("polar", base, null, { length: 1 }).ok).toBe(false);
    expect(resolveDynamicPoint("polar", base, null, { angle: 1 }).ok).toBe(false);
    expect(resolveDynamicPoint("polar", base, null, { length: 5, angle: 90 }).ok).toBe(true);
  });

  it("refuses a missing base point and a result that is not finite", () => {
    expect(resolveDynamicPoint("polar", null, cursor, { length: 1, angle: 0 }).ok).toBe(false);
    expect(resolveDynamicPoint("polar", base, cursor, { length: Number.MAX_VALUE, angle: 0 }).ok).toBe(true);
    expect(resolveDynamicPoint("polar", { x: Number.MAX_VALUE, y: 0 }, cursor, { length: Number.MAX_VALUE, angle: 0 }).ok).toBe(false);
  });

  it("round trip: a point read as length and angle resolves back to the same point", () => {
    const rand = mulberry32(21);
    for (let n = 0; n < 500; n++) {
      const origin = { x: (rand() - 0.5) * 1e5, y: (rand() - 0.5) * 1e5 };
      const target = { x: origin.x + (rand() - 0.5) * 1e4, y: origin.y + (rand() - 0.5) * 1e4 };
      const read = readoutAt(target, origin);
      const resolved = resolveDynamicPoint("polar", origin, null, { length: read.length!, angle: read.angle! });
      expect(resolved.ok).toBe(true);
      if (!resolved.ok) continue;
      expect(Math.abs(resolved.point.x - target.x)).toBeLessThan(1e-6);
      expect(Math.abs(resolved.point.y - target.y)).toBeLessThan(1e-6);
    }
  });
});

describe("formatDynamicValue", () => {
  it("one decimal, never -0.0, angles with a degree sign; the values themselves are not rounded", () => {
    expect(formatDynamicValue("length", 1250.54)).toBe("1250.5");
    expect(formatDynamicValue("x", -0.04)).toBe("0.0");
    expect(formatDynamicValue("angle", 30)).toBe("30.0°");
    expect(formatDynamicValue("angle", 359.96)).toBe("360.0°");
    const unrounded = 1250.54;
    formatDynamicValue("length", unrounded);
    expect(unrounded).toBe(1250.54);
  });
});
