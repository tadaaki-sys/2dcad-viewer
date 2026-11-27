// レイヤーの編集(作成・色/線種/線の太さの変更・名前の変更・削除・図形の移動・全体の線種尺度)を、図面に適用する。
// React にも画面にも依存しない。1回の操作は、1つの変更(ChangeSet)にまとめて DocumentSession に渡す。
// だから、レイヤーの色を変えると、ByLayer の図形の色も同じ変更に入り、Undo は1回で、レイヤーも図形も元に戻る。
import type { Change } from "../../core/history";
import { BYLAYER_ALL, BYLAYER_COLOR, BYLAYER_LINETYPE, BYLAYER_LINEWEIGHT, byLayerMaskOf } from "../../core/style/byLayer";
import {
  countEntitiesOnLayer,
  rescaleEntityDash,
  restyleEntityToLayer,
  validateLayerColor,
  validateLayerLineType,
  validateLayerLineWeight,
  validateLayerName,
} from "../../core/layer/layerRules";
import { CONTINUOUS, createDashFactory, lineTypeKeyOf } from "../../core/style/lineTypes";
import { getEntity, indexOfEntity } from "../../core/model";
import type { EntityId } from "../../core/model";
import type { CadEntity, CadLayer } from "../../types/cad";
import { resolveEditTargets } from "./editability";
import type { Editability } from "./editability";
import type { DocumentSession } from "./documentSession";
import type { EditOutcome } from "./editing";

/** 全体の線種尺度の範囲(破線の長さに掛ける値。極端な値で、描画が壊れないように) */
export const MIN_LTSCALE = 1e-6;
export const MAX_LTSCALE = 1e6;

/** レイヤーの設定の変更。undefined は変えない。lineType の null は実線(CONTINUOUS)、lineWeight の null は既定(細線) */
export type LayerPatch = { color?: string; lineType?: string | null; lineWeight?: number | null };

function fail(message: string): EditOutcome {
  return { ok: false, message };
}

function layerOf(session: DocumentSession, name: string): CadLayer | undefined {
  const index = session.document.layerIndexByName.get(name);
  return index === undefined ? undefined : session.document.layers[index];
}

/** 値の検証結果を、レイヤーの項目として組み立てる(実線は lineType を持たない) */
function normalizedLineType(session: DocumentSession, lineType: string | null): { ok: true; value: string | undefined } | { ok: false; error: string } {
  if (lineType === null || lineTypeKeyOf(lineType) === CONTINUOUS) return { ok: true, value: undefined };
  const checked = validateLayerLineType(lineType, session.document.lineTypes);
  return checked.ok ? { ok: true, value: checked.value } : checked;
}

/** レイヤーを作る。色の既定は白、線種は実線、線の太さは既定 */
export function createLayer(
  session: DocumentSession,
  input: { name: string; color?: string; lineType?: string | null; lineWeight?: number | null },
): EditOutcome {
  const document = session.document;
  const name = validateLayerName(input.name, document.layers);
  if (!name.ok) return fail(`レイヤーを作れませんでした: ${name.error}`);
  const color = validateLayerColor(input.color ?? "#ffffff");
  if (!color.ok) return fail(`レイヤーを作れませんでした: ${color.error}`);
  const lineType = normalizedLineType(session, input.lineType ?? null);
  if (!lineType.ok) return fail(`レイヤーを作れませんでした: ${lineType.error}`);
  let lineWeight: number | undefined;
  if (input.lineWeight !== undefined && input.lineWeight !== null) {
    const checked = validateLayerLineWeight(input.lineWeight);
    if (!checked.ok) return fail(`レイヤーを作れませんでした: ${checked.error}`);
    lineWeight = checked.value;
  }
  const layer: CadLayer = {
    name: name.value,
    color: color.value,
    visible: true,
    ...(lineType.value === undefined ? {} : { lineType: lineType.value }),
    ...(lineWeight === undefined ? {} : { lineWeight }),
  };
  const outcome = session.apply({ label: `レイヤー「${layer.name}」を作成`, changes: [{ kind: "layerAdd", layer, index: document.layers.length }] });
  if (!outcome.ok) return fail(`レイヤーを作れませんでした: ${outcome.error}`);
  return { ok: true, message: `レイヤー「${layer.name}」を作りました` };
}

