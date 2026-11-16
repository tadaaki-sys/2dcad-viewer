import { describe, expect, it } from "vitest";
import { DEFAULT_SNAP_SETTINGS, enabledSnapTypes, isValidGridSpacing, normalizeSnapSettings, parseGridSpacing } from "./snapSettings";
import { OBJECT_SNAP_TYPES } from "./snapTypes";

describe("default settings", () => {
  it("the four existing types plus center and quadrant are on; perpendicular, tangent and extension are off; grid is off", () => {
    const enabled = enabledSnapTypes(DEFAULT_SNAP_SETTINGS);
    expect([...enabled].sort()).toEqual(["center", "endpoint", "intersection", "midpoint", "nearest", "quadrant"]);
    expect(DEFAULT_SNAP_SETTINGS.gridDisplay).toBe(false);
    expect(DEFAULT_SNAP_SETTINGS.gridSnap).toBe(false);
    expect(DEFAULT_SNAP_SETTINGS.gridSpacing).toBe(10);
  });

  it("every object snap type has a setting", () => {
    for (const type of OBJECT_SNAP_TYPES) expect(typeof DEFAULT_SNAP_SETTINGS.types[type as keyof typeof DEFAULT_SNAP_SETTINGS.types]).toBe("boolean");
  });
});

describe("enabledSnapTypes", () => {
  it("OSNAP off removes the object snaps but keeps the grid snap; SNAP adds the grid", () => {
    const off = { ...DEFAULT_SNAP_SETTINGS, objectSnap: false };
    expect(enabledSnapTypes(off).size).toBe(0);
    expect([...enabledSnapTypes({ ...off, gridSnap: true })]).toEqual(["grid"]);
    expect(enabledSnapTypes({ ...DEFAULT_SNAP_SETTINGS, gridSnap: true }).has("grid")).toBe(true);
  });

  it("each type can be turned on and off by itself", () => {
    const withTangent = { ...DEFAULT_SNAP_SETTINGS, types: { ...DEFAULT_SNAP_SETTINGS.types, tangent: true, endpoint: false } };
    const enabled = enabledSnapTypes(withTangent);
    expect(enabled.has("tangent")).toBe(true);
    expect(enabled.has("endpoint")).toBe(false);
  });
});

describe("normalizeSnapSettings (values read back from storage cannot be trusted)", () => {
  it("garbage and non-objects give the defaults", () => {
    for (const raw of [null, undefined, 5, "x", [], true]) expect(normalizeSnapSettings(raw)).toEqual(DEFAULT_SNAP_SETTINGS);
  });

  it("valid values are kept; wrong types and unknown keys are replaced or dropped", () => {
    const result = normalizeSnapSettings({
      objectSnap: false,
      types: { endpoint: false, tangent: true, bogus: true, center: "yes" },
      gridDisplay: true,
      gridSnap: 1,
      gridSpacing: 25,
      extra: "x",
    });
    expect(result.objectSnap).toBe(false);
    expect(result.types.endpoint).toBe(false);
    expect(result.types.tangent).toBe(true);
    expect(result.types.center).toBe(DEFAULT_SNAP_SETTINGS.types.center); // 型が違うので、初期値
    expect("bogus" in result.types).toBe(false);
    expect(result.gridDisplay).toBe(true);
    expect(result.gridSnap).toBe(false); // 型が違うので、初期値
    expect(result.gridSpacing).toBe(25);
    expect("extra" in result).toBe(false);
  });

  it("an unusable grid spacing falls back to the default", () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, "10", 1e9, 1e-9]) {
      expect(normalizeSnapSettings({ gridSpacing: bad }).gridSpacing).toBe(DEFAULT_SNAP_SETTINGS.gridSpacing);
    }
  });

  it("does not share the defaults object (changing the result leaves the defaults alone)", () => {
    const result = normalizeSnapSettings(null);
    result.types.endpoint = false;
    expect(DEFAULT_SNAP_SETTINGS.types.endpoint).toBe(true);
  });
});

describe("grid spacing", () => {
  it("accepts a positive number in range (also full-width), and refuses everything else with a reason", () => {
    expect(parseGridSpacing("10")).toEqual({ ok: true, value: 10 });
    expect(parseGridSpacing(" ２５．５ ")).toEqual({ ok: true, value: 25.5 });
    expect(parseGridSpacing(".5")).toEqual({ ok: true, value: 0.5 });
    for (const text of ["", "abc", "-5", "0", "1e3", "10mm", "1,5", "0.0001", "99999999"]) {
      const result = parseGridSpacing(text);
      expect(result.ok, text).toBe(false);
    }
  });

  it("isValidGridSpacing", () => {
    expect(isValidGridSpacing(10)).toBe(true);
    expect(isValidGridSpacing(0.001)).toBe(true);
    expect(isValidGridSpacing(1_000_000)).toBe(true);
    expect(isValidGridSpacing(0.0009)).toBe(false);
    expect(isValidGridSpacing(Number.NaN)).toBe(false);
  });
});
