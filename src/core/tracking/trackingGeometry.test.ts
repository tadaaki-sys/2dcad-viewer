import { describe, expect, it } from "vitest";
import type { Point2D } from "../../types/cad";
import { applyOrtho, normalizeDegrees, polarAngles, trackCursor } from "./trackingGeometry";
import type { TrackingParams } from "./trackingGeometry";
import { DEFAULT_TRACKING_SETTINGS } from "./trackingSettings";
import type { TrackingSettings } from "./trackingSettings";

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

const settings = (overrides: Partial<TrackingSettings>): TrackingSettings => ({ ...DEFAULT_TRACKING_SETTINGS, ...overrides });
const params = (overrides: Partial<TrackingParams> & { settings: TrackingSettings }): TrackingParams => ({
  base: { x: 0, y: 0 },
  acquired: [],
  toleranceWorld: 2,
  ...overrides,
});
const close = (p: Point2D, x: number, y: number, digits = 9) => {
  expect(p.x).toBeCloseTo(x, digits);
  expect(p.y).toBeCloseTo(y, digits);
};

describe("applyOrtho", () => {
  it("aligns to the axis the cursor is farther along; ties go horizontal; the same point stays", () => {
    const base = { x: 10, y: 20 };
    expect(applyOrtho(base, { x: 110, y: 23 })).toEqual({ x: 110, y: 20 });
    expect(applyOrtho(base, { x: 13, y: -80 })).toEqual({ x: 10, y: -80 });
    expect(applyOrtho(base, { x: -90, y: 120 })).toEqual({ x: -90, y: 20 }); // 縦横とも 100: 水平
    expect(applyOrtho(base, base)).toEqual(base);
    expect(applyOrtho({ x: 1e9, y: -1e9 }, { x: 1e9 + 5, y: -1e9 + 900 })).toEqual({ x: 1e9, y: -1e9 + 900 });
  });
});

describe("polarAngles / normalizeDegrees", () => {
  it("the multiples of the increment from 0 up to (not including) 360", () => {
    expect(polarAngles(90)).toEqual([0, 90, 180, 270]);
    expect(polarAngles(45)).toHaveLength(8);
    expect(polarAngles(22.5)).toHaveLength(16);
    expect(polarAngles(18)).toHaveLength(20);
    expect(polarAngles(5)).toHaveLength(72);
    for (const angle of polarAngles(5)) {
      expect(angle).toBeGreaterThanOrEqual(0);
      expect(angle).toBeLessThan(360);
    }
  });

  it("normalizeDegrees", () => {
    expect(normalizeDegrees(-90)).toBe(270);
    expect(normalizeDegrees(360)).toBe(0);
    expect(normalizeDegrees(725)).toBe(5);
    expect(normalizeDegrees(-1e-18)).toBeLessThan(360);
  });
});

describe("nothing to do", () => {
  it("all off, OTRACK without an acquired point, ORTHO or POLAR without a base point: null", () => {
    expect(trackCursor({ x: 50, y: 1 }, params({ settings: settings({}) }))).toBeNull();
    expect(trackCursor({ x: 50, y: 1 }, params({ settings: settings({ objectTracking: true }) }))).toBeNull();
    expect(trackCursor({ x: 50, y: 1 }, params({ base: null, settings: settings({ ortho: true }) }))).toBeNull();
    expect(trackCursor({ x: 50, y: 1 }, params({ base: null, settings: settings({ polar: true }) }))).toBeNull();
  });
});