/** そのレイヤーに属する図形の、置き換えの変更を作る(map が、新しい図形を返す。変わらないものは入れない) */
function replacesOnLayer(session: DocumentSession, layerName: string, map: (entity: CadEntity) => CadEntity): Change[] {
  const changes: Change[] = [];
  const entities = session.document.entities;
  for (let i = 0; i < entities.length; i++) {
    const before = entities[i];
    if (before.layer !== layerName) continue;
    const after = map(before);
    if (after !== before) changes.push({ kind: "replace", before, after, index: i });
  }
  return changes;
}

const PATCH_LABELS: ReadonlyArray<[keyof LayerPatch, string]> = [
  ["color", "色"],
  ["lineType", "線種"],
  ["lineWeight", "線の太さ"],
];

/**
 * レイヤーの色・線種・線の太さを変える。そのレイヤーの図形のうち、変えた属性が ByLayer のものは、同じ変更の中で追従する
 * (図形自身の指定[ByObject]の属性は、そのまま)。
 */
export function editLayer(session: DocumentSession, name: string, patch: LayerPatch): EditOutcome {
  const before = layerOf(session, name);
  if (before === undefined) return fail(`レイヤー「${name}」がありません`);

  let color = before.color;
  let lineType = before.lineType;
  let lineWeight = before.lineWeight;
  let bits = 0;
  if (patch.color !== undefined) {
    const checked = validateLayerColor(patch.color);
    if (!checked.ok) return fail(`変更できませんでした: ${checked.error}`);
    if (checked.value !== color) bits |= BYLAYER_COLOR;
    color = checked.value;
  }
  if (patch.lineType !== undefined) {
    const checked = normalizedLineType(session, patch.lineType);
    if (!checked.ok) return fail(`変更できませんでした: ${checked.error}`);
    if (checked.value !== lineType) bits |= BYLAYER_LINETYPE;
    lineType = checked.value;
  }
  if (patch.lineWeight !== undefined) {
    let next: number | undefined;
    if (patch.lineWeight !== null) {
      const checked = validateLayerLineWeight(patch.lineWeight);
      if (!checked.ok) return fail(`変更できませんでした: ${checked.error}`);
      next = checked.value;
    }
    if (next !== lineWeight) bits |= BYLAYER_LINEWEIGHT;
    lineWeight = next;
  }
  if (bits === 0) return fail("変更がありません(同じ設定です)");

  const after: CadLayer = {
    name: before.name,
    color,
    visible: before.visible,
    ...(lineType === undefined ? {} : { lineType }),
    ...(lineWeight === undefined ? {} : { lineWeight }),
    ...(before.locked === true ? { locked: true } : {}),
  };
  const dashes = createDashFactory(session.document.lineTypes, session.document.ltScale);
  const followers = replacesOnLayer(session, name, (entity) => restyleEntityToLayer(entity, after, dashes, bits));
  const index = session.document.layerIndexByName.get(name)!;
  const changes: Change[] = [{ kind: "layerReplace", before, after, index }, ...followers];
  const what = PATCH_LABELS.filter(([key]) => patch[key] !== undefined).map(([, label]) => label).join("・");
  const outcome = session.apply({ label: `レイヤー「${name}」の${what}を変更`, changes });
  if (!outcome.ok) return fail(`変更できませんでした: ${outcome.error}`);
  const followed = followers.length;
  const onLayer = countEntitiesOnLayer(session.document.entities, name);
  const markedCount = session.document.entities.filter((entity) => entity.layer === name && (byLayerMaskOf(entity) & bits) !== 0).length;
  // 追従する図形が無いときは、理由を知らせる(DWG から変換した図面は、図形の色などが、ByLayer ではなく、数値で書かれている)
  const note =
    followed > 0
      ? `(ByLayer の図形 ${followed} 個が追従しました)`
      : markedCount > 0
        ? `(ByLayer の図形 ${markedCount} 個は、見た目が変わりません)`
        : onLayer > 0
          ? `(追従する図形はありません: このレイヤーの図形 ${onLayer} 個は、${what}を図形自身で指定しています。DWG から変換した図面では、元の ByLayer の指定が失われています)`
          : "";
  return { ok: true, message: `レイヤー「${name}」の${what}を変更しました${note}` };
}

