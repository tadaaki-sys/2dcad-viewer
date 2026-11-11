// 実図面での元データのテスト(手元だけ)。CAD_REGRESSION_REAL=1 のとき、regression-local/manifest.json の図面で
//  - 記録の索引と、解析結果との対応づけが成功すること、分類の合計が合うこと
//  - 保存の往復(1つ編集 → 保存 → 開き直す)で、触っていない図形が1つも変わらないこと
//  - 索引の作成時間とメモリの目安
// を確認する。
import DxfParser from "dxf-parser";
import { describe, expect, it } from "vitest";
import { convertToCadModelWithOrigin } from "../../dxf/DxfParserAdapter";
import { decodeDxfBuffer } from "../../dxf/dxfEncoding";
import { extractLayerStyles } from "../../dxf/layerStyles";
import { REAL_ENABLED, hashEntities, loadDrawing, readManifest } from "../../regression/loadDrawing";
import { applyDxfEdits } from "./patch";
import { buildDxfSource } from "./source";
import { listRecords } from "./testHelpers";

const manifest = REAL_ENABLED ? readManifest() : [];

/** ワーカーと同じ手順で、DXFのバイト列から描画用モデルを作る */
function reopen(bytes: Uint8Array, isDwg: boolean) {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const text = decodeDxfBuffer(buffer);
  const raw = new DxfParser().parseSync(text);
  if (!raw) throw new Error("DXFの解析結果が空です");
  return convertToCadModelWithOrigin(raw, { layerStyles: extractLayerStyles(text), ignoreLayerOffFlag: isDwg }).model;
}

describe.skipIf(!REAL_ENABLED || manifest.length === 0)("real drawings: raw source, mapping and save round trip (local only)", () => {
  for (const entry of manifest) {
    it(`${entry.name}`, async () => {
      const { model, origin, raw, dxfBytes, isDwg } = await loadDrawing(entry.path);

      const heapBefore = process.memoryUsage().heapUsed;
      const started = performance.now();
      const source = buildDxfSource(
        dxfBytes,
        (raw.entities ?? []).map((e) => ({ type: e.type, handle: e.handle === undefined ? undefined : String(e.handle) })),
        origin,
      );
      const buildMs = performance.now() - started;
      const heapMb = (process.memoryUsage().heapUsed - heapBefore) / 1024 / 1024;

      expect(source).not.toBeNull();
      if (!source) return;
      // 突き合わせに成功していること(失敗すると、この図面は編集不可になる)
      expect(source.recordOfParserEntity).not.toBeNull();
      const classification = source.classification!;
      expect(classification.editable + classification.readOnly + classification.unsupported).toBe(listRecords(source.index).length);
      expect(source.recordOfParserEntity!.length).toBe(raw.entities?.length ?? 0);

      console.warn(
        `[source] ${entry.name}: ${(dxfBytes.length / 1024 / 1024).toFixed(1)}MB, ${listRecords(source.index).length} records, build ${buildMs.toFixed(0)}ms, heap +${heapMb.toFixed(1)}MB(目安), ` +
          `editable ${classification.editable} / readOnly ${classification.readOnly} / unsupported ${classification.unsupported} ${JSON.stringify(classification.unsupportedByType)}`,
      );
      expect(buildMs).toBeLessThan(10_000);

      // 差分なしの保存は、元とバイトで同じ
      expect(applyDxfEdits(dxfBytes, source.index, {})).toBe(dxfBytes);

      // 記録 → その記録から作られた図形の位置
      const map = source.recordOfParserEntity!;
      const recordOfEntity = (i: number) => (origin.parserIndex[i] >= 0 ? map[origin.parserIndex[i]] : -1);
      const producedBy = new Map<number, number[]>();
      model.entities.forEach((_, i) => {
        const record = recordOfEntity(i);
        if (!producedBy.has(record)) producedBy.set(record, []);
        producedBy.get(record)!.push(i);
      });
      const direct = [...producedBy.keys()].filter((record) => record >= 0 && model.entities.some((_, i) => recordOfEntity(i) === record && origin.nested[i] === 0)).sort((a, b) => a - b);
      const viaBlock = [...producedBy.keys()].filter((record) => record >= 0 && !direct.includes(record)).sort((a, b) => a - b);
      const unsupported = listRecords(source.index).map((_, position) => position).filter((position) => !producedBy.has(position));

      // 編集して保存し、開き直す。触っていない図形のハッシュが、元(編集した記録の分を除いたもの)と一致すること
      const targets = [
        direct[0],
        direct[Math.floor(direct.length / 2)],
        direct[direct.length - 1],
        viaBlock[0],
        unsupported[0],
      ].filter((position): position is number => position !== undefined);

      for (const target of new Set(targets)) {
        const out = applyDxfEdits(dxfBytes, source.index, { remove: new Set([target]) });
        const reopened = reopen(out, isDwg);
        const expected = model.entities.filter((_, i) => recordOfEntity(i) !== target);
        expect(reopened.entities.length).toBe(expected.length);
        expect(hashEntities(reopened.entities)).toBe(hashEntities(expected));
        expect(reopened.layers).toEqual(model.layers);
      }
    }, 600_000);
  }
});
