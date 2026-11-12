// 実図面での往復テスト(手元だけ)。CAD_REGRESSION_REAL=1 のとき、regression-local/manifest.json の図面で
// CadModel -> CadDocument -> CadModel が完全に同じになること、作成の時間とメモリの目安を確認する。
import { describe, expect, it } from "vitest";
import { computeAllEntityBounds, unionOfEntityBounds } from "../spatial/entityBounds";
import { REAL_ENABLED, loadDrawing, readManifest, summarizeModel } from "../../regression/loadDrawing";
import type { CadEntity } from "../../types/cad";
import { cadModelFromDocument, documentFromCadModel } from "./convert";
import type { DeriveBounds } from "./convert";

const manifest = REAL_ENABLED ? readManifest() : [];

const deriveBounds: DeriveBounds = (entities: readonly CadEntity[]) => {
  const entityBounds = computeAllEntityBounds(entities);
  return { entityBounds, bounds: unionOfEntityBounds(entityBounds) };
};

// 19万図形で100ms以内の見込み。超えたら警告だけ出す(失敗にするのは、桁違いに遅いときだけ)
const WARN_BUILD_MS = 100;
const FAIL_BUILD_MS = 2000;

describe.skipIf(!REAL_ENABLED || manifest.length === 0)("real drawings: document model round trip (local only)", () => {
  for (const entry of manifest) {
    it(`${entry.name}: restores the identical model`, async () => {
      const { model } = await loadDrawing(entry.path);

      const heapBefore = process.memoryUsage().heapUsed;
      const buildStarted = performance.now();
      const document = documentFromCadModel(model);
      const buildMs = performance.now() - buildStarted;
      const heapMb = (process.memoryUsage().heapUsed - heapBefore) / 1024 / 1024;

      const projectStarted = performance.now();
      const restored = cadModelFromDocument(document, deriveBounds);
      const projectMs = performance.now() - projectStarted;

      console.warn(
        `[document] ${entry.name}: ${model.entities.length} entities, build ${buildMs.toFixed(1)}ms, project ${projectMs.toFixed(1)}ms, heap +${heapMb.toFixed(1)}MB(目安)`,
      );
      if (buildMs > WARN_BUILD_MS) console.warn(`[document] WARNING ${entry.name}: build ${buildMs.toFixed(1)}ms exceeds ${WARN_BUILD_MS}ms`);
      expect(buildMs).toBeLessThan(FAIL_BUILD_MS);

      // 座標のハッシュまで含めて、元と同じ
      expect(summarizeModel(restored)).toEqual(summarizeModel(model));
      expect(restored.entities.length).toBe(model.entities.length);
      // 図形のオブジェクトはコピーされていない
      for (let i = 0; i < model.entities.length; i += Math.max(1, Math.floor(model.entities.length / 1000))) {
        expect(restored.entities[i]).toBe(model.entities[i]);
      }
      expect(Array.from(restored.entityBounds)).toEqual(Array.from(model.entityBounds));
    }, 300_000);
  }
});
