// 新しい図形を描く先(現在のレイヤー)を決める。React にも画面にも依存しない。
import type { CadLayer } from "../../types/cad";
import type { DrawTarget } from "../commands/types";

/** 現在のレイヤーの初期値。レイヤー "0" があればそれ、なければ最初のレイヤー。レイヤーが無ければ null */
export function defaultLayerName(layers: readonly CadLayer[]): string | null {
  return layers.find((layer) => layer.name === "0")?.name ?? layers[0]?.name ?? null;
}

/** 名前を指定したレイヤーに描けるか(寸法スタイルがレイヤーを指定しているとき)。レイヤーが無い・非表示なら、理由を返す */
export function resolveNamedLayerTarget(layers: readonly CadLayer[], name: string): DrawTarget {
  const layer = layers.find((l) => l.name === name);
  if (layer === undefined) return { ok: false, reason: `レイヤー「${name}」がありません。寸法スタイルのレイヤーを直すか、「現在のレイヤー」にしてください` };
  if (!layer.visible) return { ok: false, reason: `レイヤー「${name}」は非表示です。表示するか、寸法スタイルのレイヤーを直してください` };
  return { ok: true, layer: layer.name, color: layer.color };
}

/**
 * 現在のレイヤーから、描く先を決める。描けない場合は、理由を返す(描いても見えない図形を作らないため)。
 * 現在のレイヤーが(図面を開き直したなどで)存在しないときは、初期値を使う。
 */
export function resolveDrawTarget(layers: readonly CadLayer[], currentLayerName: string | null): DrawTarget {
  if (layers.length === 0) return { ok: false, reason: "レイヤーがありません" };
  const layer = layers.find((l) => l.name === currentLayerName) ?? layers.find((l) => l.name === defaultLayerName(layers));
  if (layer === undefined) return { ok: false, reason: "描くレイヤーが決まりません" };
  if (!layer.visible) {
    return { ok: false, reason: `現在のレイヤー「${layer.name}」は非表示です。表示するか、別のレイヤーを現在にしてください` };
  }
  return { ok: true, layer: layer.name, color: layer.color };
}
