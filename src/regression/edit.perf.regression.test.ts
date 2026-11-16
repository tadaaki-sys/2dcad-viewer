// 編集(移動・回転・複写・削除)の時間と正しさを、手元の実図面で測る(Phase 9)。
// CAD_REGRESSION_REAL=1 のときだけ動く。結果は regression-local/perf/<名前>.edit.json (git管理外)。
// 時間は失敗にしない(PCの状態でぶれるため)。失敗にするのは、正しさだけ:
//   移動 → Undo で、元と「同じ図形(同じオブジェクト)・同じ順」に戻ること。Redo で、移動後に戻ること。
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DocumentSession } from "../app/document/documentSession";
import { copyEntities, deleteEntities, transformEntities } from "../app/document/editing";
import type { Editability } from "../app/document/editability";
import { createSelectionPreview } from "../core/commands/entityPreview";
import { rotationMatrix, translationMatrix } from "../core/geometry/transform";
import { documentFromCadModel } from "../core/model";
import { REAL_ENABLED, REGRESSION_DIR, loadDrawing, readManifest } from "./loadDrawing";

const manifest = REAL_ENABLED ? readManifest() : [];

const time = <T>(fn: () => T): { value: T; ms: number } => {
  const started = performance.now();
  const value = fn();
  return { value, ms: performance.now() - started };
};
const round = (n: number) => Math.round(n * 100) / 100;

/** 性能測定用: 取り込んだ図形も、すべて編集できるものとして扱う(編集可否の判断そのものは、別のテストで確かめている) */
const ALL_EDITABLE: Editability = { isEditable: () => true, reasonFor: () => null };

const SIZES = [1_000, 10_000, 100_000];

describe.skipIf(!REAL_ENABLED || manifest.length === 0)("edit timings on real drawings (record only; correctness asserted)", () => {
  for (const entry of manifest) {
    it(`${entry.name}: move / rotate / copy / delete, undo, redo`, async () => {
      const { model } = await loadDrawing(entry.path);
      const session = new DocumentSession(documentFromCadModel(model));
      const original = session.document.entities;
      const count = original.length;
      if (count === 0) return;

      const sameAsOriginal = (): boolean => {
        const now = session.document.entities;
        if (now.length !== count) return false;
        for (let i = 0; i < count; i++) {
          if (now[i] !== original[i] || session.document.indexById.get(original[i].id) !== i) return false;
        }
        return true;
      };

      const results: Record<string, number> = { entityCount: count };
      for (const size of SIZES) {
        if (size > count && size !== SIZES[0]) continue;
        const n = Math.min(size, count);
        // 散らばらせて選ぶ(先頭の連続だけだと、描画順の処理が偏るため)
        const step = Math.max(1, Math.floor(count / n));
        const ids: string[] = [];
        for (let i = 0; i < count && ids.length < n; i += step) ids.push(original[i].id);
        const tag = `n${ids.length}`;

        // 移動
        const move = time(() => transformEntities(session, ALL_EDITABLE, ids, translationMatrix(1234.5, -678.9), "移動", "移動"));
        expect(move.value.ok).toBe(true);
        const movedDoc = session.document;
        expect(session.document.entities.length).toBe(count);
        const undoMove = time(() => session.undo());
        expect(undoMove.value.type).toBe("done");
        expect(sameAsOriginal()).toBe(true); // 正しさ: 移動 → Undo で、元と同じ
        const redoMove = time(() => session.redo());
        expect(redoMove.value.type).toBe("done");
        // 正しさ: Redo で、移動後と同じ図形の並びに戻る(ドキュメントの入れ物は新しくてよいが、図形は同じオブジェクト)
        expect(session.document.entities.length).toBe(movedDoc.entities.length);
        expect(session.document.entities.every((e, i) => e === movedDoc.entities[i])).toBe(true);
        session.undo();
        expect(sameAsOriginal()).toBe(true);

        // 回転
        const rotate = time(() => transformEntities(session, ALL_EDITABLE, ids, rotationMatrix({ x: 0, y: 0 }, Math.PI / 6), "回転", "回転"));
        expect(rotate.value.ok).toBe(true);
        session.undo();
        expect(sameAsOriginal()).toBe(true);

        // 複写(1回)
        const copy = time(() => copyEntities(session, ALL_EDITABLE, ids, [translationMatrix(500, 500)], "複写"));
        expect(copy.value.ok).toBe(true);
        expect(session.document.entities.length).toBe(count + ids.length);
        session.undo();
        expect(sameAsOriginal()).toBe(true);

        // 削除
        const del = time(() => deleteEntities(session, ALL_EDITABLE, ids, "削除"));
        expect(del.value.ok).toBe(true);
        expect(session.document.entities.length).toBe(count - ids.length);
        session.undo();
        expect(sameAsOriginal()).toBe(true);

        // ゴム紐(選択した図形のプレビュー)の作成。上限 300 個
        const entities = ids.map((id) => original[session.document.indexById.get(id) ?? -1]).filter((e) => e !== undefined);
        const preview = time(() => createSelectionPreview(entities)([translationMatrix(10, 10)]));

        results[`${tag}.moveMs`] = round(move.ms);
        results[`${tag}.undoMoveMs`] = round(undoMove.ms);
        results[`${tag}.redoMoveMs`] = round(redoMove.ms);
        results[`${tag}.rotateMs`] = round(rotate.ms);
        results[`${tag}.copyMs`] = round(copy.ms);
        results[`${tag}.deleteMs`] = round(del.ms);
        results[`${tag}.previewMs`] = round(preview.ms);
        results[`${tag}.previewShapes`] = preview.value.length;
      }

      fs.mkdirSync(path.join(REGRESSION_DIR, "perf"), { recursive: true });
      fs.writeFileSync(path.join(REGRESSION_DIR, "perf", `${entry.name}.edit.json`), JSON.stringify(results, null, 2) + "\n", "utf8");
      console.log(`[edit perf] ${entry.name}`, JSON.stringify(results));
    }, 900_000);
  }
});
