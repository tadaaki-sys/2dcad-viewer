import { describe, expect, it } from "vitest";
import {
  DEFAULT_TRACKING_SETTINGS,
  isValidAngleIncrement,
  isValidDistanceIncrement,
  MIN_DISTANCE_INCREMENT,
  normalizeTrackingSettings,
  parseDistanceIncrement,
  POLAR_ANGLE_INCREMENTS,
  toggleTracking,
} from "./trackingSettings";

describe("defaults", () => {
  it("all three are off, 45 degrees, no distance increment (the operation does not change by default)", () => {
    expect(DEFAULT_TRACKING_SETTINGS).toEqual({ ortho: false, polar: false, objectTracking: false, polarAngleIncrement: 45, distanceIncrement: 0 });
  });

  it("the selectable angle increments", () => {
    expect([...POLAR_ANGLE_INCREMENTS]).toEqual([5, 10, 15, 18, 22.5, 30, 45, 90]);
    for (const value of POLAR_ANGLE_INCREMENTS) expect(isValidAngleIncrement(value)).toBe(true);
    for (const bad of [0, 7, -45, 45.5, "45", Number.NaN]) expect(isValidAngleIncrement(bad)).toBe(false);
  });
});

describe("toggleTracking: ORTHO and POLAR are exclusive", () => {
  it("turning one on turns the other off, and says so", () => {
    const withPolar = toggleTracking(DEFAULT_TRACKING_SETTINGS, "polar");
    expect(withPolar.settings.polar).toBe(true);
    expect(withPolar.message).toBe("POLAR(極トラッキング): オン");

    const toOrtho = toggleTracking(withPolar.settings, "ortho");
    expect(toOrtho.settings.ortho).toBe(true);
    expect(toOrtho.settings.polar).toBe(false);
    expect(toOrtho.message).toContain("POLAR はオフになりました");

    const backToPolar = toggleTracking(toOrtho.settings, "polar");
    expect(backToPolar.settings.polar).toBe(true);
    expect(backToPolar.settings.ortho).toBe(false);
    expect(backToPolar.message).toContain("ORTHO はオフになりました");
  });

  it("turning off, and OTRACK, do not touch the others", () => {
    const on = toggleTracking(toggleTracking(DEFAULT_TRACKING_SETTINGS, "objectTracking").settings, "ortho").settings;
    expect(on.objectTracking).toBe(true);
    expect(on.ortho).toBe(true);
    const off = toggleTracking(on, "ortho");
    expect(off.settings).toEqual({ ...on, ortho: false });
    expect(off.message).toBe("ORTHO(直交): オフ");
    expect(toggleTracking(on, "objectTracking").settings.ortho).toBe(true);
  });

  it("does not change the settings it was given", () => {
    const before = { ...DEFAULT_TRACKING_SETTINGS };
    toggleTracking(DEFAULT_TRACKING_SETTINGS, "ortho");
    expect(DEFAULT_TRACKING_SETTINGS).toEqual(before);
  });
});

describe("normalizeTrackingSettings (values read back from storage cannot be trusted)", () => {
  it("garbage gives the defaults", () => {
    for (const raw of [null, undefined, 5, "x", [], true]) expect(normalizeTrackingSettings(raw)).toEqual(DEFAULT_TRACKING_SETTINGS);
  });

  it("valid values are kept; wrong types and unusable values are replaced", () => {
    const result = normalizeTrackingSettings({ ortho: false, polar: true, objectTracking: 1, polarAngleIncrement: 30, distanceIncrement: 25, extra: 1 });
    expect(result).toEqual({ ortho: false, polar: true, objectTracking: false, polarAngleIncrement: 30, distanceIncrement: 25 });
    const bad = normalizeTrackingSettings({ polarAngleIncrement: 7, distanceIncrement: -3 });
    expect(bad.polarAngleIncrement).toBe(45);
    expect(bad.distanceIncrement).toBe(0);
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, "10", 2_000_000]) {
      expect(normalizeTrackingSettings({ distanceIncrement: value }).distanceIncrement).toBe(0);
    }
  });

  it("ORTHO and POLAR both on in the stored value: only ORTHO is kept", () => {
    const result = normalizeTrackingSettings({ ortho: true, polar: true });
    expect(result.ortho).toBe(true);
    expect(result.polar).toBe(false);
  });
});

describe("distance increment", () => {
  it("accepts 0 (off) and positive numbers, also full-width; refuses the rest with a reason", () => {
    expect(parseDistanceIncrement("0")).toEqual({ ok: true, value: 0 });
    expect(parseDistanceIncrement("10")).toEqual({ ok: true, value: 10 });
    expect(parseDistanceIncrement(" ２５．５ ")).toEqual({ ok: true, value: 25.5 });
    for (const text of ["", "abc", "-5", "1e3", "10mm", "1,5", "2000000"]) expect(parseDistanceIncrement(text).ok, text).toBe(false);
    expect(isValidDistanceIncrement(0)).toBe(true);
    expect(isValidDistanceIncrement(-1)).toBe(false);
  });

  it("a positive value must be at least the lower bound (a tiny one makes length / increment overflow)", () => {
    expect(isValidDistanceIncrement(MIN_DISTANCE_INCREMENT)).toBe(true);
    expect(isValidDistanceIncrement(MIN_DISTANCE_INCREMENT / 2)).toBe(false);
    expect(isValidDistanceIncrement(1e-320)).toBe(false);
    expect(parseDistanceIncrement("0.0001").ok).toBe(false);
    expect(parseDistanceIncrement("0.001")).toEqual({ ok: true, value: 0.001 });
    // 保存されていた値も、同じ検証(使えない値は、初期値の 0 になる)
    expect(normalizeTrackingSettings({ distanceIncrement: 1e-320 }).distanceIncrement).toBe(0);
    expect(normalizeTrackingSettings({ distanceIncrement: 0.0005 }).distanceIncrement).toBe(0);
    expect(normalizeTrackingSettings({ distanceIncrement: 0.01 }).distanceIncrement).toBe(0.01);
  });
});