describe("ORTHO", () => {
  it("always returns the point aligned to the axis, with no guide and no label", () => {
    const result = trackCursor({ x: 80, y: 9 }, params({ settings: settings({ ortho: true }) }));
    expect(result).toEqual({ point: { x: 80, y: 0 }, guides: [], label: null });
    expect(trackCursor({ x: 3, y: -70 }, params({ settings: settings({ ortho: true }) }))?.point).toEqual({ x: 0, y: -70 });
  });

  it("ORTHO wins over POLAR when both are (wrongly) on", () => {
    const result = trackCursor({ x: 70.7, y: 70 }, params({ settings: settings({ ortho: true, polar: true }) }));
    expect(result?.point).toEqual({ x: 70.7, y: 0 });
  });

  it("an acquired point's vertical line crossing the axis: the point snaps to the crossing", () => {
    const result = trackCursor({ x: 49.2, y: 1 }, params({ settings: settings({ ortho: true, objectTracking: true }), acquired: [{ x: 50, y: 30 }] }));
    close(result!.point, 50, 0);
    expect(result!.guides.map((g) => g.kind)).toEqual(["object"]);
    // 交点から遠い(許容距離の外)ときは、軸の上のまま
    expect(trackCursor({ x: 60, y: 1 }, params({ settings: settings({ ortho: true, objectTracking: true }), acquired: [{ x: 50, y: 30 }] }))?.point).toEqual({ x: 60, y: 0 });
  });
});

describe("POLAR", () => {
  const polar = (angle: number, extra: Partial<TrackingSettings> = {}) => settings({ polar: true, polarAngleIncrement: angle, ...extra });

  it("aligns to a ray of the increment when the cursor is within the tolerance of it", () => {
    const horizontal = trackCursor({ x: 100, y: 1 }, params({ settings: polar(45) }));
    close(horizontal!.point, 100, 0);
    expect(horizontal!.label).toBe("0°");
    expect(horizontal!.guides).toEqual([{ kind: "polar", origin: { x: 0, y: 0 }, angleDeg: 0, oneSided: true }]);

    const diagonal = trackCursor({ x: 70.7, y: 71.4 }, params({ settings: polar(45) }));
    expect(diagonal!.label).toBe("45°");
    // 揃えた点は、45度の線の上(x と y が等しい)
    expect(diagonal!.point.x).toBeCloseTo(diagonal!.point.y, 9);
  });

  it("not within the tolerance, or too close to the base point: null", () => {
    expect(trackCursor({ x: 100, y: 10 }, params({ settings: polar(45) }))).toBeNull();
    expect(trackCursor({ x: 1, y: 0.5 }, params({ settings: polar(45) }))).toBeNull(); // 基準点から許容距離(2)以内
  });

  it("rays go one way only (the opposite side is another ray of the increment)", () => {
    const result = trackCursor({ x: -100, y: 1 }, params({ settings: polar(90) }));
    expect(result!.label).toBe("180°");
    close(result!.point, -100, 0);
    // 90度の刻みには、45度の方向は無い
    expect(trackCursor({ x: 70.7, y: 71 }, params({ settings: polar(90) }))).toBeNull();
  });

  it("the label for decimals and the increments of 22.5 and 18", () => {
    expect(trackCursor({ x: 92.4, y: 38.2 }, params({ settings: polar(22.5), toleranceWorld: 3 }))?.label).toBe("22.5°");
    expect(trackCursor({ x: 95, y: 30.9 }, params({ settings: polar(18), toleranceWorld: 3 }))?.label).toBe("18°");
  });

  it("with a distance increment the length is rounded to a multiple (but not down to 0)", () => {
    const stepped = trackCursor({ x: 103, y: 1 }, params({ settings: polar(45, { distanceIncrement: 10 }) }));
    close(stepped!.point, 100, 0);
    const diagonal = trackCursor({ x: 73, y: 72 }, params({ settings: polar(45, { distanceIncrement: 10 }) }));
    const length = Math.hypot(diagonal!.point.x, diagonal!.point.y);
    expect(length).toBeCloseTo(100, 9);
    expect(diagonal!.point.x).toBeCloseTo(diagonal!.point.y, 9);
    // 間隔の半分より短いときは、0 にならない(その場の位置のまま)
    const short = trackCursor({ x: 3, y: 0.2 }, params({ settings: polar(45, { distanceIncrement: 10 }), toleranceWorld: 1.5 }));
    close(short!.point, 3, 0);
  });

  it("random: the result is on the ray, at the angle of the increment, within the tolerance of the cursor", () => {
    const rand = mulberry32(14);
    for (let n = 0; n < 400; n++) {
      const increment = [5, 10, 15, 18, 22.5, 30, 45, 90][n % 8];
      const base = { x: (rand() - 0.5) * 1e4, y: (rand() - 0.5) * 1e4 };
      const step = Math.floor(rand() * (360 / increment));
      const angle = (step * increment * Math.PI) / 180;
      const length = 10 + rand() * 1e3;
      const offset = (rand() - 0.5) * 3; // 許容距離(2)の中の、横のずれ
      const cursor = {
        x: base.x + Math.cos(angle) * length - Math.sin(angle) * offset,
        y: base.y + Math.sin(angle) * length + Math.cos(angle) * offset,
      };
      const result = trackCursor(cursor, params({ base, settings: polar(increment), toleranceWorld: 2 }));
      expect(result, `case ${n}`).not.toBeNull();
      // 結果は、基準点から、その角度の方向にある
      const dx = result!.point.x - base.x;
      const dy = result!.point.y - base.y;
      expect(Math.abs(dx * Math.sin(angle) - dy * Math.cos(angle))).toBeLessThan(1e-6);
      expect(dx * Math.cos(angle) + dy * Math.sin(angle)).toBeGreaterThan(0);
      expect(Math.hypot(result!.point.x - cursor.x, result!.point.y - cursor.y)).toBeLessThanOrEqual(2 + 1e-9);
    }
  });
});

