// DXFの元のバイト列から、セクションと図形(ENTITIES)の記録の位置を求める。
// 文字コードに依存しないよう、バイトのまま扱う(Shift_JISの後続バイトに0x0A、0x20未満の制御文字は含まれない)。
// 保存のとき、触っていない記録を1バイトも変えずに出力するための索引。
//
// 索引は数値の配列(型付き配列)だけで持つ。記録ごとにオブジェクトを作ると、数万〜数十万個になり、
// ワーカーからメインスレッドへの受け渡し(構造化複製)で読み込みが目に見えて遅くなるため。

const NEWLINE = 0x0a;
const CARRIAGE_RETURN = 0x0d;
const SPACE = 0x20;
const TAB = 0x09;
const DIGIT_ZERO = 0x30;
const DIGIT_TWO = 0x32;
const DIGIT_FIVE = 0x35;

const encode = (text: string) => Uint8Array.from(text, (char) => char.charCodeAt(0));
const SECTION = encode("SECTION");
const ENDSEC = encode("ENDSEC");
const ENTITIES = encode("ENTITIES");

/** 親の記録の一部として扱う種類(旧形式のPOLYLINEの頂点・終端、INSERTの属性) */
const SUB_RECORD_TYPES = new Set(["VERTEX", "SEQEND", "ATTRIB"]);

export const isSubRecordType = (type: string): boolean => SUB_RECORD_TYPES.has(type);

/**
 * 子の記録の並びの状態。DXFの規則は次の2つだけ:
 *   POLYLINE → VERTEX* → SEQEND(SEQENDは必須)
 *   INSERT → ATTRIB+ → SEQEND(属性があるときだけ。属性が無いINSERTには子が無い)
 */
export type SubRecordSequence = {
  readonly parent: "POLYLINE" | "INSERT" | null;
  /** 子の記録が1つ以上あったか */
  readonly hasChildren: boolean;
  /** SEQENDで閉じる必要があるのに、まだ閉じていないか */
  readonly open: boolean;
  /** SEQENDで閉じ終わったか(以降の子は受け付けない) */
  readonly ended: boolean;
};

export const NO_SEQUENCE: SubRecordSequence = { parent: null, hasChildren: false, open: false, ended: false };

/** 最上位の記録の種類から、子の記録の並びの初期状態を作る */
export function sequenceFor(type: string): SubRecordSequence {
  if (type === "POLYLINE") return { parent: "POLYLINE", hasChildren: false, open: true, ended: false };
  if (type === "INSERT") return { parent: "INSERT", hasChildren: false, open: false, ended: false };
  return NO_SEQUENCE;
}

/** 子の記録typeを、今の並びに続けられるか。続けられるなら次の状態、続けられなければnull */
export function acceptSubRecord(sequence: SubRecordSequence, type: string): SubRecordSequence | null {
  if (sequence.parent === null || sequence.ended) return null;
  if (type === "VERTEX" && sequence.parent === "POLYLINE") return { ...sequence, hasChildren: true };
  if (type === "ATTRIB" && sequence.parent === "INSERT") return { ...sequence, hasChildren: true, open: true };
  if (type === "SEQEND" && (sequence.parent === "POLYLINE" || sequence.hasChildren)) {
    return { ...sequence, hasChildren: true, open: false, ended: true };
  }
  return null;
}

/** ハンドルの16進数が、doubleで正確に表せる最大の桁数(13桁 = 52bit) */
const MAX_HANDLE_HEX_DIGITS = 13;
/** ハンドルが無い(または読み取れない)ことを表す値 */
export const NO_HANDLE = Number.NaN;

export type DxfSectionRange = {
  name: string;
  /** セクション先頭(「0 / SECTION」の行の先頭) */
  start: number;
  /** セクション末尾(「0 / ENDSEC」の行の次の位置) */
  end: number;
};

export type DxfRawIndex = {
  byteLength: number;
  /** 行の終わり。保存時に新しい行を足すとき、元と同じにする */
  eol: "\r\n" | "\n";
  sections: DxfSectionRange[];
  /** ENTITIESセクションの最上位の記録の数(モデル空間とペーパー空間の両方。ファイルの順) */
  recordCount: number;
  /** 記録の先頭(「0 / 種類」の行の先頭) */
  recordStarts: Uint32Array;
  /** 記録の末尾(次の記録、または「0 / ENDSEC」の行の先頭)。子の記録(VERTEXなど)を含む */
  recordEnds: Uint32Array;
  /** 記録の種類。typeNamesの添え字(種類の数に上限を設けないよう32bit) */
  recordTypeIds: Uint32Array;
  typeNames: string[];
  /** グループコード5のハンドルを16進数として読んだ値。無い・読み取れない・13桁を超えるときはNO_HANDLE(NaN) */
  recordHandles: Float64Array;
  /** ENTITIESセクションの「0 / ENDSEC」の行の先頭。新しい記録を足す位置。ENTITIESが無ければnull */
  entitiesAppendOffset: number | null;
  /**
   * 構造の問題(最初に見つかったもの)。nullなら問題なし。
   * 問題があっても索引は作るが、記録の境界を信用できないので、この図面は編集不可として扱う。
   */
  malformed: string | null;
};

