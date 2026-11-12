// 読み込んだDXFの「元データ」。元のバイト列、記録の索引、解析結果との対応表をまとめて持つ。
// ビューアの表示には使わない。将来の保存(Phase 21・22)で、触っていない記録を元のまま出力するために保持する。
import { classifyRecords, mapParserEntitiesToRecords } from "./originMap";
import type { ParserEntityRef, SourceClassification } from "./originMap";
import type { EntityOrigin } from "./origin";
import { indexDxf } from "./rawIndex";
import type { DxfRawIndex } from "./rawIndex";

export type DxfSource = {
  /** 元のバイト列(DWGから変換した場合は、変換後のDXF)。変更しない */
  bytes: Uint8Array;
  index: DxfRawIndex;
  /** 解析器の図形i → 記録の位置。突き合わせに失敗したらnull(この図面は編集不可として扱う) */
  recordOfParserEntity: Int32Array | null;
  origin: EntityOrigin;
  /** 記録の分類。対応表が無い(null)ときは、分類もnull */
  classification: SourceClassification | null;
};

/**
 * 元データを作る。索引作りで予期しない例外が出ても、ビューアの表示を止めないよう、nullを返す
 * (呼び出し側は、元データ無し=編集不可として扱う)。
 */
export function buildDxfSource(bytes: Uint8Array, parserEntities: readonly ParserEntityRef[], origin: EntityOrigin): DxfSource | null {
  try {
    const index = indexDxf(bytes);
    // 構造に問題がある図面は、記録の境界を信用できないので対応づけをしない(=編集不可。表示はそのまま)
    const recordOfParserEntity = index.malformed === null ? mapParserEntitiesToRecords(index, parserEntities) : null;
    const classification = recordOfParserEntity ? classifyRecords(index, recordOfParserEntity, origin) : null;
    return { bytes, index, recordOfParserEntity, origin, classification };
  } catch (error) {
    console.warn("[dxf source] 元データの索引を作れませんでした。編集は無効になります", error);
    return null;
  }
}

/** ワーカーからメインスレッドへ、コピーせずに渡すバッファの一覧 */
export function transferablesOf(source: DxfSource): ArrayBuffer[] {
  const { index, origin } = source;
  const buffers: ArrayBuffer[] = [
    source.bytes.buffer as ArrayBuffer,
    origin.parserIndex.buffer as ArrayBuffer,
    origin.nested.buffer as ArrayBuffer,
    index.recordStarts.buffer as ArrayBuffer,
    index.recordEnds.buffer as ArrayBuffer,
    index.recordTypeIds.buffer as ArrayBuffer,
    index.recordHandles.buffer as ArrayBuffer,
  ];
  if (source.recordOfParserEntity) buffers.push(source.recordOfParserEntity.buffer as ArrayBuffer);
  return Array.from(new Set(buffers));
}

/** 画面(開発用の表示)に出す、元データの要約 */
export type SourceSummary = {
  byteLength: number;
  recordCount: number;
  /** 解析結果との対応づけに成功したか。falseなら、この図面は編集不可 */
  mapped: boolean;
  editable: number;
  readOnly: number;
  unsupported: number;
};

export function summarizeSource(source: DxfSource | null): SourceSummary | null {
  if (!source) return null;
  return {
    byteLength: source.bytes.length,
    recordCount: source.index.recordCount,
    mapped: source.recordOfParserEntity !== null,
    editable: source.classification?.editable ?? 0,
    readOnly: source.classification?.readOnly ?? 0,
    unsupported: source.classification?.unsupported ?? 0,
  };
}
