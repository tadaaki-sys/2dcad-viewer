// 図形ごとの、色・線種・線の太さ・線種尺度の指定(Phase 18。プロパティ欄からの編集)。
// 画面にもファイル形式にも依存しない純粋な処理。図形は書き換えず、新しい図形を返す(変わらなければ、同じ図形)。
//
// 各属性は、「ByLayer」(レイヤーの設定に従う。byLayer の印を立て、解決済みの値をレイヤーから取る)か、
// 「図形自身の指定」(印を外し、指定した値を持つ)のどちらか。
import type { CadEntity, CadLayer, LineDash } from "../../types/cad";
import { BYLAYER_COLOR, BYLAYER_LINETYPE, BYLAYER_LINEWEIGHT, byLayerMaskOf } from "../style/byLayer";
import type { DashFactory } from "../style/lineTypes";
import { THIN_LINE_WEIGHT_LIMIT } from "../style/lineWeight";
import { canHaveLineDash, canHaveLineWeight, entityLineWeightOf, validateLayerColor, validateLayerLineWeight } from "./layerRules";

export const BY_LAYER = "bylayer";
export type ByLayerChoice = typeof BY_LAYER;

/** 図形ごとの線種尺度の範囲 */
export const MIN_ENTITY_LT_SCALE = 1e-6;
export const MAX_ENTITY_LT_SCALE = 1e6;

export type StyleEdit = { ok: true; entity: CadEntity } | { ok: false; error: string };
const fail = (error: string): StyleEdit => ({ ok: false, error });

/** byLayer の印の、あるビットを、立てる・外す(印が0になるときは、項目ごと除く) */
function withMark(entity: CadEntity, bit: number, on: boolean): CadEntity {
  const mask = on ? byLayerMaskOf(entity) | bit : byLayerMaskOf(entity) & ~bit;
  const { byLayer: _old, ...rest } = entity as CadEntity & { byLayer?: number };
  void _old;
  return (mask === 0 ? rest : { ...rest, byLayer: mask }) as CadEntity;
}

function set(entity: CadEntity, patch: Record<string, unknown>, remove: readonly string[] = []): CadEntity {
  const next: Record<string, unknown> = { ...entity, ...patch };
  for (const key of remove) delete next[key];
  return next as CadEntity;
}

/** 色を、ByLayer(レイヤーの色)か、図形自身の色(#rrggbb)にする */
export function withColor(entity: CadEntity, choice: string, layer: CadLayer): StyleEdit {
  if (choice === BY_LAYER) {
    return { ok: true, entity: withMark(set(entity, { color: layer.color }), BYLAYER_COLOR, true) };
  }
  const color = validateLayerColor(choice);
  if (!color.ok) return fail(color.error);
  return { ok: true, entity: withMark(set(entity, { color: color.value }), BYLAYER_COLOR, false) };
}

/** 図形の、図形ごとの線種尺度(持っていなければ 1) */
function ownScaleOf(entity: CadEntity): number {
  const scale = entity.lineTypeScale;
  return typeof scale === "number" && scale > 0 && Number.isFinite(scale) ? scale : 1;
}

/**
 * 線種を、ByLayer(レイヤーの線種)か、図形自身の線種(線種表の名前。CONTINUOUS は実線)にする。
 * 線種を持てない図形(文字・点)は、断る。名前が線種表に無くても、断る(dashes が破線を作れない名前は、実線になるため、呼び出し側が確かめる)。
 */
export function withLineType(entity: CadEntity, choice: string, layer: CadLayer, dashes: DashFactory): StyleEdit {
  if (!canHaveLineDash(entity)) return fail("この図形は、線種を持てません");
  const name = choice === BY_LAYER ? layer.lineType : choice;
  const dash: LineDash | undefined = dashes.make(name, ownScaleOf(entity));
  const next = dash === undefined ? set(entity, {}, ["lineDash"]) : set(entity, { lineDash: dash });
  return { ok: true, entity: withMark(next, BYLAYER_LINETYPE, choice === BY_LAYER) };
}

/** 線の太さを、ByLayer(レイヤーの太さ)か、図形自身の太さ(標準の値。null は既定=細線)にする。持てない図形は、断る */
export function withLineWeight(entity: CadEntity, choice: number | null | typeof BY_LAYER, layer: CadLayer): StyleEdit {
  if (!canHaveLineWeight(entity)) return fail("この図形は、線の太さを持てません");
  if (choice === BY_LAYER) {
    const weight = entityLineWeightOf(layer.lineWeight);
    const next = weight === undefined ? set(entity, {}, ["lineWeight"]) : set(entity, { lineWeight: weight });
    return { ok: true, entity: withMark(next, BYLAYER_LINEWEIGHT, true) };
  }
  let weight: number | undefined;
  if (choice !== null) {
    const checked = validateLayerLineWeight(choice);
    if (!checked.ok) return fail(checked.error);
    // 細線(0.27mm 以下)は、図形に持たない(取り込んだ図形と同じ規則)
    weight = checked.value > THIN_LINE_WEIGHT_LIMIT ? checked.value : undefined;
  }
  const next = weight === undefined ? set(entity, {}, ["lineWeight"]) : set(entity, { lineWeight: weight });
  return { ok: true, entity: withMark(next, BYLAYER_LINEWEIGHT, false) };
}

/**
 * 図形ごとの線種尺度を変える(1 のときは、持たない)。破線が有る図形は、その線種のまま、新しい尺度で作り直す。
 * 線種を持てない図形は、断る。
 */
export function withLineTypeScale(entity: CadEntity, scale: number, dashes: DashFactory): StyleEdit {
  if (!canHaveLineDash(entity)) return fail("この図形は、線種を持てません");
  if (!Number.isFinite(scale) || scale < MIN_ENTITY_LT_SCALE || scale > MAX_ENTITY_LT_SCALE) return fail(`線種尺度は ${MIN_ENTITY_LT_SCALE} 以上 ${MAX_ENTITY_LT_SCALE} 以下の数で指定してください`);
  const dash = entity.type === "TEXT" ? undefined : entity.lineDash;
  let next = scale === 1 ? set(entity, {}, ["lineTypeScale"]) : set(entity, { lineTypeScale: scale });
  if (dash !== undefined) {
    const rebuilt = dashes.make(dash.name, scale);
    if (rebuilt !== undefined) next = set(next, { lineDash: rebuilt });
  }
  return { ok: true, entity: next };
}
