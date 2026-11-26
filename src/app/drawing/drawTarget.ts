// 新しい図形を描く先(現在のレイヤー)を決める。React にも画面にも依存しない。
import { layerAppearance } from "../../core/layer/layerRules";
import { BYLAYER_ALL } from "../../core/style/byLayer";
import { buildLineTypeTable, createDashFactory } from "../../core/style/lineTypes";
import type { DashFactory } from "../../core/style/lineTypes";
import type { CadLayer } from "../../types/cad";
import type { DrawTarget } from "../commands/types";

/** 標準の線種だけの、既定の破線の入れ物(図面の線種表が分からない呼び出し用) */
const DEFAULT_DASHES: DashFactory = createDashFactory(buildLineTypeTable([]), 1);

/** レイヤーの設定(色・線種・線の太さ)に従う、新しい図形の描く先。色・線種・線の太さは、解決済みの値で、byLayer がそれに従う印 */
function targetOf(layer: CadLayer, dashes: DashFactory): DrawTarget {
  return { ok: true, layer: layer.name, ...layerAppearance(layer, dashes), byLayer: BYLAYER_ALL };
}

/** 現在のレイヤーの初期値。レイヤー "0" があればそれ、なければ最初のレイヤー。レイヤーが無ければ null */
export function defaultLayerName(layers: readonly CadLayer[]): string | null {
  return layers.find((layer) => layer.name === "0")?.name ?? layers[0]?.name ?? null;
}

/** 名前を指定したレイヤーに描けるか(寸法スタイルがレイヤーを指定しているとき)。レイヤーが無い・非表示なら、理由を返す */
export function resolveNamedLayerTarget(layers: readonly CadLayer[], name: string, dashes: DashFactory = DEFAULT_DASHES): DrawTarget {
  const layer = layers.find((l) => l.name === name);
  if (layer === undefined) return { ok: false, reason: `レイヤー「${name}」がありません。寸法スタイルのレイヤーを直すか、「現在のレイヤー」にしてください` };
  if (!layer.visible) return { ok: false, reason: `レイヤー「${name}」は非表示です。表示するか、寸法スタイルのレイヤーを直してください` };
  return targetOf(layer, dashes);
}

/**
 * 現在のレイヤーから、描く先を決める。描けない場合は、理由を返す(描いても見えない図形を作らないため)。
 * 現在のレイヤーが(図面を開き直したなどで)存在しないときは、初期値を使う。
 */
export function resolveDrawTarget(layers: readonly CadLayer[], currentLayerName: string | null, dashes: DashFactory = DEFAULT_DASHES): DrawTarget {
  if (layers.length === 0) return { ok: false, reason: "レイヤーがありません" };
  const layer = layers.find((l) => l.name === currentLayerName) ?? layers.find((l) => l.name === defaultLayerName(layers));
  if (layer === undefined) return { ok: false, reason: "描くレイヤーが決まりません" };
  if (!layer.visible) {
    return { ok: false, reason: `現在のレイヤー「${layer.name}」は非表示です。表示するか、別のレイヤーを現在にしてください` };
  }
  return targetOf(layer, dashes);
}
