// レイヤーの決まり(名前・色・線種・線の太さの検証)と、レイヤーの設定に従う図形(ByLayer)の見た目の計算。
// 画面にもファイル形式にも依存しない純粋な処理(図形は書き換えず、新しい図形を返す)。Phase 17。
import type { CadEntity, CadLayer, CadLineType, LineDash } from "../../types/cad";
import { BYLAYER_ALL, BYLAYER_COLOR, BYLAYER_LINETYPE, BYLAYER_LINEWEIGHT, byLayerMaskOf } from "../style/byLayer";
import { entityDashScaleOf, lineTypeKeyOf } from "../style/lineTypes";
import type { DashFactory } from "../style/lineTypes";
import { THIN_LINE_WEIGHT_LIMIT, isStandardLineWeight } from "../style/lineWeight";

export const MAX_LAYER_NAME_LENGTH = 255;

/** DXF のレイヤー名に使えない文字(< > / \ " : ; ? * | = `)と、制御文字 */
// eslint-disable-next-line no-control-regex
const FORBIDDEN_LAYER_NAME = /[<>/\\":;?*|=`\u0000-\u001f\u007f]/;

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * レイヤー名の検証。前後の空白は取る。同じ名前(大文字小文字は区別しない)のレイヤーがあれば断る。
 * renaming は、名前を変えるレイヤー自身の名前(自分自身との重複は許す)。
 */
export function validateLayerName(name: string, layers: readonly CadLayer[], renaming?: string): Checked<string> {
  const trimmed = name.trim();
  if (trimmed === "") return { ok: false, error: "レイヤー名が空です" };
  if (trimmed.length > MAX_LAYER_NAME_LENGTH) return { ok: false, error: `レイヤー名が長すぎます(${MAX_LAYER_NAME_LENGTH}文字まで)` };
  if (FORBIDDEN_LAYER_NAME.test(trimmed)) return { ok: false, error: "レイヤー名に使えない文字があります(< > / \\ \" : ; ? * | = ` と制御文字)" };
  const upper = trimmed.toUpperCase();
  const clash = layers.find((layer) => layer.name.toUpperCase() === upper && layer.name !== renaming);
  if (clash !== undefined) return { ok: false, error: `同じ名前のレイヤー「${clash.name}」があります(大文字小文字は区別しません)` };
  return { ok: true, value: trimmed };
}

/** 色の検証。#rrggbb(大文字小文字は問わない)だけを受け、小文字にそろえる */
export function validateLayerColor(color: string): Checked<string> {
  return /^#[0-9a-fA-F]{6}$/.test(color) ? { ok: true, value: color.toLowerCase() } : { ok: false, error: `色が正しくありません: ${color}(#rrggbb の形で指定してください)` };
}

/** 線種名の検証。線種表にあるものだけを受ける(大文字小文字は問わない)。戻り値は、表にある名前 */
export function validateLayerLineType(name: string, table: readonly CadLineType[]): Checked<string> {
  const key = lineTypeKeyOf(name);
  const found = table.find((lineType) => lineTypeKeyOf(lineType.name) === key);
  return found === undefined ? { ok: false, error: `線種「${name}」は線種表にありません` } : { ok: true, value: found.name };
}

/** 線の太さの検証。標準の値(1/100mm)だけを受ける */
export function validateLayerLineWeight(weight: number): Checked<number> {
  return isStandardLineWeight(weight) ? { ok: true, value: weight } : { ok: false, error: `線の太さ ${weight} は標準の値ではありません` };
}

/** レイヤーの線の太さから、図形が持つ値へ。細線(0.27mm 以下)は持たない(取り込んだ図形と同じ規則) */
export function entityLineWeightOf(layerWeight: number | undefined): number | undefined {
  return layerWeight !== undefined && Number.isFinite(layerWeight) && layerWeight > THIN_LINE_WEIGHT_LIMIT ? layerWeight : undefined;
}

type StylePatch = { color?: string; lineDash?: LineDash | null; lineWeight?: number | null };

/** 図形の見た目を差し替えた新しい図形を返す(null は、その項目を取り除く) */
function withStyle(entity: CadEntity, patch: StylePatch): CadEntity {
  const next: Record<string, unknown> = { ...entity };
  if (patch.color !== undefined) next.color = patch.color;
  if (patch.lineDash !== undefined) {
    if (patch.lineDash === null) delete next.lineDash;
    else next.lineDash = patch.lineDash;
  }
  if (patch.lineWeight !== undefined) {
    if (patch.lineWeight === null) delete next.lineWeight;
    else next.lineWeight = patch.lineWeight;
  }
  return next as CadEntity;
}

/** この図形が、線種(破線)を持てるか。文字と点は持たない */
export function canHaveLineDash(entity: CadEntity): boolean {
  return entity.type !== "TEXT" && entity.type !== "POINT";
}

/** この図形が、線の太さを持てるか。文字・点・寸法は持たない */
export function canHaveLineWeight(entity: CadEntity): boolean {
  return entity.type !== "TEXT" && entity.type !== "POINT" && entity.type !== "DIMENSION";
}

/** 図形の破線・線の太さ(持てない図形は undefined) */
function lineDashOf(entity: CadEntity): LineDash | undefined {
  return entity.type === "TEXT" ? undefined : entity.lineDash;
}
function lineWeightOf(entity: CadEntity): number | undefined {
  return entity.type === "TEXT" ? undefined : entity.lineWeight;
}

/** 図形の、図形ごとの線種尺度。図形が持っていればそれ、無ければ破線の鍵から取り戻す。どちらも無い・取り戻せないときは 1 */
function entityScaleOf(entity: CadEntity, ltScale: number): number {
  const own = entity.lineTypeScale;
  if (typeof own === "number" && own > 0 && Number.isFinite(own)) return own;
  const dash = lineDashOf(entity);
  return dash === undefined ? 1 : (entityDashScaleOf(dash, ltScale) ?? 1);
}

/**
 * ByLayer の印が立っている属性を、レイヤーの設定に合わせる。印の無い属性(図形自身の指定)は触らない。
 * only は、合わせ直す属性(ビット)。レイヤーの色だけを変えたときに、線種まで作り直さないために絞る(省略すると、すべて)。
 * 変わるものが無ければ、渡した図形そのものを返す。
 */
export function restyleEntityToLayer(entity: CadEntity, layer: CadLayer, dashes: DashFactory, only: number = BYLAYER_ALL): CadEntity {
  const mask = byLayerMaskOf(entity) & only;
  if (mask === 0) return entity;
  const patch: StylePatch = {};
  let changed = false;
  if ((mask & BYLAYER_COLOR) !== 0 && entity.color !== layer.color) {
    patch.color = layer.color;
    changed = true;
  }
  if ((mask & BYLAYER_LINETYPE) !== 0 && canHaveLineDash(entity)) {
    const dash = dashes.make(layer.lineType, entityScaleOf(entity, dashes.ltScale));
    if (dash?.key !== lineDashOf(entity)?.key) {
      patch.lineDash = dash ?? null;
      changed = true;
    }
  }
  if ((mask & BYLAYER_LINEWEIGHT) !== 0 && canHaveLineWeight(entity)) {
    const weight = entityLineWeightOf(layer.lineWeight);
    if (weight !== lineWeightOf(entity)) {
      patch.lineWeight = weight ?? null;
      changed = true;
    }
  }
  return changed ? withStyle(entity, patch) : entity;
}

/**
 * 全体の線種尺度が変わったとき、破線(`名前@尺度` の鍵のもの)を、新しい尺度で作り直す。
 * 図形ごとの尺度は、古い鍵から取り戻して、掛け直す。寸法の線種など、別の鍵の破線は変えない。
 * 変わるものが無ければ、渡した図形そのものを返す。
 */
export function rescaleEntityDash(entity: CadEntity, oldLtScale: number, dashes: DashFactory): CadEntity {
  const dash = lineDashOf(entity);
  if (dash === undefined) return entity;
  const own = entity.lineTypeScale;
  const entityScale = typeof own === "number" && own > 0 && Number.isFinite(own) ? own : entityDashScaleOf(dash, oldLtScale);
  if (entityScale === null) return entity;
  const next = dashes.make(dash.name, entityScale);
  if (next === undefined) return entity;
  return next.key === dash.key ? entity : withStyle(entity, { lineDash: next });
}

/** 新しい図形(ByLayer)が持つ、レイヤーの見た目。レイヤーの色・線種・線の太さを、解決済みの値で持つ */
export function layerAppearance(layer: CadLayer, dashes: DashFactory): { color: string; lineDash?: LineDash; lineWeight?: number } {
  const lineDash = dashes.make(layer.lineType, 1);
  const lineWeight = entityLineWeightOf(layer.lineWeight);
  return {
    color: layer.color,
    ...(lineDash === undefined ? {} : { lineDash }),
    ...(lineWeight === undefined ? {} : { lineWeight }),
  };
}

/** そのレイヤーに属する図形の数 */
export function countEntitiesOnLayer(entities: readonly CadEntity[], layerName: string): number {
  let count = 0;
  for (const entity of entities) if (entity.layer === layerName) count++;
  return count;
}
