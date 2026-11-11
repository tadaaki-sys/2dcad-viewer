// dxf-parserの図形一覧(raw.entities)と、元のバイト列の記録(DxfRawIndex.entities)を結びつける。
// dxf-parserは、知らない種類の図形(VIEWPORTなど)を黙って捨てるので、番号は一致しない。種類とハンドルで順に突き合わせる。
import { NO_HANDLE, parseHandle, recordType } from "./rawIndex";
import type { DxfRawIndex } from "./rawIndex";
import type { EntityOrigin } from "./origin";

export type ParserEntityRef = { type: string; handle?: string };

/**
 * 解析器の図形i → 記録の位置、の対応(長さは図形の数)。突き合わせに失敗したら null
 * (呼び出し側は、その図面を「編集不可」として扱い、ビューアの表示はそのまま続ける)。
 */
export function mapParserEntitiesToRecords(index: DxfRawIndex, parserEntities: readonly ParserEntityRef[]): Int32Array | null {
  const recordCount = index.recordCount;
  const map = new Int32Array(parserEntities.length);

  let recordPosition = 0;
  for (let i = 0; i < parserEntities.length; i++) {
    const entity = parserEntities[i];
    const entityHandle = entity.handle === undefined ? NO_HANDLE : parseHandle(entity.handle);
    while (recordPosition < recordCount && !recordMatches(index, recordPosition, entity.type, entityHandle)) recordPosition++;
    if (recordPosition >= recordCount) return null;
    map[i] = recordPosition;
    recordPosition++;
  }

  // 安全確認: ある種類について、記録の数と解析器の図形の数が食い違うなら、その種類が「一部だけ捨てられた」ことになり、
  // 取り違えの危険があるので失敗とする。(全部捨てられた種類 = 数が0の種類は、問題ない)
  const recordCounts = new Map<string, number>();
  for (let position = 0; position < recordCount; position++) {
    const type = recordType(index, position);
    recordCounts.set(type, (recordCounts.get(type) ?? 0) + 1);
  }
  const parserCounts = new Map<string, number>();
  for (const entity of parserEntities) parserCounts.set(entity.type, (parserCounts.get(entity.type) ?? 0) + 1);
  for (const [type, parserCount] of parserCounts) {
    if ((recordCounts.get(type) ?? 0) !== parserCount) return null;
  }
  return map;
}

/** 種類が同じで、両方にハンドルがあれば、ハンドルも同じ記録か。ハンドルが読み取れないときは、種類だけで判断する */
function recordMatches(index: DxfRawIndex, position: number, type: string, handle: number): boolean {
  if (recordType(index, position) !== type) return false;
  const recordHandleValue = index.recordHandles[position];
  if (!Number.isNaN(recordHandleValue) && !Number.isNaN(handle)) return recordHandleValue === handle;
  return true;
}

export type SourceClassification = {
  /** 最上位の図形として表示され、編集できる記録の数 */
  editable: number;
  /** ブロック(INSERT・寸法)の記録。展開された中身は読み取り専用 */
  readOnly: number;
  /** 表示できる図形に変換されなかった記録(未対応の図形、解析器が捨てた図形)。元のまま保持される */
  unsupported: number;
  unsupportedByType: Record<string, number>;
};

/** 記録を「編集できる / 読み取り専用 / 未対応」に分類する(要件79) */
export function classifyRecords(index: DxfRawIndex, recordOfParserEntity: Int32Array, origin: EntityOrigin): SourceClassification {
  const direct = new Set<number>();
  const viaBlock = new Set<number>();
  for (let i = 0; i < origin.parserIndex.length; i++) {
    const parserIndex = origin.parserIndex[i];
    if (parserIndex < 0 || parserIndex >= recordOfParserEntity.length) continue;
    (origin.nested[i] === 1 ? viaBlock : direct).add(recordOfParserEntity[parserIndex]);
  }

  const unsupportedByType: Record<string, number> = {};
  let unsupported = 0;
  for (let position = 0; position < index.recordCount; position++) {
    if (direct.has(position) || viaBlock.has(position)) continue;
    unsupported++;
    const type = recordType(index, position);
    unsupportedByType[type] = (unsupportedByType[type] ?? 0) + 1;
  }
  return { editable: direct.size, readOnly: viaBlock.size, unsupported, unsupportedByType };
}
