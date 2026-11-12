import { describe, expect, it } from "vitest";
import { parseCoordinateInput } from "./coordinateInput";

const base = { x: 100, y: 200 };

function point(text: string, basePoint: { x: number; y: number } | null = base) {
  const result = parseCoordinateInput(text, basePoint);
  if (!result.ok || result.kind !== "point") throw new Error(`not a point: ${text} -> ${JSON.stringify(result)}`);
  return result.point;
}

describe("parseCoordinateInput: absolute", () => {
  it("reads X,Y", () => {
    expect(point("1000,500")).toEqual({ x: 1000, y: 500 });
    expect(point("-12.5,0.25")).toEqual({ x: -12.5, y: 0.25 });
    expect(point("+3,.5")).toEqual({ x: 3, y: 0.5 });
    expect(point("5.,6")).toEqual({ x: 5, y: 6 });
  });

  it("does not need a base point", () => {
    expect(point("1,2", null)).toEqual({ x: 1, y: 2 });
  });

  it("accepts full-width characters and spaces", () => {
    expect(point("１０００，５００")).toEqual({ x: 1000, y: 500 });
    expect(point(" 1000 , 500 ")).toEqual({ x: 1000, y: 500 });
    expect(point("１０００　,　−5")).toEqual({ x: 1000, y: -5 });
  });
});

describe("parseCoordinateInput: relative", () => {
  it("adds to the base point", () => {
    expect(point("@500,0")).toEqual({ x: 600, y: 200 });
    expect(point("@-100,-200")).toEqual({ x: 0, y: 0 });
    expect(point("＠５００，０")).toEqual({ x: 600, y: 200 });
  });

  it("needs a base point", () => {
    const result = parseCoordinateInput("@1,1", null);
    expect(result.ok).toBe(false);
  });
});

describe("parseCoordinateInput: polar", () => {
  it("reads length<angle from the origin, angle in degrees counter-clockwise from +X", () => {
    const p = point("1000<90", null);
    expect(p.x).toBeCloseTo(0, 9);
    expect(p.y).toBeCloseTo(1000, 9);
    const q = point("2<0", null);
    expect(q).toEqual({ x: 2, y: 0 });
  });

  it("reads @length<angle from the base point", () => {
    const p = point("@1000<30");
    expect(p.x).toBeCloseTo(100 + 1000 * Math.cos(Math.PI / 6), 9);
    expect(p.y).toBeCloseTo(200 + 500, 9);
    const r = point("＠１０＜１８０");
    expect(r.x).toBeCloseTo(90, 9);
    expect(r.y).toBeCloseTo(200, 9);
  });

  it("accepts negative lengths and angles", () => {
    const p = point("@10<-90");
    expect(p.x).toBeCloseTo(100, 9);
    expect(p.y).toBeCloseTo(190, 9);
  });
});

describe("parseCoordinateInput: distance", () => {
  it("reads a bare number as a distance", () => {
    expect(parseCoordinateInput("500", base)).toEqual({ ok: true, kind: "distance", value: 500 });
    expect(parseCoordinateInput(" -2.5 ", null)).toEqual({ ok: true, kind: "distance", value: -2.5 });
  });
});

describe("parseCoordinateInput: errors", () => {
  const bad = [
    "",
    "   ",
    "@",
    "@500",
    "@ ",
    "1,2,3",
    "1,",
    ",2",
    ",",
    "a,b",
    "1,b",
    "Infinity,1",
    "NaN",
    "Infinity",
    "1e3,2",
    "1e3",
    "1,2<3",
    "10<",
    "<30",
    "1<2<3",
    "10<x",
    "0x10,1",
    "--1,2",
    "1..2,3",
    "abc",
    "1,2 3",
    "1 2",
  ];
  for (const text of bad) {
    it(`rejects ${JSON.stringify(text)} with a reason`, () => {
      const result = parseCoordinateInput(text, base);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.length).toBeGreaterThan(0);
    });
  }

  it("rejects results that overflow even when every typed number is finite (Codex review)", () => {
    const big = "1" + "0".repeat(308); // 1e308: 数としては有限
    expect(parseCoordinateInput(`${big},0`, null).ok).toBe(true);
    // 相対座標の足し算で溢れる
    const relative = parseCoordinateInput(`@${big},0`, { x: Number(big), y: 0 });
    expect(relative.ok).toBe(false);
    if (!relative.ok) expect(relative.error).toContain("大きすぎ");
    // 極座標で、非常に大きな角度を度からラジアンへ変換して溢れる(以前はNaNになった)
    const polarAngle = parseCoordinateInput(`1<${big}`, null);
    expect(polarAngle.ok === true && polarAngle.kind === "point" && Number.isFinite(polarAngle.point.x) && Number.isFinite(polarAngle.point.y)).toBe(true);
    // 極座標の長さが大きく、基準点との足し算で溢れる
    expect(parseCoordinateInput(`@${big}<0`, { x: Number(big), y: 0 }).ok).toBe(false);
  });

  it("keeps big angles equivalent to their value modulo 360", () => {
    const a = parseCoordinateInput("10<450", null);
    const b = parseCoordinateInput("10<90", null);
    if (!a.ok || a.kind !== "point" || !b.ok || b.kind !== "point") throw new Error("not points");
    expect(a.point.x).toBeCloseTo(b.point.x, 9);
    expect(a.point.y).toBeCloseTo(b.point.y, 9);
    const c = parseCoordinateInput("10<-270", null);
    if (!c.ok || c.kind !== "point") throw new Error("not a point");
    expect(c.point.x).toBeCloseTo(0, 9);
    expect(c.point.y).toBeCloseTo(10, 9);
  });

  it("rejects numbers that overflow to Infinity", () => {
    const huge = "9".repeat(400);
    expect(parseCoordinateInput(`${huge},1`, base).ok).toBe(false);
    expect(parseCoordinateInput(huge, base).ok).toBe(false);
  });
});
