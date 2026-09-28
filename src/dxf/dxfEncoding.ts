// DXF R2007(AC1021)以降はASCII DXF本文が常にUTF-8。
// それより古いバージョンは$DWGCODEPAGEで指定されたコードページ(Shift-JIS等)でテキストが書かれている。
const UTF8_MIN_VERSION_NUMBER = 1021;

const CODEPAGE_TO_ENCODING: Record<string, string> = {
  ANSI_932: "shift-jis",
  ANSI_936: "gbk",
  ANSI_949: "euc-kr",
  ANSI_950: "big5",
  ANSI_1250: "windows-1250",
  ANSI_1251: "windows-1251",
  ANSI_1252: "windows-1252",
  ANSI_1253: "windows-1253",
  ANSI_1254: "windows-1254",
  ANSI_1255: "windows-1255",
  ANSI_1256: "windows-1256",
  ANSI_1257: "windows-1257",
  ANSI_1258: "windows-1258",
};

/**
 * DXFファイル先頭のHEADERセクションは常にASCII互換のため、latin1で安全に走査して
 * $ACADVER / $DWGCODEPAGE を読み取り、本文をデコードすべき文字コードを判定する。
 */
export function detectDxfTextEncoding(buffer: ArrayBuffer): string {
  const probe = new TextDecoder("latin1").decode(buffer.slice(0, 4096));

  const versionMatch = probe.match(/\$ACADVER[\s\S]{0,20}?AC(\d{4})/);
  const versionNumber = versionMatch ? parseInt(versionMatch[1], 10) : Number.POSITIVE_INFINITY;
  if (versionNumber >= UTF8_MIN_VERSION_NUMBER) {
    return "utf-8";
  }

  const codepageMatch = probe.match(/\$DWGCODEPAGE[\s\S]{0,20}?(ANSI_\d+)/);
  const codepage = codepageMatch?.[1];
  if (codepage && CODEPAGE_TO_ENCODING[codepage]) {
    return CODEPAGE_TO_ENCODING[codepage];
  }

  return "utf-8";
}

export function decodeDxfBuffer(buffer: ArrayBuffer): string {
  const encoding = detectDxfTextEncoding(buffer);
  try {
    return new TextDecoder(encoding).decode(buffer);
  } catch {
    return new TextDecoder("utf-8").decode(buffer);
  }
}
