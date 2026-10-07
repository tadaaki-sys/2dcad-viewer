const LAYER_TABLE_START = /^[ \t]*0[ \t]*\r?\n[ \t]*TABLE[ \t]*\r?\n[ \t]*2[ \t]*\r?\n[ \t]*LAYER[ \t]*$/m;

/**
 * DXFのLAYERテーブルから「レイヤー名 → 線種名」を取り出す。
 * dxf-parserはレイヤーの線種(グループコード6)を保持しないため、ByLayerの線種を解決するのにここで別途読む。
 * LAYERテーブルはファイル先頭付近にある小さな領域なので、全文を行分割せずその範囲だけを走査する。
 */
export function extractLayerLineTypes(dxfText: string): Map<string, string> {
  const layerLineTypes = new Map<string, string>();

  const start = LAYER_TABLE_START.exec(dxfText);
  if (!start) return layerLineTypes;
  const end = dxfText.indexOf("ENDTAB", start.index);
  const tableLines = dxfText.slice(start.index, end === -1 ? undefined : end).split(/\r?\n/);

  let currentName: string | null = null;
  let currentLineType: string | null = null;
  let inLayerRecord = false;

  const flush = () => {
    if (inLayerRecord && currentName !== null && currentLineType !== null) {
      layerLineTypes.set(currentName, currentLineType);
    }
    currentName = null;
    currentLineType = null;
  };

  for (let i = 0; i + 1 < tableLines.length; i += 2) {
    const code = tableLines[i].trim();
    const value = tableLines[i + 1].trim();
    if (code === "0") {
      flush();
      inLayerRecord = value === "LAYER";
    } else if (inLayerRecord && code === "2") {
      currentName = value;
    } else if (inLayerRecord && code === "6") {
      currentLineType = value;
    }
  }
  flush();

  return layerLineTypes;
}
