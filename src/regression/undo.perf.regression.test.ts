// 変更・Undo・Redo の時間と正しさを、手元の実図面で測る(Phase 3)。
// CAD_REGRESSION_REAL=1 のときだけ動く。結果は regression-local/perf/<名前>.undo.json (git管理外)。
// 時間は失敗にしない(PCの状態でぶれるため。Phase 3 は初めての測定なので、基準値もまだ無い)。
// 失敗にするのは、正しさ(Undoで元と同じ図形の並びに戻ること)だけ。
import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { DocumentSession } from "../app/document/documentSession";
import { renderModelFromDocument } from "../app/document/renderModel";
import { addEntitiesChangeSet, removeEntitiesChangeSet } from "../core/history";
import { documentFromCadModel } from "../core/model";
import { buildSpatialIndex } from "../core/spatial/SpatialIndex";
import type { CadLine } from "../types/cad";
import { REAL_ENABLED, REGRESSION_DIR, loadDrawing, readManifest } from "./loadDrawing";
import { cameraAt, installRecordingPath2D, renderModel } from "./recordingContext";

const manifest = REAL_ENABLED ? readManifest() : [];

const time = <T>(fn: () => T): { value: T; ms: number } => {
  const started = performance.now();
  const value = fn();
  return { value, ms: performance.now() - started };
};

const round = (n: number) => Math.round(n * 100) / 100;

describe.skipIf(!REAL_ENABLED || manifest.length === 0)("undo / redo timings on real drawings (record only)", () => {
  beforeAll(installRecordingPath2D);

  for (const entry of manifest) {
    it(`${entry.name}: add 1, remove many, undo, redo`, async () => {
      const { model } = await loadDrawing(entry.path);
      const built = time(() => documentFromCadModel(model));
      const session = new DocumentSession(built.value);
      const original = session.document.entities;
      const count = original.length;
      if (count === 0) return;

      // 1件の追加(描画順の末尾)
      const id = session.allocateEntityId();
      const layer = session.document.layers[0]?.name ?? "0";
      const line: CadLine = { id, type: "LINE", layer, color: "#ff00ff", start: { x: 0, y: 0 }, end: { x: 10, y: 10 } };
      const addChange = addEntitiesChangeSet(session.document, [line], "線を追加");
      const add = time(() => session.apply(addChange));
      expect(add.value.ok).toBe(true);
      const afterAdd = session.document;

      // 追加の表示用モデル(範囲と索引)の作り直し
      const rebuild = time(() => renderModelFromDocument(session.document));
      const index = time(() => buildSpatialIndex(rebuild.value));

      // 作図中のゴム紐の重ね描きの費用: 索引を作り済みのモデルを、ゴム紐あり・なしで描く(全体表示のカメラ)
      const bounds = rebuild.value.bounds ?? { min: { x: 0, y: 0 }, max: { x: 1, y: 1 } };
      const width = bounds.max.x - bounds.min.x;
      const height = bounds.max.y - bounds.min.y;
      const scale = Math.min(1000 / Math.max(width, 1), 700 / Math.max(height, 1));
      const camera = cameraAt(scale, 0, 700);
      const previewShapes = [
        {
          kind: "polyline" as const,
          points: [
            { x: bounds.min.x, y: bounds.min.y },
            { x: bounds.min.x + width / 2, y: bounds.min.y + height / 3 },
            { x: bounds.max.x, y: bounds.max.y },
          ],
          closed: false,
        },
      ];
      const renderPlain = time(() => renderModel(rebuild.value, camera, { spatialIndex: index.value }));
      const renderWithPreview = time(() => renderModel(rebuild.value, camera, { spatialIndex: index.value, previewShapes }));

      const undoAdd = time(() => session.undo());
      expect(undoAdd.value.type).toBe("done");
      expect(session.document.entities.length).toBe(count);
      const redoAdd = time(() => session.redo());
      expect(redoAdd.value.type).toBe("done");
      expect(session.document.entities.length).toBe(count + 1);
      expect(session.document.entities[count]).toBe(line);
      expect(session.document.entities.slice(0, count).every((e, i) => e === original[i])).toBe(true);
      session.undo();

      // 多数の削除(最大1,000件。図形の位置は、散らばらせる)
      const removeCount = Math.min(1000, Math.floor(count / 2));
      const step = Math.max(1, Math.floor(count / Math.max(removeCount, 1)));
      const ids: string[] = [];
      for (let i = 0; i < count && ids.length < removeCount; i += step) ids.push(original[i].id);
      const removeChange = time(() => removeEntitiesChangeSet(session.document, ids, `${ids.length}件を削除`));
      const remove = time(() => session.apply(removeChange.value));
      expect(remove.value.ok).toBe(true);
      expect(session.document.entities.length).toBe(count - ids.length);
      const undoRemove = time(() => session.undo());
      expect(undoRemove.value.type).toBe("done");
      // 正しさ: 削除を戻すと、元と同じ図形(同じオブジェクト)が、同じ順に並ぶ
      expect(session.document.entities.length).toBe(count);
      let same = true;
      for (let i = 0; i < count; i++) {
        if (session.document.entities[i] !== original[i] || session.document.indexById.get(original[i].id) !== i) {
          same = false;
          break;
        }
      }
      expect(same).toBe(true);
      const redoRemove = time(() => session.redo());
      expect(redoRemove.value.type).toBe("done");
      expect(session.document.entities.length).toBe(count - ids.length);
      // 追加したままの図形が残っていないこと(afterAddは、追加後・削除前のドキュメント)
      expect(afterAdd.entities.length).toBe(count + 1);

      const result = {
        entityCount: count,
        removedCount: ids.length,
        documentBuildMs: round(built.ms),
        addOneMs: round(add.ms),
        rebuildRenderModelMs: round(rebuild.ms),
        buildSpatialIndexMs: round(index.ms),
        renderFullViewMs: round(renderPlain.ms),
        renderFullViewWithPreviewMs: round(renderWithPreview.ms),
        undoAddMs: round(undoAdd.ms),
        redoAddMs: round(redoAdd.ms),
        buildRemoveChangeSetMs: round(removeChange.ms),
        removeManyMs: round(remove.ms),
        undoRemoveManyMs: round(undoRemove.ms),
        redoRemoveManyMs: round(redoRemove.ms),
      };
      fs.mkdirSync(path.join(REGRESSION_DIR, "perf"), { recursive: true });
      fs.writeFileSync(path.join(REGRESSION_DIR, "perf", `${entry.name}.undo.json`), JSON.stringify(result, null, 2) + "\n", "utf8");
      console.log(`[undo perf] ${entry.name}`, JSON.stringify(result));
    }, 600_000);
  }
});
