// DXFの元のバイト列に、図形の記録の差し替え・削除だけを適用して、新しいバイト列を作る。
// 触っていない記録・未対応の図形・ほかのセクションは、1バイトも変えずに出力される(要件17・79・80)。
// データ破損を防ぐため、少しでも怪しい入力(構造に問題がある図面、合わない索引、不完全な差し替え)はエラーにして止める。
import { acceptSubRecord, applyOwnGroup, computeContentHash, isSubRecordType, parseGroupCode, recordType, sequenceFor } from "./rawIndex";
import type { DxfRawIndex } from "./rawIndex";

export type DxfEdits = {
  /** 記録の位置(索引の記録の番号) → 差し替える記録のバイト列(「0 / 種類」から始まる、完全な最上位の記録1つ) */
  replace?: ReadonlyMap<number, Uint8Array>;
  /** 削除する記録の位置 */
  remove?: ReadonlySet<number>;
};

/** 差分を適用する対象。元のバイト列と、そのバイト列から作った索引の組(DxfSourceをそのまま渡せる) */
export type DxfPatchTarget = {
  readonly bytes: Uint8Array;
  readonly index: DxfRawIndex;
};

const NEWLINE = 0x0a;
const CARRIAGE_RETURN = 0x0d;
const SPACE = 0x20;
const TAB = 0x09;

/** 図形の記録として差し替えてはいけない、構造の記録の種類 */
const STRUCTURAL_TYPES = new Set(["SECTION", "ENDSEC", "EOF", "TABLE", "ENDTAB", "BLOCK", "ENDBLK", "CLASS"]);
const RECORD_TYPE_PATTERN = /^[A-Z0-9_$]+$/;

/** バイト列を行に分ける(各行の前後の空白・CRは除く)。ASCIIとして読むのは、グループコードと種類の行だけ */
function splitLines(bytes: Uint8Array): Array<[number, number]> {
  const lines: Array<[number, number]> = [];
  let start = 0;
  while (start < bytes.length) {
    let end = bytes.indexOf(NEWLINE, start);
    if (end === -1) end = bytes.length;
    let s = start;
    let e = end;
    while (s < e && (bytes[s] === SPACE || bytes[s] === TAB)) s++;
    while (e > s && (bytes[e - 1] === SPACE || bytes[e - 1] === TAB || bytes[e - 1] === CARRIAGE_RETURN)) e--;
    lines.push([s, e]);
    start = end + 1;
  }
  return lines;
}

function ascii(bytes: Uint8Array, [s, e]: [number, number]): string {
  let text = "";
  for (let i = s; i < e; i++) text += String.fromCharCode(bytes[i]);
  return text;
}

/**
 * 差し替える記録が、完全な最上位の記録ちょうど1つかを確かめる。問題があれば理由を返す(無ければnull)。
 * 確かめること: グループコードと値の対になっている、先頭が図形の種類、構造の記録(ENDSECなど)を含まない、
 * 子の記録(VERTEX・ATTRIB・SEQEND)は親が受け付けるものだけで、必要なSEQENDで閉じている。
 */
export function validateRecordBytes(record: Uint8Array): string | null {
  const lines = splitLines(record);
  if (lines.length < 2) return "記録が短すぎます(グループコードと値の対がありません)";
  if (lines.length % 2 !== 0) return "グループコードと値の行が対になっていません";

  let sequence = sequenceFor("");
  for (let i = 0; i < lines.length; i += 2) {
    const codeText = ascii(record, lines[i]);
    // 索引と同じ解釈で、整数として読む(「00」「-0」も0。文字列の"0"だけを見ると、別表記で検証をすり抜けられる)
    const code = parseGroupCode(codeText);
    if (Number.isNaN(code)) return `グループコードが整数ではありません: ${codeText}`;
    if (code !== 0) {
      if (i === 0) return "記録が、グループコード0の行から始まっていません";
      sequence = applyOwnGroup(sequence, code, ascii(record, lines[i + 1]));
      continue;
    }
    const type = ascii(record, lines[i + 1]);
    if (i === 0) {
      if (!RECORD_TYPE_PATTERN.test(type)) return `図形の種類として正しくありません: ${type}`;
      if (STRUCTURAL_TYPES.has(type)) return `構造の記録(${type})は図形として差し替えられません`;
      if (isSubRecordType(type)) return `子の記録(${type})を最上位の記録として差し替えることはできません`;
      sequence = sequenceFor(type);
      continue;
    }
    const next = acceptSubRecord(sequence, type);
    if (!next) return `記録の途中に、続けられない ${type} があります(1つの記録だけを差し替えてください)`;
    sequence = next;
  }
  if (sequence.open) return "子の記録が SEQEND で閉じていません";
  return null;
}

/** 索引が指す記録の先頭が、本当に「0 / その種類」になっているか(索引とバイト列の取り違えを見つける) */
function recordHeadMatches(bytes: Uint8Array, index: DxfRawIndex, position: number): boolean {
  const start = index.recordStarts[position];
  const end = index.recordEnds[position];
  if (!(start < end && end <= bytes.length)) return false;
  const head = splitLines(bytes.subarray(start, Math.min(end, start + 512)));
  return head.length >= 2 && ascii(bytes.subarray(start), head[0]) === "0" && ascii(bytes.subarray(start), head[1]) === recordType(index, position);
}

/**
 * editsを適用した新しいバイト列を返す。editsが空なら、元のbytesをそのまま(同じオブジェクトで)返す。
 * 次の場合は、データ破損を避けるためエラーにする:
 *   構造に問題がある図面、索引がこのバイト列のものではない、範囲外の位置、同じ記録への重複した編集、不完全な差し替え。
 */
export function applyDxfEdits(target: DxfPatchTarget, edits: DxfEdits): Uint8Array {
  const { bytes, index } = target;
  const replace = edits.replace ?? new Map<number, Uint8Array>();
  const remove = edits.remove ?? new Set<number>();
  if (replace.size === 0 && remove.size === 0) return bytes;
  if (index.malformed !== null) throw new Error(`構造に問題がある図面は編集できません: ${index.malformed}`);
  if (bytes.length !== index.byteLength) throw new Error("索引が、このバイト列のものではありません(長さが違います)");
  // 長さと先頭が同じでも、中身(記録の境界)が違う別のバイト列を取り違えないよう、内容全体の指紋を照合する
  const hash = computeContentHash(bytes);
  if (hash[0] !== index.contentHash[0] || hash[1] !== index.contentHash[1]) {
    throw new Error("索引が、このバイト列のものではありません(内容が違います)");
  }

  const touched = new Set<number>();
  for (const position of [...replace.keys(), ...remove]) {
    if (!Number.isInteger(position) || position < 0 || position >= index.recordCount) throw new Error(`記録の位置が範囲外です: ${position}`);
    if (touched.has(position)) throw new Error(`同じ記録に、差し替えと削除、または重複した編集があります: ${position}`);
    if (!recordHeadMatches(bytes, index, position)) throw new Error(`索引が、このバイト列のものではありません(記録 ${position} の先頭が一致しません)`);
    touched.add(position);
  }
  for (const [position, record] of replace) {
    const problem = validateRecordBytes(record);
    if (problem) throw new Error(`差し替える記録 ${position} が正しくありません: ${problem}`);
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