export const recordStart = (index: DxfRawIndex, position: number): number => index.recordStarts[position];
export const recordEnd = (index: DxfRawIndex, position: number): number => index.recordEnds[position];
export const recordType = (index: DxfRawIndex, position: number): string => index.typeNames[index.recordTypeIds[position]];

/** ハンドルの文字列(16進数)を数値にする。読み取れなければNO_HANDLE */
export function parseHandle(text: string): number {
  const trimmedText = text.trim();
  if (trimmedText.length === 0 || trimmedText.length > MAX_HANDLE_HEX_DIGITS || !/^[0-9a-fA-F]+$/.test(trimmedText)) return NO_HANDLE;
  return parseInt(trimmedText, 16);
}

/** 記録のハンドルを大文字の16進数の文字列で返す。無ければnull(元の書式の大文字・小文字や先頭の0は復元しない) */
export function recordHandle(index: DxfRawIndex, position: number): string | null {
  const value = index.recordHandles[position];
  return Number.isNaN(value) ? null : value.toString(16).toUpperCase();
}

/** bytes[start,end)の先頭の空白・タブを除いた、開始位置 */
function trimStart(bytes: Uint8Array, start: number, end: number): number {
  let s = start;
  while (s < end && (bytes[s] === SPACE || bytes[s] === TAB)) s++;
  return s;
}
/** bytes[start,end)の末尾の空白・タブ・CRを除いた、終了位置 */
function trimEnd(bytes: Uint8Array, start: number, end: number): number {
  let e = end;
  while (e > start && (bytes[e - 1] === SPACE || bytes[e - 1] === TAB || bytes[e - 1] === CARRIAGE_RETURN)) e--;
  return e;
}

function equalsAscii(bytes: Uint8Array, s: number, e: number, ascii: Uint8Array): boolean {
  if (e - s !== ascii.length) return false;
  for (let i = 0; i < ascii.length; i++) if (bytes[s + i] !== ascii[i]) return false;
  return true;
}

function asciiString(bytes: Uint8Array, s: number, e: number): string {
  let text = "";
  for (let i = s; i < e; i++) text += String.fromCharCode(bytes[i]);
  return text;
}

/** 16進数の文字をbytes[s,e)から読む。16進数でない文字がある、または桁が多すぎるときはNO_HANDLE */
function hexValue(bytes: Uint8Array, s: number, e: number): number {
  const length = e - s;
  if (length <= 0 || length > MAX_HANDLE_HEX_DIGITS) return NO_HANDLE;
  let value = 0;
  for (let i = s; i < e; i++) {
    const c = bytes[i];
    let digit: number;
    if (c >= 0x30 && c <= 0x39) digit = c - 0x30;
    else if (c >= 0x41 && c <= 0x46) digit = c - 0x41 + 10;
    else if (c >= 0x61 && c <= 0x66) digit = c - 0x61 + 10;
    else return NO_HANDLE;
    value = value * 16 + digit;
  }
  return value;
}

/**
 * DXFのバイト列を走査して索引を作る。壊れたファイルでも例外は投げず、読み取れた範囲だけを返す
 * (索引が空でも、ビューアの表示には影響しない)。
 */
