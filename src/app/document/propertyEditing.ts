// 図形の色・線種・線の太さ・線種尺度の編集(Phase 18。プロパティ欄)を、図面に適用する。React にも画面にも依存しない。
// 選んだ図形(編集できるものだけ)に、まとめて適用する。1回が Undo の1段階。
import { replaceEntitiesChangeSet } from "../../core/history";
import { getEntity, indexOfEntity } from "../../core/model";
import type { EntityId } from "../../core/model";
import { BY_LAYER, withColor, withLineType, withLineTypeScale, withLineWeight } from "../../core/layer/entityStyle";
import type { StyleEdit } from "../../core/layer/entityStyle";
import { validateLayerLineType } from "../../core/layer/layerRules";
import { createDashFactory, lineTypeKeyOf } from "../../core/style/lineTypes";
import type { CadEntity, CadLayer } from "../../types/cad";
import { resolveEditTargets } from "./editability";
import type { Editability } from "./editability";
import type { DocumentSession } from "./documentSession";
import type { EditOutcome } from "./editing";

export type StyleProperty =
  /** 色。値は、"bylayer" か #rrggbb */
  | { kind: "color"; value: string }
  /** 線種。値は、"bylayer" か、線種表の名前 */
  | { kind: "lineType"; value: string }
  /** 線の太さ。値は、"bylayer"・null(既定=細線)・標準の値(1/100mm) */
  | { kind: "lineWeight"; value: number | null | typeof BY_LAYER }
  /** 図形ごとの線種尺度 */
  | { kind: "lineTypeScale"; value: number };

const LABELS: Record<StyleProperty["kind"], string> = { color: "色", lineType: "線種", lineWeight: "線の太さ", lineTypeScale: "線種尺度" };

/** 見た目に関わる項目が、同じか(同じなら、置き換えない=Undo の段階を作らない) */
function sameStyle(a: CadEntity, b: CadEntity): boolean {
  const dash = (e: CadEntity) => (e.type === "TEXT" ? undefined : e.lineDash?.key);
  const weight = (e: CadEntity) => (e.type === "TEXT" ? undefined : e.lineWeight);
  return a.color === b.color && dash(a) === dash(b) && weight(a) === weight(b) && (a.byLayer ?? 0) === (b.byLayer ?? 0) && (a.lineTypeScale ?? 1) === (b.lineTypeScale ?? 1);
}

/** 選んだ図形(編集できるものだけ)の、色・線種・線の太さ・線種尺度を変える */
export function setStyleProperty(session: DocumentSession, editability: Editability, ids: readonly EntityId[], change: StyleProperty): EditOutcome {
  const label = LABELS[change.kind];
  const document = session.document;
  const dashes = createDashFactory(document.lineTypes, document.ltScale);
  let lineType = change.kind === "lineType" ? change.value : "";
  if (change.kind === "lineType" && change.value !== BY_LAYER) {
    const checked = validateLayerLineType(change.value, document.lineTypes);
    if (!checked.ok) return { ok: false, message: `${label}を変更できませんでした: ${checked.error}` };
    lineType = lineTypeKeyOf(checked.value) === "CONTINUOUS" ? "CONTINUOUS" : checked.value;
  }

  const targets = resolveEditTargets(editability, ids);
  const replacements: CadEntity[] = [];
  const reasons: string[] = [];
  let unchanged = 0;
  const ordered = targets.editable
    .map((id) => ({ entity: getEntity(document, id), index: indexOfEntity(document, id) }))
    .filter((item): item is { entity: CadEntity; index: number } => item.entity !== undefined)
    .sort((a, b) => a.index - b.index);
  for (const { entity } of ordered) {
    const layer: CadLayer | undefined = document.layers[document.layerIndexByName.get(entity.layer) ?? -1];
    if (layer === undefined) {
      reasons.push(`レイヤー「${entity.layer}」がありません`);
      continue;
    }
    let edit: StyleEdit;
    switch (change.kind) {
      case "color":
        edit = withColor(entity, change.value, layer);
        break;
      case "lineType":
        edit = withLineType(entity, lineType, layer, dashes);
        break;
      case "lineWeight":
        edit = withLineWeight(entity, change.value, layer);
        break;
      case "lineTypeScale":
        edit = withLineTypeScale(entity, change.value, dashes);
        break;
    }
    if (!edit.ok) reasons.push(edit.error);
    else if (sameStyle(entity, edit.entity)) unchanged++;
    else replacements.push(edit.entity);
  }
  const skipped = targets.skipped > 0 ? `(編集できない図形 ${targets.skipped} 個は除きました: ${targets.reason ?? ""})` : "";
  if (replacements.length === 0) {
    const why = reasons[0] ?? (unchanged > 0 ? "すでに、その設定です" : "対象の図形がありません");
    return { ok: false, message: `${label}を変更できませんでした: ${why}${skipped}` };
  }
  let changeSet;
  try {
    changeSet = replaceEntitiesChangeSet(document, replacements, `${replacements.length === 1 ? "図形" : `${replacements.length}個の図形`}の${label}を変更`);
  } catch (error) {
    return { ok: false, message: `${label}を変更できませんでした: ${error instanceof Error ? error.message : String(error)}` };
  }
  const outcome = session.apply(changeSet);
  if (!outcome.ok) return { ok: false, message: `${label}を変更できませんでした: ${outcome.error}` };
  const notes = [reasons.length > 0 ? `${reasons.length} 個は、持てない設定のため除きました` : "", unchanged > 0 ? `${unchanged} 個は、すでに同じ設定` : ""].filter((s) => s !== "").join("、");
  return { ok: true, message: `${replacements.length}個の図形の${label}を変更しました${notes === "" ? "" : `(${notes})`}${skipped}` };
}
