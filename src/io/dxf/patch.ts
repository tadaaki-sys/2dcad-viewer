// DXFの元のバイト列に、図形の記録の差し替え・削除だけを適用して、新しいバイト列を作る。
// 触っていない記録・未対応の図形・ほかのセクションは、1バイトも変えずに出力される(要件17・79・80)。
import type { DxfRawIndex } from "./rawIndex";

export type DxfEdits = {
  /** 記録の位置(DxfRawIndex.entities内の番号) → 差し替える記録のバイト列(「0 / 種類」から始まる完全な記録) */
  replace?: ReadonlyMap<number, Uint8Array>;
  /** 削除する記録の位置 */
  remove?: ReadonlySet<number>;
};

const NEWLINE = 0x0a;
const CARRIAGE_RETURN = 0x0d;
const SPACE = 0x20;
const TAB = 0x09;
const ZERO = 0x30;

/** 差し替える記録が「グループコード0」の行から始まる、正しい形かを確かめる */
function startsWithGroupZero(record: Uint8Array): boolean {
  let i = 0;
  while (i < record.length && (record[i] === SPACE || record[i] === TAB)) i++;
  if (record[i] !== ZERO) return false;
  i++;
  while (i < record.length && (record[i] === SPACE || record[i] === TAB || record[i] === CARRIAGE_RETURN)) i++;
  return record[i] === NEWLINE;
}

/**
 * editsを適用した新しいバイト列を返す。editsが空なら、元のbytesをそのまま(同じオブジェクトで)返す。
 * 範囲外の位置、同じ記録への差し替えと削除の重複、不正な形の差し替えは、データ破損を避けるためエラーにする。
 */
export function applyDxfEdits(bytes: Uint8Array, index: DxfRawIndex, edits: DxfEdits): Uint8Array {
  const replace = edits.replace ?? new Map<number, Uint8Array>();
  const remove = edits.remove ?? new Set<number>();
  if (replace.size === 0 && remove.size === 0) return bytes;
  if (bytes.length !== index.byteLength) throw new Error("索引が、このバイト列のものではありません(長さが違います)");

  const touched = new Set<number>();
  for (const position of [...replace.keys(), ...remove]) {
    if (!Number.isInteger(position) || position < 0 || position >= index.recordCount) throw new Error(`記録の位置が範囲外です: ${position}`);
    if (touched.has(position)) throw new Error(`同じ記録に、差し替えと削除、または重複した編集があります: ${position}`);
    touched.add(position);
  }
  for (const [position, record] of replace) {
    if (!startsWithGroupZero(record)) throw new Error(`差し替える記録が、グループコード0の行から始まっていません: ${position}`);
  }

  const eolBytes = index.eol === "\r\n" ? Uint8Array.of(CARRIAGE_RETURN, NEWLINE) : Uint8Array.of(NEWLINE);
  const ordered = [...touched].sort((a, b) => a - b);

  // 変更しない区間はそのまま、変更する記録の位置だけを置き換える
  const chunks: Uint8Array[] = [];
  let cursor = 0;
  for (const position of ordered) {
    chunks.push(bytes.subarray(cursor, index.recordStarts[position]));
    const replacement = replace.get(position);
    if (replacement) {
      chunks.push(replacement);
      // 差し替えの末尾に改行が無ければ足す(次の記録の先頭と、行がつながらないように)
      if (replacement.length > 0 && replacement[replacement.length - 1] !== NEWLINE) chunks.push(eolBytes);
    }
    cursor = index.recordEnds[position];
  }
  chunks.push(bytes.subarray(cursor));

  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}