export function indexDxf(bytes: Uint8Array): DxfRawIndex {
  if (bytes.length > 0xffffffff) throw new Error("ファイルが大きすぎて索引を作れません(4GBを超えています)");

  const sections: DxfSectionRange[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  const typeIds: number[] = [];
  const handles: number[] = [];
  const typeNames: string[] = [];
  const typeIdByName = new Map<string, number>();
  let entitiesAppendOffset: number | null = null;
  let eol: "\r\n" | "\n" = "\n";
  let eolDecided = false;
  let malformed: string | null = null;
  const markMalformed = (reason: string) => {
    if (malformed === null) malformed = reason;
  };

  let position = 0;
  let sectionName: string | null = null;
  let sectionStart = -1;
  let expectingSectionName = false;
  let inEntities = false;
  let entitiesSeen = false;
  let current = -1; // 現在の記録の位置(starts/ends/... の添え字)。無ければ-1
  let currentType: string | null = null;
  let sequence: SubRecordSequence = NO_SEQUENCE;

  /** 現在の記録を閉じる。子の記録の並び(POLYLINEのSEQENDなど)が終わっていなければ、構造の問題として記録する */
  const closeCurrent = (end: number) => {
    if (current < 0) return;
    ends[current] = end;
    if (sequence.open) markMalformed(`${currentType} の子の記録が SEQEND で終わっていません(記録 ${current})`);
    current = -1;
    currentType = null;
    sequence = NO_SEQUENCE;
  };

  const startRecord = (codeStart: number, type: string) => {
    closeCurrent(codeStart);
    let typeId = typeIdByName.get(type);
    if (typeId === undefined) {
      typeId = typeNames.length;
      typeNames.push(type);
      typeIdByName.set(type, typeId);
    }
    current = starts.length;
    currentType = type;
    sequence = sequenceFor(type);
    starts.push(codeStart);
    ends.push(bytes.length);
    typeIds.push(typeId);
    handles.push(NO_HANDLE);
  };

  while (position < bytes.length) {
    const codeStart = position;
    const codeEnd = bytes.indexOf(NEWLINE, codeStart);
    if (codeEnd === -1) {
      // 最後のグループコードの行に、値の行が無い(空白だけなら、ファイル末尾の余白として許す)
      if (trimEnd(bytes, codeStart, bytes.length) > trimStart(bytes, codeStart, bytes.length)) markMalformed("ファイルが行の途中で終わっています");
      break;
    }
    if (!eolDecided) {
      eol = codeEnd > codeStart && bytes[codeEnd - 1] === CARRIAGE_RETURN ? "\r\n" : "\n";
      eolDecided = true;
    }
    const valueStart = codeEnd + 1;
    if (valueStart >= bytes.length) {
      markMalformed("グループコードに対応する値の行がありません");
      break;
    }
    let valueEnd = bytes.indexOf(NEWLINE, valueStart);
    if (valueEnd === -1) valueEnd = bytes.length;
    position = Math.min(valueEnd + 1, bytes.length);

    // グループコードの行を、1度だけ前後の空白を除いて見る(ほとんどの行は、数字1〜3桁)
    const cs = trimStart(bytes, codeStart, codeEnd);
    const ce = trimEnd(bytes, cs, codeEnd);
    const codeLength = ce - cs;
    const codeByte = codeLength === 1 ? bytes[cs] : 0;

    if (codeByte === DIGIT_ZERO) {
      const vs = trimStart(bytes, valueStart, valueEnd);
      const ve = trimEnd(bytes, vs, valueEnd);

      if (equalsAscii(bytes, vs, ve, SECTION)) {
        if (inEntities) markMalformed("ENTITIES セクションが ENDSEC で閉じられる前に、次の SECTION が始まっています");
        closeCurrent(codeStart);
        inEntities = false;
        sectionStart = codeStart;
        expectingSectionName = true;
        sectionName = null;
        continue;
      }
      if (equalsAscii(bytes, vs, ve, ENDSEC)) {
        closeCurrent(codeStart);
        if (inEntities) entitiesAppendOffset = codeStart;
        if (sectionName !== null && sectionStart >= 0) sections.push({ name: sectionName, start: sectionStart, end: position });
        inEntities = false;
        sectionName = null;
        sectionStart = -1;
        continue;
      }
      if (inEntities) {
        const type = asciiString(bytes, vs, ve);
        if (isSubRecordType(type)) {
          const next = current >= 0 ? acceptSubRecord(sequence, type) : null;
          if (next) {
            sequence = next; // 親の記録の一部として、終わりは次の記録まで延ばす
            continue;
          }
          // 親が受け付けない子の記録(LINEの後のATTRIBなど)は、ほかの記録に吸収させず、独立した記録として残す
          markMalformed(`${current >= 0 ? currentType : "(先頭)"} の後に、続けられない ${type} があります`);
        }
        startRecord(codeStart, type);
      }
      continue;
    }

    if (expectingSectionName && codeByte === DIGIT_TWO) {
      const vs = trimStart(bytes, valueStart, valueEnd);
      const ve = trimEnd(bytes, vs, valueEnd);
      sectionName = asciiString(bytes, vs, ve);
      expectingSectionName = false;
      inEntities = equalsAscii(bytes, vs, ve, ENTITIES);
      if (inEntities) {
        if (entitiesSeen) markMalformed("ENTITIES セクションが2つあります");
        entitiesSeen = true;
      }
      continue;
    }

    // 記録自身のハンドル(子の記録に入る前の、最初のグループコード5)
    if (codeByte === DIGIT_FIVE && inEntities && current >= 0 && !sequence.hasChildren && Number.isNaN(handles[current])) {
      const vs = trimStart(bytes, valueStart, valueEnd);
      const ve = trimEnd(bytes, vs, valueEnd);
      handles[current] = hexValue(bytes, vs, ve);
    }
  }

  // 閉じていない記録(ENDSECが無い壊れたファイル)は、ファイルの末尾までとする
  if (current >= 0) {
    ends[current] = bytes.length;
    if (sequence.open) markMalformed(`${currentType} の子の記録が SEQEND で終わっていません(記録 ${current})`);
  }
  if (inEntities) markMalformed("ENTITIES セクションが ENDSEC で閉じられていません");
  if (!entitiesSeen) markMalformed("ENTITIES セクションがありません");

  return {
    byteLength: bytes.length,
    eol,
    sections,
    recordCount: starts.length,
    recordStarts: Uint32Array.from(starts),
    recordEnds: Uint32Array.from(ends),
    recordTypeIds: Uint32Array.from(typeIds),
    typeNames,
    recordHandles: Float64Array.from(handles),
    entitiesAppendOffset,
    malformed,
  };
}
