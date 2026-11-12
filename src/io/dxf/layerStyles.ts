const LAYER_TABLE_START = /^[ \t]*0[ \t]*\r?\n[ \t]*TABLE[ \t]*\r?\n[ \t]*2[ \t]*\r?\n[ \t]*LAYER[ \t]*$/m;

const LAYER_TABLE_END = /^[ \t]*0[ \t]*\r?\n[ \t]*ENDTAB[ \t]*$/m;

/**
 * レイヤー表に書かれた線種名・線の太さ(1/100mm。-3は既定値)・表示状態。
 * offは色番号(62)が負(レイヤーOFF)、frozenは状態フラグ(70)のビット1(フリーズ)。
 */
export type LayerStyle = {
  lineType: string | null;
  lineWeight: number | null;
  off: boolean;
  frozen: boolean;
};

/**
 * DXFのLAYERテーブルから「レイヤー名 → 線種・線の太さ・表示状態」を取り出す。
 * dxf-parserはレイヤーの線種(グループコード6)と線の太さ(370)を保持しないため、ByLayerの解決用にここで別途読む。表示状態もここで読む(dxf-parserは状態フラグのビット2も「フリーズ」とみなすため)。
 * LAYERテーブルはファイル先頭付近にある小さな領域なので、全文を行分割せずその範囲だけを走査する。
 */
export function extractLayerStyles(dxfText: string): Map<string, LayerStyle> {
  const layerStyles = new Map<string, LayerStyle>();

  const start = LAYER_TABLE_START.exec(dxfText);
  if (!start) return layerStyles;
  // 「0 / ENDTAB」の組だけを表の終わりとみなす(レイヤー名などの値に"ENDTAB"を含んでいても途切れさせない)
  const endMatch = LAYER_TABLE_END.exec(dxfText.slice(start.index));
  const tableLines = dxfText.slice(start.index, endMatch ? start.index + endMatch.index : undefined).split(/\r?\n/);

  let currentName: string | null = null;
  let currentLineType: string | null = null;
  let currentLineWeight: number | null = null;
  let currentOff = false;
  let currentFrozen = false;
  let inLayerRecord = false;

  const flush = () => {
    if (inLayerRecord && currentName !== null) {
      layerStyles.set(currentName, { lineType: currentLineType, lineWeight: currentLineWeight, off: currentOff, frozen: currentFrozen });
    }
    currentName = null;
    currentLineType = null;
    currentLineWeight = null;
    currentOff = false;
    currentFrozen = false;
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
    } else if (inLayerRecord && code === "62") {
      currentOff = Number(value) < 0;
    } else if (inLayerRecord && code === "70") {
      currentFrozen = (Number(value) & 1) !== 0;
    } else if (inLayerRecord && code === "370") {
      const weight = Number(value);
      currentLineWeight = Number.isFinite(weight) ? weight : null;
    }
  }
  flush();

  return layerStyles;
}
