// ByLayer の印(ビット)。立っている属性は、レイヤーの設定に従う。意味は types/cad.ts の EntityExtras.byLayer を参照。
export const BYLAYER_COLOR = 1;
export const BYLAYER_LINETYPE = 2;
export const BYLAYER_LINEWEIGHT = 4;
/** 色・線種・線の太さを、すべてレイヤーに従わせる(新しく描く図形の既定) */
export const BYLAYER_ALL = BYLAYER_COLOR | BYLAYER_LINETYPE | BYLAYER_LINEWEIGHT;

/** 印の値として正しいか(0〜7 の整数)。正しくない値は、印なし(0)として扱う */
export function byLayerMaskOf(entity: { byLayer?: number }): number {
  const mask = entity.byLayer;
  return typeof mask === "number" && Number.isInteger(mask) && mask > 0 && mask <= BYLAYER_ALL ? mask : 0;
}

export function followsLayer(entity: { byLayer?: number }, bit: number): boolean {
  return (byLayerMaskOf(entity) & bit) !== 0;
}