/**
 * レイヤーをロックする・ロックを解除する(Phase 19)。ロックしたレイヤーの図形は、選べず、編集できない(薄く表示し、スナップはできる)。
 * レイヤーの定義の変更なので、Undo の対象(表示・非表示とは違う)。図形は変わらない。現在のレイヤーでも、ロックできる(描くことはできる)。
 */
export function setLayerLocked(session: DocumentSession, name: string, locked: boolean): EditOutcome {
  const before = layerOf(session, name);
  if (before === undefined) return fail(`レイヤー「${name}」がありません`);
  if ((before.locked === true) === locked) return fail(locked ? `レイヤー「${name}」は、すでにロックされています` : `レイヤー「${name}」は、ロックされていません`);
  const { locked: _old, ...rest } = before;
  void _old;
  const after: CadLayer = locked ? { ...rest, locked: true } : rest;
  const index = session.document.layerIndexByName.get(name)!;
  const outcome = session.apply({ label: `レイヤー「${name}」の${locked ? "ロック" : "ロック解除"}`, changes: [{ kind: "layerReplace", before, after, index }] });
  if (!outcome.ok) return fail(`変更できませんでした: ${outcome.error}`);
  return { ok: true, message: locked ? `レイヤー「${name}」をロックしました(図形は選べず、編集できません)` : `レイヤー「${name}」のロックを解除しました` };
}

/** レイヤーの名前を変える。そのレイヤーの図形も、同じ変更の中で、新しい名前に付け替える。レイヤー 0 は変えられない */
export function renameLayer(session: DocumentSession, from: string, to: string): EditOutcome {
  const before = layerOf(session, from);
  if (before === undefined) return fail(`レイヤー「${from}」がありません`);
  if (from === "0") return fail("レイヤー 0 の名前は変えられません(DXF の決まりで、ブロックの中の図形が、挿入先のレイヤーに従うために必要です)");
  const name = validateLayerName(to, session.document.layers, from);
  if (!name.ok) return fail(`名前を変えられませんでした: ${name.error}`);
  if (name.value === from) return fail("名前が同じです");
  const after: CadLayer = { ...before, name: name.value };
  const followers = replacesOnLayer(session, from, (entity) => ({ ...entity, layer: name.value }) as CadEntity);
  const index = session.document.layerIndexByName.get(from)!;
  const outcome = session.apply({
    label: `レイヤー「${from}」を「${name.value}」に名前変更`,
    changes: [{ kind: "layerReplace", before, after, index }, ...followers],
  });
  if (!outcome.ok) return fail(`名前を変えられませんでした: ${outcome.error}`);
  return { ok: true, message: `レイヤー「${from}」を「${name.value}」に変えました(図形 ${followers.length} 個を付け替えました)` };
}

/**
 * レイヤーを削除する。図形がある・現在のレイヤー・レイヤー 0・最後の1つ、は削除できない
 * (図形を消さず、図形が、存在しないレイヤーを指すこともないように、先に断る)。
 */
export function deleteLayer(session: DocumentSession, name: string, currentLayerName: string | null): EditOutcome {
  const layer = layerOf(session, name);
  if (layer === undefined) return fail(`レイヤー「${name}」がありません`);
  if (name === "0") return fail("レイヤー 0 は削除できません");
  if (name === currentLayerName) return fail(`現在のレイヤー「${name}」は削除できません。別のレイヤーを現在にしてから削除してください`);
  if (session.document.layers.length <= 1) return fail("最後のレイヤーは削除できません");
  const count = countEntitiesOnLayer(session.document.entities, name);
  if (count > 0) return fail(`レイヤー「${name}」には図形が ${count} 個あるため、削除できません(先に、図形を別のレイヤーへ移すか、削除してください)`);
  const index = session.document.layerIndexByName.get(name)!;
  const outcome = session.apply({ label: `レイヤー「${name}」を削除`, changes: [{ kind: "layerRemove", layer, index }] });
  if (!outcome.ok) return fail(`削除できませんでした: ${outcome.error}`);
  return { ok: true, message: `レイヤー「${name}」を削除しました` };
}

