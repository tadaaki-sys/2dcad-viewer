// 往復テスト(要件93): DXFを開く → 図形を1つ編集 → 保存 → 開き直す → 触っていない図形が1つも変わっていないこと。
import { describe, expect, it } from "vitest";
import { factoryLayoutDxf, unsupportedDxf } from "../../regression/fixtures";
import { applyDxfEdits } from "./patch";
import { addHandles, decode, encode, listRecords, openDxf, padCodes, recordOfEntity, toCrlf, withoutId } from "./testHelpers";
import type { Opened } from "./testHelpers";

/** 同じ図面の、保存形式の違い(ハンドル付き、CRLF、グループコードの桁寄せ)ごとに、同じテストを行う */
const variants: Array<[string, (text: string) => string]> = [
  ["plain", (t) => t],
  ["handles", addHandles],
  ["handles + CRLF + padded codes", (t) => toCrlf(padCodes(addHandles(t)))],
];

/** 描画用モデルの図形のうち、指定した記録から来たもの以外を、順番どおりに(idを除いて)取り出す */
function entitiesExcept(opened: Opened, recordPositions: ReadonlySet<number>) {
  return opened.model.entities.filter((_, i) => !recordPositions.has(recordOfEntity(opened, i))).map(withoutId);
}

/** 最初に見つかる、指定した種類の記録の位置 */
function firstRecord(opened: Opened, type: string): number {
  const position = listRecords(opened.source.index).findIndex((r) => r.type === type);
  expect(position).toBeGreaterThanOrEqual(0);
  return position;
}

describe.each(variants)("round trip of the factory drawing (%s)", (_name, transform) => {
  const opened = openDxf(transform(factoryLayoutDxf()));
  const { bytes, source } = opened;

  it("saving with no edits gives back exactly the same bytes", () => {
    const out = applyDxfEdits(bytes, source.index, {});
    expect(out).toBe(bytes);
    expect(openDxf(decode(out)).model).toEqual(opened.model);
  });

  it("removing one top-level entity leaves every other entity unchanged", () => {
    const target = firstRecord(opened, "LINE");
    const out = applyDxfEdits(bytes, source.index, { remove: new Set([target]) });
    const reopened = openDxf(decode(out));
    expect(reopened.model.entities.map(withoutId)).toEqual(entitiesExcept(opened, new Set([target])));
    expect(reopened.model.entities.length).toBe(opened.model.entities.length - 1);
    expect(reopened.model.layers).toEqual(opened.model.layers);
  });

  it("removing every record in turn changes only what that record produced", () => {
    // 全記録を1つずつ消して確認する(INSERT・寸法を消すと、その展開で作られた図形がまとめて消える)
    listRecords(source.index).forEach((_, target) => {
      const out = applyDxfEdits(bytes, source.index, { remove: new Set([target]) });
      const reopened = openDxf(decode(out));
      expect(reopened.model.entities.map(withoutId)).toEqual(entitiesExcept(opened, new Set([target])));
    });
  });

  it("removing an INSERT removes only the entities it expanded to", () => {
    const target = firstRecord(opened, "INSERT");
    const expandedCount = opened.model.entities.filter((_, i) => recordOfEntity(opened, i) === target).length;
    expect(expandedCount).toBeGreaterThan(0);
    const reopened = openDxf(decode(applyDxfEdits(bytes, source.index, { remove: new Set([target]) })));
    expect(reopened.model.entities.length).toBe(opened.model.entities.length - expandedCount);
  });

  it("replacing one record changes only that entity", () => {
    // 太線の線(終点X=500)を、終点X=650に書き換える
    const target = opened.model.entities.findIndex((e) => e.type === "LINE" && e.lineWeight !== undefined);
    const record = recordOfEntity(opened, target);
    const original = listRecords(source.index)[record];
    const originalText = decode(bytes.subarray(original.start, original.end));
    const eol = source.index.eol;
    const edited = originalText.replace(`11${eol}500`, `11${eol}650`).replace(` 11${eol}500`, ` 11${eol}650`);
    expect(edited).not.toBe(originalText);

    const out = applyDxfEdits(bytes, source.index, { replace: new Map([[record, encode(edited)]]) });
    const reopened = openDxf(decode(out));

    const expected = opened.model.entities.map(withoutId);
    const changed = expected[target] as { end: { x: number } };
    expect(changed.end.x).toBe(500);
    expect((reopened.model.entities[target] as { end: { x: number } }).end.x).toBe(650);
    // それ以外の図形は、すべて同じ
    expect(reopened.model.entities.map(withoutId).filter((_, i) => i !== target)).toEqual(expected.filter((_, i) => i !== target));
  });

  it("applying several edits at once and then editing again keeps the untouched entities intact", () => {
    const records = new Set([firstRecord(opened, "CIRCLE"), firstRecord(opened, "TEXT")]);
    const first = applyDxfEdits(bytes, source.index, { remove: records });
    const reopened = openDxf(decode(first));
    expect(reopened.model.entities.map(withoutId)).toEqual(entitiesExcept(opened, records));

    // 保存したものを開き直して、さらに別の図形を編集する
    const second = applyDxfEdits(reopened.bytes, reopened.source.index, { remove: new Set([firstRecord(reopened, "ARC")]) });
    const reopenedAgain = openDxf(decode(second));
    expect(reopenedAgain.model.entities.map(withoutId)).toEqual(entitiesExcept(reopened, new Set([firstRecord(reopened, "ARC")])));
  });

  it("keeps everything before the first record and the other sections byte for byte", () => {
    const first = listRecords(source.index)[0];
    const out = applyDxfEdits(bytes, source.index, { remove: new Set([listRecords(source.index).length - 1]) });
    expect(out.subarray(0, first.start)).toEqual(bytes.subarray(0, first.start)); // HEADER・TABLES・BLOCKS
    const last = listRecords(source.index)[listRecords(source.index).length - 1];
    expect(out.subarray(last.start)).toEqual(bytes.subarray(last.end)); // ENDSECとEOF
  });
});

describe("unsupported records are never lost", () => {
  it("keeps an unsupported SOLID record intact when another entity is edited", () => {
    const opened = openDxf(addHandles(unsupportedDxf()));
    const lineRecord = listRecords(opened.source.index).findIndex((r) => r.type === "LINE");
    const solidRecord = listRecords(opened.source.index).findIndex((r) => r.type === "SOLID");
    const solidBefore = decode(opened.bytes.subarray(listRecords(opened.source.index)[solidRecord].start, listRecords(opened.source.index)[solidRecord].end));

    const out = applyDxfEdits(opened.bytes, opened.source.index, { remove: new Set([lineRecord]) });
    const reopened = openDxf(decode(out));
    expect(reopened.model.entities).toHaveLength(0);
    expect(listRecords(reopened.source.index).map((r) => r.type)).toEqual(["SOLID"]);
    const solidAfter = decode(reopened.bytes.subarray(listRecords(reopened.source.index)[0].start, listRecords(reopened.source.index)[0].end));
    expect(solidAfter).toBe(solidBefore);
    expect(reopened.model.stats.unsupportedBreakdown).toEqual({ SOLID: 1 });
  });
});
