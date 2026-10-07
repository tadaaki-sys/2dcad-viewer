const LAYER_TABLE_START = /^[ \t]*0[ \t]*\r?\n[ \t]*TABLE[ \t]*\r?\n[ \t]*2[ \t]*\r?\n[ \t]*LAYER[ \t]*$/m;

/** レイヤー表に書かれた線種名と線の太さ(1/100mm。-3は既定値)。無ければnull */
export type LayerStyle = {
  lineType: string | null;
  lineWeight: number | null;
};

/**
 * DXFのLAYERテーブルから「レイヤー名 → 線種・線の太さ」を取り出す。
 * dxf-parserはレイヤーの線種(グループコード6)と線の太さ(370)を保持しないため、ByLayerの解決用にここで別途読む。
 * LAYERテーブルはファイル先頭付近にある小さな領域なので、全文を行分割せずその範囲だけを走査する。
 */
export function extractLayerStyles(dxfText: string): Map<string, LayerStyle> {
  const layerStyles = new Map<string, LayerStyle>();

  const start = LAYER_TABLE_START.exec(dxfText);
  if (!start) return layerStyles;
  const end = dxfText.indexOf("ENDTAB", start.index);
  const tableLines = dxfText.slice(start.index, end === -1 ? undefined : end).split(/\r?\n/);

  let currentName: string | null = null;
  let currentLineType: string | null = null;
  let currentLineWeight: number | null = null;
  let inLayerRecord = false;

  const flush = () => {
    if (inLayerRecord && currentName !== null) {
      layerStyles.set(currentName, { lineType: currentLineType, lineWeight: currentLineWeight });
    }
    currentName = null;
    currentLineType = null;
    currentLineWeight = null;
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
    } else if (inLayerRecord && code === "370") {
      const weight = Number(value);
      currentLineWeight = Number.isFinite(weight) ? weight : null;
    }
  }
  flush();

  return layerStyles;
}
