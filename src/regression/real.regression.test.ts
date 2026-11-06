// 実図面の回帰テスト。regression-local/manifest.json に登録した図面だけを対象にし、
// CAD_REGRESSION_REAL=1 のとき(npm run regression)だけ動く。基準値は regression-local/golden/ に置く(git管理外)。
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REAL_ENABLED, REGRESSION_DIR, UPDATE_BASELINE, loadDrawing, readManifest, summarizeModel } from "./loadDrawing";

const manifest = REAL_ENABLED ? readManifest() : [];

describe.skipIf(!REAL_ENABLED || manifest.length === 0)("real drawings (local only)", () => {
  const goldenDir = path.join(REGRESSION_DIR, "golden");

  for (const entry of manifest) {
    it(`${entry.name}: matches the recorded baseline`, async () => {
      const { model } = await loadDrawing(entry.path);
      const summary = summarizeModel(model);
      const goldenFile = path.join(goldenDir, `${entry.name}.json`);

      if (UPDATE_BASELINE || !fs.existsSync(goldenFile)) {
        fs.mkdirSync(goldenDir, { recursive: true });
        fs.writeFileSync(goldenFile, JSON.stringify(summary, null, 2) + "\n", "utf8");
        console.warn(`[regression] baseline ${UPDATE_BASELINE ? "updated" : "created"}: ${goldenFile}`);
        return;
      }
      const golden = JSON.parse(fs.readFileSync(goldenFile, "utf8"));
      expect(summary).toEqual(golden);
    }, 300_000);
  }
});
