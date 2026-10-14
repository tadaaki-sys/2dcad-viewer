const NEWLINE = 0x0a;
const CARRIAGE_RETURN = 0x0d;
const SPACE = 0x20;
const TAB = 0x09;

const encode = (text: string) => Uint8Array.from(text, (char) => char.charCodeAt(0));
const SECTION = encode("SECTION");
const ENDSEC = encode("ENDSEC");
const OBJECTS = encode("OBJECTS");
const ZERO = encode("0");
const TWO = encode("2");

/** bytes[start,end)の前後の空白・改行を除いた内容が、asciiと一致するか */
function lineEquals(bytes: Uint8Array, start: number, end: number, ascii: Uint8Array): boolean {
  let s = start;
  let e = end;
  while (s < e && (bytes[s] === SPACE || bytes[s] === TAB)) s++;
  while (e > s && (bytes[e - 1] === SPACE || bytes[e - 1] === TAB || bytes[e - 1] === CARRIAGE_RETURN)) e--;
  if (e - s !== ascii.length) return false;
  for (let i = 0; i < ascii.length; i++) {
    if (bytes[s + i] !== ascii[i]) return false;
  }
  return true;
}

/**
 * DXFのバイト列から OBJECTS セクションを取り除く。
 * ビューアが使わないセクションだが、DWGをLibreDWGで変換すると、空間索引(SPATIAL_INDEX)などで
 * 図形の数十倍(数百MB)になることがあり、そのまま文字列にするとメモリを使い切るため。
 * OBJECTSセクションが見つからない/閉じていない場合は、入力をそのまま返す。
 */
export function stripObjectsSection(bytes: Uint8Array): Uint8Array {
  let position = 0;
  let sectionStart = -1;
  let expectingSectionName = false;
  let objectsStart = -1;

  // コード行と値行を2行ずつ読む。行の境界だけを見て、必要な行以外は文字列化しない
  while (position < bytes.length) {
    const codeStart = position;
    const codeEnd = bytes.indexOf(NEWLINE, codeStart);
    if (codeEnd === -1) break;
    const valueStart = codeEnd + 1;
    let valueEnd = bytes.indexOf(NEWLINE, valueStart);
    if (valueEnd === -1) valueEnd = bytes.length;
    position = valueEnd + 1;

    const isCodeZero = lineEquals(bytes, codeStart, codeEnd, ZERO);
    if (objectsStart === -1) {
      if (isCodeZero && lineEquals(bytes, valueStart, valueEnd, SECTION)) {
        sectionStart = codeStart;
        expectingSectionName = true;
      } else if (expectingSectionName && lineEquals(bytes, codeStart, codeEnd, TWO)) {
        expectingSectionName = false;
        if (lineEquals(bytes, valueStart, valueEnd, OBJECTS)) objectsStart = sectionStart;
      }
    } else if (isCodeZero && lineEquals(bytes, valueStart, valueEnd, ENDSEC)) {
      const objectsEnd = Math.min(position, bytes.length);
      const result = new Uint8Array(objectsStart + (bytes.length - objectsEnd));
      result.set(bytes.subarray(0, objectsStart), 0);
      result.set(bytes.subarray(objectsEnd), objectsStart);
      return result;
    }
  }
  return bytes;
}
