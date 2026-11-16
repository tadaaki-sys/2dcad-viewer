// 性能の基準値。失敗にはせず、基準より大きく遅くなったときだけ警告を出す(PCの状態でぶれるため)。
// CAD_REGRESSION_REAL=1 のときだけ動く。結果は regression-local/perf/、基準は regression-local/perf-baseline/ (git管理外)。
import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { buildSpatialIndex } from "../core/spatial/SpatialIndex";
import { findEntitiesInBox, findEntitiesNearPoint } from "../core/selection/Selection";
import { findSnapPoint } from "../core/snap/SnapEngine";
import type { SnapType } from "../core/snap/SnapEngine";
import { DEFAULT_SNAP_SETTINGS, enabledSnapTypes } from "../core/snap/snapSettings";
import type { CadModel } from "../types/cad";
import { REAL_ENABLED, REGRESSION_DIR, UPDATE_BASELINE, loadDrawing, readManifest } from "./loadDrawing";
import { cameraAt, installRecordingPath2D, renderModel } from "./recordingContext";

const manifest = REAL_ENABLED ? readManifest() : [];

// この倍率+固定の余裕を超えたら警告する
const WARN_RATIO = 2;
const WARN_SLACK_MS = 20;

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const timeIt = (fn: () => void) => {
  const started = performance.now();
  fn();
  return performance.now() - started;
};

function measure(model: CadModel, base: { dwgConvertMs: number; parseMs: number; convertMs: number }) {
  const bounds = model.bounds ?? { min: { x: 0, y: 0 }, max: { x: 1, y: 1 } };
  const width = bounds.max.x - bounds.min.x;
  const height = bounds.max.y - bounds.min.y;
  const random = mulberry32(12345);
  const points = Array.from({ length: 50 }, () => ({ x: bounds.min.x + random() * width, y: bounds.min.y + random() * height }));
  const visible = new Set(model.layers.filter((l) => l.visible).map((l) => l.name));

  let index!: ReturnType<typeof buildSpatialIndex>;
  const indexMs = timeIt(() => {
    index = buildSpatialIndex(model);
  });

  const scale = Math.min(1000 / Math.max(width, 1), 700 / Math.max(height, 1));
  const fullCamera = cameraAt(scale, 0, 700);
  const zoomCamera = cameraAt(scale * 8, -width * scale * 2, 700 + height * scale * 2);
  const fullRenderMs = timeIt(() => renderModel(model, fullCamera, { useIndex: true }));
  const zoomRenderMs = timeIt(() => renderModel(model, zoomCamera, { useIndex: true }));

  const tolerance = Math.max(width, height) / 1000;
  const selectionMs =
    timeIt(() => {
      for (const p of points) findEntitiesNearPoint(model.entities, visible, p, tolerance, index);
    }) / points.length;
  const snapMs =
    timeIt(() => {
      for (const p of points) findSnapPoint(model.entities, visible, p, tolerance, index, { nearestToleranceWorld: 5 });
    }) / points.length;
  // 全種類(端点・中点・交点・中心・四半円点・垂線・接線・近接・延長・グリッド)を有効にしたときの Snap(Phase 7)
  const allTypes = new Set<SnapType>(["endpoint", "midpoint", "intersection", "center", "quadrant", "perpendicular", "tangent", "nearest", "extension", "grid"]);
  const snapAllTypesMs =
    timeIt(() => {
      for (const p of points) {
        findSnapPoint(model.entities, visible, p, tolerance, index, {
          enabledTypes: allTypes,
          nearestToleranceWorld: 5,
          fromPoint: points[0],
          gridSpacing: Math.max(width, height) / 100,
          extensionAcquireWorld: tolerance * 15,
        });
      }
    }) / points.length;
  // 初期設定(端点・中点・交点・中心・四半円点・近接)での Snap。ふだんの操作の時間
  const snapDefaultSettingsMs =
    timeIt(() => {
      for (const p of points) {
        findSnapPoint(model.entities, visible, p, tolerance, index, { enabledTypes: enabledSnapTypes(DEFAULT_SNAP_SETTINGS), nearestToleranceWorld: 5 });
      }
    }) / points.length;
  // 重くなりやすい種類(延長: 広い範囲を調べる)だけを有効にしたとき
  const snapExtensionOnlyMs =
    timeIt(() => {
      for (const p of points) {
        findSnapPoint(model.entities, visible, p, tolerance, index, { enabledTypes: new Set<SnapType>(["extension"]), extensionAcquireWorld: tolerance * 15 });
      }
    }) / points.length;
  // 図面を変更したあとの、最初の Snap(円弧・楕円の中心の索引を作る時間を含む)。索引は、変更のたびに作り直される
  const freshIndex = buildSpatialIndex(model);
  const snapFirstAfterEditMs = timeIt(() => {
    findSnapPoint(model.entities, visible, points[0], tolerance, freshIndex, { enabledTypes: enabledSnapTypes(DEFAULT_SNAP_SETTINGS), nearestToleranceWorld: 5 });
  });
  const boxSelectMs = timeIt(() => {
    findEntitiesInBox(model.entities, visible, { min: points[0], max: { x: points[0].x + width / 10, y: points[0].y + height / 10 } }, "crossing", index);
  });

  return { ...base, indexMs, fullRenderMs, zoomRenderMs, selectionMs, snapMs, snapDefaultSettingsMs, snapExtensionOnlyMs, snapAllTypesMs, snapFirstAfterEditMs, boxSelectMs, entityCount: model.entities.length };
}

describe.skipIf(!REAL_ENABLED || manifest.length === 0)("performance baseline (warn only)", () => {
  beforeAll(installRecordingPath2D);

  for (const entry of manifest) {
    it(`${entry.name}: measures timings`, async () => {
      const { model, timings } = await loadDrawing(entry.path);
      const result = measure(model, timings);
      const rounded = Object.fromEntries(Object.entries(result).map(([k, v]) => [k, Math.round(v * 100) / 100]));

      fs.mkdirSync(path.join(REGRESSION_DIR, "perf"), { recursive: true });
      fs.writeFileSync(path.join(REGRESSION_DIR, "perf", `${entry.name}.json`), JSON.stringify(rounded, null, 2) + "\n", "utf8");

      const baselineFile = path.join(REGRESSION_DIR, "perf-baseline", `${entry.name}.json`);
      if (UPDATE_BASELINE || !fs.existsSync(baselineFile)) {
        fs.mkdirSync(path.dirname(baselineFile), { recursive: true });
        fs.writeFileSync(baselineFile, JSON.stringify(rounded, null, 2) + "\n", "utf8");
        console.warn(`[perf] baseline ${UPDATE_BASELINE ? "updated" : "created"} for ${entry.name}`);
        return;
      }
      const baseline = JSON.parse(fs.readFileSync(baselineFile, "utf8")) as Record<string, number>;
      for (const [key, value] of Object.entries(rounded) as Array<[string, number]>) {
        if (key === "entityCount") continue;
        const limit = (baseline[key] ?? 0) * WARN_RATIO + WARN_SLACK_MS;
        if (value > limit) console.warn(`[perf] WARNING ${entry.name}.${key}: ${value}ms (baseline ${baseline[key]}ms, limit ${Math.round(limit)}ms)`);
      }
      expect(rounded.entityCount).toBe(baseline.entityCount); // 図形数が変わったら、読み込みの内容が変わっている
    }, 600_000);
  }
});
