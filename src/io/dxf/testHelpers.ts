// io/dxf のテスト用の補助(アプリ本体からは使わない)。
import DxfParser from "dxf-parser";
import { convertToCadModelWithOrigin } from "../../dxf/DxfParserAdapter";
import { extractLayerStyles } from "../../dxf/layerStyles";
import type { CadEntity, CadModel } from "../../types/cad";
import type { EntityOrigin } from "./origin";
import { applyDxfEdits } from "./patch";
import { indexDxf, recordEnd, recordHandle, recordStart, recordType } from "./rawIndex";
import type { DxfRawIndex } from "./rawIndex";
import { buildDxfSource } from "./source";
import type { DxfSource } from "./source";

export const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
export const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

/** 改行をCRLFにする(DXFをWindowsで保存したものの形) */
export const toCrlf = (text: string): string => text.replace(/\r?\n/g, "\r\n");

/** グループコードを3桁に右寄せする(「  0」の形) */
export const padCodes = (text: string): string =>
  text
    .split("\n")
    .map((line, i) => (i % 2 === 0 ? line.padStart(3) : line))
    .join("\n");

/** ENTITIESの各記録に、ハンドル(グループコード5)を連番で付ける。AutoCADが書いたDXFに近い形にする */
export function addHandles(text: string, start = 0x100): string {
  const bytes = encode(text);
  const index = indexDxf(bytes);
  const replace = new Map<number, Uint8Array>();
  for (let position = 0; position < index.recordCount; position++) {
    const lines = decode(bytes.subarray(recordStart(index, position), recordEnd(index, position))).split("\n");
    // 先頭の「0 / 種類」の次に「5 / ハンドル」を差し込む
    lines.splice(2, 0, "5", (start + position).toString(16).toUpperCase());
    replace.set(position, encode(lines.join("\n")));
  }
  return decode(applyDxfEdits(bytes, index, { replace }));
}

export type Opened = {
  text: string;
  bytes: Uint8Array;
  model: CadModel;
  origin: EntityOrigin;
  source: DxfSource;
};

/** 本番のワーカーと同じ手順で、DXFの文字列から、描画用モデルと元データを作る */
export function openDxf(text: string): Opened {
  const raw = new DxfParser().parseSync(text);
  if (!raw) throw new Error("DXFの解析結果が空です");
  const { model, origin } = convertToCadModelWithOrigin(raw, { layerStyles: extractLayerStyles(text) });
  const bytes = encode(text);
  const source = buildDxfSource(
    bytes,
    (raw.entities ?? []).map((e) => ({ type: e.type, handle: e.handle === undefined ? undefined : String(e.handle) })),
    origin,
  );
  if (!source) throw new Error("元データを作れませんでした");
  return { text, bytes, model, origin, source };
}

/** idは読み込みのたびに振り直す連番なので、比較のときは除く */
export function withoutId(entity: CadEntity): unknown {
  const { id: _id, ...rest } = entity;
  void _id;
  return rest;
}

/** 描画用モデルの図形の位置iが、元データのどの記録から来たか。分からなければ-1 */
export function recordOfEntity(opened: Pick<Opened, "source" | "origin">, i: number): number {
  const map = opened.source.recordOfParserEntity;
  const parserIndex = opened.origin.parserIndex[i];
  return map && parserIndex >= 0 ? map[parserIndex] : -1;
}

export type ListedRecord = { type: string; handle: string | null; start: number; end: number };

/** 索引の記録を、読みやすいオブジェクトの一覧にする(テストでの確認用。アプリ本体では作らない) */
export function listRecords(index: DxfRawIndex): ListedRecord[] {
  return Array.from({ length: index.recordCount }, (_, position) => ({
    type: recordType(index, position),
    handle: recordHandle(index, position),
    start: recordStart(index, position),
    end: recordEnd(index, position),
  }));
}
