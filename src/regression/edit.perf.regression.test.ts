// 編集(移動・回転・複写・削除)の時間と正しさを、手元の実図面で測る(Phase 9)。
// CAD_REGRESSION_REAL=1 のときだけ動く。結果は regression-local/perf/<名前>.edit.json (git管理外)。
// 時間は失敗にしない(PCの状態でぶれるため)。失敗にするのは、正しさだけ:
//   移動 → Undo で、元と「同じ図形(同じオブジェクト)・同じ順」に戻ること。Redo で、移動後に戻ること。
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DocumentSession } from "../app/document/documentSession";
import { breakAt } from "../app/document/breaking";
import { cornerAt } from "../app/document/filleting";
import type { CornerMode } from "../core/geometry/fillet";
import { offsetAt } from "../app/document/offsetting";
import { trimOrExtendAt } from "../app/document/trimming";
import { copyEntities, deleteEntities, stretchEntities, transformEntities } from "../app/document/editing";
import type { Editability } from "../app/document/editability";
import { createSelectionPreview } from "../core/commands/entityPreview";
import { windowFromCorners } from "../core/geometry/stretch";
import { reflectionMatrix, rotationMatrix, scaleMatrix, translationMatrix } from "../core/geometry/transform";
import { computeAllEntityBounds } from "../core/spatial/entityBounds";
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

        // 拡大縮小(Phase 10)
        const scaled = time(() => transformEntities(session, ALL_EDITABLE, ids, scaleMatrix({ x: 0, y: 0 }, 1.5), "拡大縮小", "拡大縮小"));
        expect(scaled.value.ok).toBe(true);
        session.undo();
        expect(sameAsOriginal()).toBe(true);

        // 鏡像(複写。元の図形は残る)と、鏡像(元の図形を置き換え)
        const mirrored = time(() => copyEntities(session, ALL_EDITABLE, ids, [reflectionMatrix({ x: 0, y: 0 }, { x: 3, y: 4 })!], "鏡像コピー"));
        expect(mirrored.value.ok).toBe(true);
        expect(session.document.entities.length).toBe(count + ids.length);
        session.undo();
        expect(sameAsOriginal()).toBe(true);
        const mirroredInPlace = time(() => transformEntities(session, ALL_EDITABLE, ids, reflectionMatrix({ x: 0, y: 0 }, { x: 3, y: 4 })!, "鏡像化", "鏡像化"));
        expect(mirroredInPlace.value.ok).toBe(true);
        session.undo();
        expect(sameAsOriginal()).toBe(true);

        // ストレッチ(図面の左半分を窓にする。窓にかかる図形の候補は、選んだ図形)
        // 窓にかかる図形の検索(STRETCH の2点目を指示したとき、全図形の範囲を1回計算する)
        const boundsTimed = time(() => computeAllEntityBounds(original));
        const bounds = boundsTimed.value;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (let i = 0; i + 3 < bounds.length; i += 4) {
          if (!Number.isFinite(bounds[i]) || !Number.isFinite(bounds[i + 2]) || !Number.isFinite(bounds[i + 1]) || !Number.isFinite(bounds[i + 3])) continue;
          minX = Math.min(minX, bounds[i]); minY = Math.min(minY, bounds[i + 1]); maxX = Math.max(maxX, bounds[i + 2]); maxY = Math.max(maxY, bounds[i + 3]);
        }
        const window = windowFromCorners({ x: minX, y: minY }, { x: (minX + maxX) / 2, y: maxY });
        const stretched = time(() => stretchEntities(session, ALL_EDITABLE, ids, window, 10, 10, "ストレッチ"));
        if (stretched.value.ok) {
          expect(session.document.entities.length).toBe(count);
          session.undo();
        }
        expect(sameAsOriginal()).toBe(true); // 窓に動かせるものが無い図面では、何も変わらない

        // ゴム紐(選択した図形のプレビュー)の作成。上限 300 個
        const entities = ids.map((id) => original[session.document.indexById.get(id) ?? -1]).filter((e) => e !== undefined);
        const preview = time(() => createSelectionPreview(entities)([translationMatrix(10, 10)]));

        results[`${tag}.moveMs`] = round(move.ms);
        results[`${tag}.undoMoveMs`] = round(undoMove.ms);
        results[`${tag}.redoMoveMs`] = round(redoMove.ms);
        results[`${tag}.rotateMs`] = round(rotate.ms);
        results[`${tag}.copyMs`] = round(copy.ms);
        results[`${tag}.scaleMs`] = round(scaled.ms);
        results[`${tag}.mirrorCopyMs`] = round(mirrored.ms);
        results[`${tag}.mirrorInPlaceMs`] = round(mirroredInPlace.ms);
        results[`${tag}.stretchMs`] = round(stretched.ms);
        results[`${tag}.windowSearchMs`] = round(boundsTimed.ms);
        results[`${tag}.deleteMs`] = round(del.ms);
        results[`${tag}.previewMs`] = round(preview.ms);
        results[`${tag}.previewShapes`] = preview.value.length;
      }

      fs.mkdirSync(path.join(REGRESSION_DIR, "perf"), { recursive: true });
      fs.writeFileSync(path.join(REGRESSION_DIR, "perf", `${entry.name}.edit.json`), JSON.stringify(results, null, 2) + "\n", "utf8");
      console.log(`[edit perf] ${entry.name}`, JSON.stringify(results));
    }, 900_000);

    it(`${entry.name}: trim and extend clicks on real lines, then Undo (time recorded; the round trip is asserted)`, async () => {
      const { model } = await loadDrawing(entry.path);
      const session = new DocumentSession(documentFromCadModel(model));
      const original = session.document.entities;
      const count = original.length;
      if (count === 0) return;
      const visible = new Set(session.document.layers.map((layer) => layer.name));
      const lines = original.filter((entity) => entity.type === "LINE");
      const step = Math.max(1, Math.floor(lines.length / 20));
      const samples = lines.filter((_, i) => i % step === 0).slice(0, 20);

      let tried = 0;
      let changed = 0;
      let totalMs = 0;
      let maxMs = 0;
      for (const entity of samples) {
        if (entity.type !== "LINE") continue;
        const middle = { x: (entity.start.x + entity.end.x) / 2, y: (entity.start.y + entity.end.y) / 2 };
        for (const mode of ["trim", "extend"] as const) {
          const run = time(() => trimOrExtendAt(session, ALL_EDITABLE, mode, middle, 0.01, null, visible));
          tried++;
          totalMs += run.ms;
          maxMs = Math.max(maxMs, run.ms);
          if (run.value.ok) {
            changed++;
            // 1クリック = Undo 1段階。戻すと、元と同じ図形・同じ順
            expect(session.undo().type).toBe("done");
          }
          expect(session.canUndo).toBe(false);
          const now = session.document.entities;
          expect(now.length).toBe(count);
          let same = true;
          for (let i = 0; i < count; i++) {
            if (now[i] !== original[i]) {
              same = false;
              break;
            }
          }
          expect(same).toBe(true);
        }
      }
      const result = { entityCount: count, tried, changed, averageMs: round(tried > 0 ? totalMs / tried : 0), maxMs: round(maxMs) };
      fs.mkdirSync(path.join(REGRESSION_DIR, "perf"), { recursive: true });
      fs.writeFileSync(path.join(REGRESSION_DIR, "perf", `${entry.name}.trim.json`), JSON.stringify(result, null, 2) + "\n", "utf8");
      console.log(`[trim perf] ${entry.name}`, JSON.stringify(result));
    }, 900_000);

    it(`${entry.name}: offset and break on real figures, then Undo (time recorded; the round trip is asserted)`, async () => {
      const { model } = await loadDrawing(entry.path);
      const session = new DocumentSession(documentFromCadModel(model));
      const original = session.document.entities;
      const count = original.length;
      if (count === 0) return;
      // 線・円弧・円・折れ線から、図形の種類ごとに、均等に最大20個ずつ。折れ線は、頂点が多いものも2つ(重い場合の時間を見る)
      const sampleOf = (types: string[], max = 20) => {
        const all = original.filter((entity) => types.includes(entity.type));
        const step = Math.max(1, Math.floor(all.length / max));
        return all.filter((_, i) => i % step === 0).slice(0, max);
      };
      const polylines = original.filter((entity) => entity.type === "LWPOLYLINE" || entity.type === "POLYLINE");
      const heaviest = [...polylines].sort((a, b) => ((b as { vertices: unknown[] }).vertices.length) - ((a as { vertices: unknown[] }).vertices.length)).slice(0, 2);
      const samples = [...sampleOf(["LINE"]), ...sampleOf(["ARC", "CIRCLE"]), ...sampleOf(["LWPOLYLINE", "POLYLINE"]), ...heaviest];

      const pointOn = (entity: (typeof original)[number], fraction: number) => {
        if (entity.type === "LINE") return { x: entity.start.x + (entity.end.x - entity.start.x) * fraction, y: entity.start.y + (entity.end.y - entity.start.y) * fraction };
        if (entity.type === "CIRCLE" || entity.type === "ARC") {
          const angle = entity.type === "CIRCLE" ? Math.PI * 2 * fraction : entity.startAngle + (((entity.endAngle - entity.startAngle) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) * fraction;
          return { x: entity.center.x + entity.radius * Math.cos(angle), y: entity.center.y + entity.radius * Math.sin(angle) };
        }
        if (entity.type === "LWPOLYLINE" || entity.type === "POLYLINE") {
          const v = entity.vertices;
          return v[Math.min(v.length - 1, Math.floor((v.length - 1) * fraction))];
        }
        return { x: 0, y: 0 };
      };

      const stats = { offsetTried: 0, offsetOk: 0, breakTried: 0, breakOk: 0, offsetMs: 0, offsetMaxMs: 0, breakMs: 0, breakMaxMs: 0 };
      const expectRestored = () => {
        expect(session.canUndo).toBe(false);
        const now = session.document.entities;
        expect(now.length).toBe(count);
        for (let i = 0; i < count; i++) {
          if (now[i] !== original[i]) throw new Error(`Undo で元に戻りません(${i} 番目)`);
        }
      };
      for (const entity of samples) {
        // 距離は、図形の大きさに合わせず、ふつうの値(5)と、大きい値(1000)で試す。写せないときは、理由つきで断られ、図面は変わらない
        for (const distance of [5, 1000]) {
          for (const sign of [1, -1]) {
            // 側は、図形の1点から、法線方向へずらした点で指す(どちらの側かは、図形ごとに違うので、結果の成否だけを見る)
            const p = pointOn(entity, 0.5);
            const run = time(() => offsetAt(session, ALL_EDITABLE, entity.id, distance, { x: p.x + sign * 0.5, y: p.y + sign * 0.25 }));
            stats.offsetTried++;
            stats.offsetMs += run.ms;
            stats.offsetMaxMs = Math.max(stats.offsetMaxMs, run.ms);
            if (run.value.ok) {
              stats.offsetOk++;
              expect(session.document.entities.length).toBe(count + 1);
              expect(session.undo().type).toBe("done");
            }
            expectRestored();
          }
        }
        // 切断: 図形の 1/3 の点から 2/3 の点まで
        const first = pointOn(entity, 1 / 3);
        const second = pointOn(entity, 2 / 3);
        const run = time(() => breakAt(session, ALL_EDITABLE, entity.id, first, second));
        stats.breakTried++;
        stats.breakMs += run.ms;
        stats.breakMaxMs = Math.max(stats.breakMaxMs, run.ms);
        if (run.value.ok) {
          stats.breakOk++;
          expect(session.undo().type).toBe("done");
        }
        expectRestored();
      }
      const result = {
        entityCount: count,
        samples: samples.length,
        ...stats,
        offsetAverageMs: round(stats.offsetTried > 0 ? stats.offsetMs / stats.offsetTried : 0),
        offsetMaxMs: round(stats.offsetMaxMs),
        breakAverageMs: round(stats.breakTried > 0 ? stats.breakMs / stats.breakTried : 0),
        breakMaxMs: round(stats.breakMaxMs),
      };
      fs.mkdirSync(path.join(REGRESSION_DIR, "perf"), { recursive: true });
      fs.writeFileSync(path.join(REGRESSION_DIR, "perf", `${entry.name}.offset.json`), JSON.stringify(result, null, 2) + "\n", "utf8");
      console.log(`[offset perf] ${entry.name}`, JSON.stringify(result));
    }, 900_000);

    it(`${entry.name}: fillet and chamfer on real figures, then Undo (time recorded; the round trip is asserted)`, async () => {
      const { model } = await loadDrawing(entry.path);
      const session = new DocumentSession(documentFromCadModel(model));
      const original = session.document.entities;
      const count = original.length;
      if (count === 0) return;
      const sampleOf = (types: string[], max: number) => {
        const all = original.filter((entity) => types.includes(entity.type));
        const step = Math.max(1, Math.floor(all.length / max));
        return all.filter((_, i) => i % step === 0).slice(0, max);
      };
      const lines = sampleOf(["LINE"], 40) as Array<Extract<(typeof original)[number], { type: "LINE" }>>;
      const polylines = original.filter((entity) => entity.type === "LWPOLYLINE" || entity.type === "POLYLINE") as Array<Extract<(typeof original)[number], { vertices: unknown }>>;
      const heaviest = [...polylines].sort((a, b) => b.vertices.length - a.vertices.length).slice(0, 2);
      const sampledPolylines = [...(sampleOf(["LWPOLYLINE", "POLYLINE"], 40) as typeof polylines), ...heaviest];
      const modes: CornerMode[] = [
        { kind: "fillet", radius: 5 },
        { kind: "fillet", radius: 1000 },
        { kind: "chamfer", distance1: 5, distance2: 5 },
        { kind: "chamfer", distance1: 3, distance2: 8 },
      ];
      const stats = { tried: 0, ok: 0, polylineOk: 0, linePairOk: 0, ms: 0, maxMs: 0 };
      const expectRestored = () => {
        expect(session.canUndo).toBe(false);
        const now = session.document.entities;
        expect(now.length).toBe(count);
        for (let i = 0; i < count; i++) {
          if (now[i] !== original[i]) throw new Error(`Undo で元に戻りません(${i} 番目)`);
        }
      };
      const run = (mode: CornerMode, first: { id: string; point: { x: number; y: number } }, second: { id: string; point: { x: number; y: number } }, added: boolean, kind: "polylineOk" | "linePairOk") => {
        const timed = time(() => cornerAt(session, ALL_EDITABLE, mode, first, second));
        stats.tried++;
        stats.ms += timed.ms;
        stats.maxMs = Math.max(stats.maxMs, timed.ms);
        if (timed.value.ok) {
          stats.ok++;
          stats[kind]++;
          // 折れ線は、置き換えるだけ(図形は増えない)。2本の線は、円弧・面取りの線を1つ足す(半径・距離 0 のときは足さない)
          expect(session.document.entities.length).toBe(count + (added ? 1 : 0));
          expect(session.undo().type).toBe("done");
        }
        expectRestored();
      };
      const mid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      for (const polyline of sampledPolylines) {
        const v = polyline.vertices as Array<{ x: number; y: number }>;
        if (v.length < 3) continue;
        const j = Math.min(v.length - 2, Math.max(1, Math.floor(v.length / 2)));
        for (const mode of modes) run(mode, { id: polyline.id, point: mid(v[j - 1], v[j]) }, { id: polyline.id, point: mid(v[j], v[j + 1]) }, false, "polylineOk");
      }
      for (let i = 0; i + 1 < lines.length; i++) {
        const a = lines[i];
        const b = lines[i + 1];
        for (const mode of modes) run(mode, { id: a.id, point: mid(a.start, a.end) }, { id: b.id, point: mid(b.start, b.end) }, true, "linePairOk");
      }
      const result = { entityCount: count, polylines: sampledPolylines.length, lines: lines.length, ...stats, averageMs: round(stats.tried > 0 ? stats.ms / stats.tried : 0), maxMs: round(stats.maxMs), ms: round(stats.ms) };
      fs.mkdirSync(path.join(REGRESSION_DIR, "perf"), { recursive: true });
      fs.writeFileSync(path.join(REGRESSION_DIR, "perf", `${entry.name}.fillet.json`), JSON.stringify(result, null, 2) + "\n", "utf8");
      console.log(`[fillet perf] ${entry.name}`, JSON.stringify(result));
    }, 900_000);
  }
});