/**
 * 図形を、別のレイヤーへ移す(LAYMOVE)。図形の色・線種・線の太さのうち、ByLayer のものは、移した先のレイヤーの設定に従う
 * (図形自身の指定の属性は、そのまま)。編集できない図形は、除く。1つの依頼が、Undoの1段階。
 */
export function moveToLayer(session: DocumentSession, editability: Editability, ids: readonly EntityId[], layerName: string): EditOutcome {
  const target = layerOf(session, layerName);
  if (target === undefined) return fail(`レイヤー「${layerName}」がありません`);
  const targets = resolveEditTargets(editability, ids);
  const dashes = createDashFactory(session.document.lineTypes, session.document.ltScale);
  const changes: Change[] = [];
  let already = 0;
  const ordered = targets.editable
    .map((id) => ({ entity: getEntity(session.document, id), index: indexOfEntity(session.document, id) }))
    .filter((item): item is { entity: CadEntity; index: number } => item.entity !== undefined)
    .sort((a, b) => a.index - b.index);
  for (const { entity, index } of ordered) {
    if (entity.layer === layerName) {
      already++;
      continue;
    }
    const moved = { ...entity, layer: layerName } as CadEntity;
    changes.push({ kind: "replace", before: entity, after: restyleEntityToLayer(moved, target, dashes, BYLAYER_ALL), index });
  }
  const skipped = targets.skipped > 0 ? `(編集できない図形 ${targets.skipped} 個は除きました: ${targets.reason ?? ""})` : "";
  if (changes.length === 0) {
    return fail(ordered.length === 0 ? `移せる図形がありません${skipped}` : `選んだ図形は、すでにレイヤー「${layerName}」にあります`);
  }
  const outcome = session.apply({ label: `${changes.length}個の図形をレイヤー「${layerName}」へ移動`, changes });
  if (!outcome.ok) return fail(`移せませんでした: ${outcome.error}`);
  const note = !target.visible ? "(このレイヤーは非表示なので、図形は見えなくなります)" : "";
  return { ok: true, message: `${changes.length}個の図形をレイヤー「${layerName}」へ移しました${already > 0 ? `(${already} 個は、すでにそのレイヤー)` : ""}${skipped}${note}` };
}

/** 全体の線種尺度を変える。破線(線種の鍵が `名前@尺度` のもの)の長さを、新しい尺度で作り直す */
export function setLineTypeScale(session: DocumentSession, value: number): EditOutcome {
  if (!Number.isFinite(value) || value < MIN_LTSCALE || value > MAX_LTSCALE) return fail(`線種尺度は ${MIN_LTSCALE} 以上 ${MAX_LTSCALE} 以下の数で指定してください`);
  const before = session.document.ltScale;
  if (value === before) return fail("変更がありません(同じ値です)");
  const dashes = createDashFactory(session.document.lineTypes, value);
  const changes: Change[] = [{ kind: "ltScale", before, after: value }];
  const entities = session.document.entities;
  let rescaled = 0;
  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i];
    if (entity.type === "TEXT") continue;
    const after = rescaleEntityDash(entity, before, dashes);
    if (after !== entity) {
      changes.push({ kind: "replace", before: entity, after, index: i });
      rescaled++;
    }
  }
  const outcome = session.apply({ label: "全体の線種尺度を変更", changes });
  if (!outcome.ok) return fail(`変更できませんでした: ${outcome.error}`);
  return { ok: true, message: `全体の線種尺度を ${before} から ${value} に変更しました(破線の図形 ${rescaled} 個の長さを作り直しました)` };
}
