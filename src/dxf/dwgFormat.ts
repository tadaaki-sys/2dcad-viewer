const DWG_MAGIC_PATTERN = /^AC10\d\d$/;

const DWG_VERSION_LABELS: Record<string, string> = {
  AC1012: "AutoCAD R13",
  AC1014: "AutoCAD R14",
  AC1015: "AutoCAD 2000",
  AC1018: "AutoCAD 2004",
  AC1021: "AutoCAD 2007",
  AC1024: "AutoCAD 2010",
  AC1027: "AutoCAD 2013",
  AC1032: "AutoCAD 2018",
};

export type DwgVersionInfo = { code: string; label: string };

export function isDwgFileName(fileName: string): boolean {
  return fileName.toLowerCase().endsWith(".dwg");
}

/**
 * ファイル先頭6バイトのバージョン識別子(例: "AC1032")からDWGかどうかを判定する。
 * ASCII DXFの先頭は"  0"や"999"で始まるため、拡張子に頼らず中身で判別できる。
 */
export function detectDwgVersion(buffer: ArrayBuffer): DwgVersionInfo | null {
  if (buffer.byteLength < 6) return null;
  const code = String.fromCharCode(...new Uint8Array(buffer, 0, 6));
  if (!DWG_MAGIC_PATTERN.test(code)) return null;
  return { code, label: DWG_VERSION_LABELS[code] ?? "不明なバージョン" };
}