describe("OTRACK", () => {
  const otrack = (extra: Partial<TrackingSettings> = {}) => settings({ objectTracking: true, ...extra });

  it("aligns to the vertical and horizontal lines through an acquired point (no base point needed)", () => {
    const acquired = [{ x: 10, y: 20 }];
    const vertical = trackCursor({ x: 10.5, y: 80 }, params({ base: null, settings: otrack(), acquired }));
    close(vertical!.point, 10, 80);
    expect(vertical!.guides).toEqual([{ kind: "object", origin: { x: 10, y: 20 }, angleDeg: 90, oneSided: false }]);
    expect(vertical!.label).toBeNull();
    const horizontal = trackCursor({ x: -60, y: 19.4 }, params({ base: null, settings: otrack(), acquired }));
    close(horizontal!.point, -60, 20); // 取得した点の、反対側(左)にも延びる
    expect(trackCursor({ x: 40, y: 50 }, params({ base: null, settings: otrack(), acquired }))).toBeNull();
  });

  it("two acquired points: near both lines the point snaps to their crossing; parallel lines do not cross", () => {
    const acquired = [
      { x: 10, y: 20 },
      { x: 60, y: 90 },
    ];
    const crossing = trackCursor({ x: 10.4, y: 90.3 }, params({ base: null, settings: otrack(), acquired }));
    close(crossing!.point, 10, 90);
    expect(crossing!.guides).toHaveLength(2);
    const parallel = trackCursor(
      { x: 10.4, y: 300 },
      params({ base: null, settings: otrack(), acquired: [{ x: 10, y: 20 }, { x: 10, y: 50 }] }),
    );
    close(parallel!.point, 10, 300); // 平行な2本: 交点は無いので、1本に揃う
  });

  it("with POLAR on the lines through an acquired point follow the angle increment", () => {
    const result = trackCursor({ x: 70.3, y: 70.9 }, params({ base: null, settings: otrack({ polar: true, polarAngleIncrement: 45 }), acquired: [{ x: 0, y: 0 }] }));
    // 基準点が無いので、極トラッキングの半直線は無いが、取得した点からの 45 度の線には揃う
    expect(result).not.toBeNull();
    expect(result!.point.x).toBeCloseTo(result!.point.y, 9);
  });

  it("a polar ray and an acquired point's vertical line crossing: snaps to the crossing and keeps the angle label", () => {
    // 基準点 (0,0) の 45 度の線と、取得した点 (100, 0) からの垂直な線は、(100, 100) で交わる
    const result = trackCursor(
      { x: 100.5, y: 99.4 },
      params({ settings: settings({ polar: true, objectTracking: true, polarAngleIncrement: 45 }), acquired: [{ x: 100, y: 0 }], toleranceWorld: 2 }),
    );
    close(result!.point, 100, 100);
    expect(result!.label).toBe("45°");
    expect(result!.guides.map((g) => g.kind).sort()).toEqual(["object", "polar"]);
  });
});
