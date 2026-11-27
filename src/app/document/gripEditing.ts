// グリップ・頂点・プロパティによる編集(Phase 18)を、図面に適用する。React にも画面にも依存しない。
// 1回の操作は、1つの変更(ChangeSet)にして DocumentSession に渡す(Undo は1段階)。連動寸法の追従は、apply が足す。
// 取り込んだ図形は、形が変わった印(reshaped)を付けて、保存の Phase に渡す(STRETCH と同じ規則)。
import { replaceEntitiesChangeSet } from "../../core/history";
import { getEntity } from "../../core/model";
import type { EntityId } from "../../core/model";
import { applyGrip } from "../../core/grip/grips";
import { deleteVertexNear, insertVertexNear, setPolylineClosed } from "../../core/vertex/vertexOps";
import type { VertexEdit } from "../../core/vertex/vertexOps";
import { geometryValueOf, withGeometryValue } from "../../core/geometry/propertyGeometry";
import type { GeometryField } from "../../core/geometry/propertyGeometry";
import type { CadEntity, Point2D } from "../../types/cad";
import type { Editability } from "./editability";
import type { DocumentSession } from "./documentSession";
import { movedEntity, reshapedSourceRecord } from "./editing";
import type { EditOutcome } from "./editing";

function fail(message: string): EditOutcome {
  return { ok: false, message };
}

/** 形が変わった図形に、元データとの対応(reshaped の印)を付ける(新しく描いた図形には付かない) */
export function withReshapedSource(before: CadEntity, after: CadEntity): CadEntity {
  const sourceRecord = reshapedSourceRecord(before);
  return sourceRecord === undefined ? after : { ...after, sourceRecord };
}

/** 編集できる図形を取り出す(無い・編集できないときは、理由) */
function editableEntity(session: DocumentSession, editability: Editability, id: EntityId, noun: string): { ok: true; entity: CadEntity } | { ok: false; message: string } {
  const entity = getEntity(session.document, id);
  if (entity === undefined) return { ok: false, message: `${noun}できませんでした: 図形が見つかりません` };
  const reason = editability.reasonFor(id);
  if (reason !== null) return { ok: false, message: `${noun}できませんでした: ${reason}` };
  return { ok: true, entity };
}

function applyReplacement(session: DocumentSession, before: CadEntity, after: CadEntity, label: string, noun: string): EditOutcome | null {
  let changeSet;
  try {
    changeSet = replaceEntitiesChangeSet(session.document, [after], label);
  } catch (error) {
    return fail(`${noun}できませんでした: ${error instanceof Error ? error.message : String(error)}`);
  }
  const outcome = session.apply(changeSet);
  if (!outcome.ok) return fail(`${noun}できませんでした: ${outcome.error}`);
  void before;
  return null;
}

/** グリップ(図形の中の番号 index)を、target へ動かす。1回が Undo の1段階 */
export function moveGrip(session: DocumentSession, editability: Editability, id: EntityId, index: number, target: Point2D): EditOutcome {
  const found = editableEntity(session, editability, id, "グリップを動かす");
  if (!found.ok) return found;
  const edit = applyGrip(found.entity, index, target);
  if (!edit.ok) return fail(`グリップを動かせませんでした: ${edit.error}`);
  let after: CadEntity;
  try {
    after = edit.matrix === undefined ? withReshapedSource(found.entity, edit.entity) : movedEntity(found.entity, edit.matrix);
  } catch (error) {
    return fail(`グリップを動かせませんでした: ${error instanceof Error ? error.message : String(error)}`);
  }
  const failed = applyReplacement(session, found.entity, after, "グリップで編集", "グリップを動かす");
  return failed ?? { ok: true, message: "グリップを動かしました" };
}

function applyVertexEdit(session: DocumentSession, before: CadEntity, edit: VertexEdit, label: string, noun: string): EditOutcome | null {
  if (!edit.ok) return fail(`${noun}できませんでした: ${edit.error}`);
  return applyReplacement(session, before, withReshapedSource(before, edit.entity), label, noun);
}

/** 折れ線の、点(クリックした位置)に最も近い線分に、頂点を足す */
export function addVertexAt(session: DocumentSession, editability: Editability, id: EntityId, point: Point2D): EditOutcome {
  const found = editableEntity(session, editability, id, "頂点を追加");
  if (!found.ok) return found;
  const failed = applyVertexEdit(session, found.entity, insertVertexNear(found.entity, point), "頂点を追加", "頂点を追加");
  return failed ?? { ok: true, message: "頂点を追加しました" };
}

/** 折れ線の、点(クリックした位置)の近く(tolerance 以内)の頂点を削除する */
export function deleteVertexAt(session: DocumentSession, editability: Editability, id: EntityId, point: Point2D, tolerance: number): EditOutcome {
  const found = editableEntity(session, editability, id, "頂点を削除");
  if (!found.ok) return found;
  const failed = applyVertexEdit(session, found.entity, deleteVertexNear(found.entity, point, tolerance), "頂点を削除", "頂点を削除");
  return failed ?? { ok: true, message: "頂点を削除しました" };
}

/** 折れ線を、閉じる・開く(複数でも、1回が Undo の1段階)。折れ線でない・すでにその状態の図形は、除く */
export function setPolylinesClosed(session: DocumentSession, editability: Editability, ids: readonly EntityId[], closed: boolean): EditOutcome {
  const noun = closed ? "閉じる" : "開く";
  const replacements: CadEntity[] = [];
  const reasons: string[] = [];
  for (const id of new Set(ids)) {
    const found = editableEntity(session, editability, id, noun);
    if (!found.ok) {
      reasons.push(found.message);
      continue;
    }
    const edit = setPolylineClosed(found.entity, closed);
    if (!edit.ok) reasons.push(edit.error);
    else replacements.push(withReshapedSource(found.entity, edit.entity));
  }
  if (replacements.length === 0) return fail(`折れ線を${noun}ことができませんでした: ${reasons[0] ?? "対象がありません"}`);
  let changeSet;
  try {
    changeSet = replaceEntitiesChangeSet(session.document, replacements, `折れ線を${noun}`);
  } catch (error) {
    return fail(`折れ線を${noun}ことができませんでした: ${error instanceof Error ? error.message : String(error)}`);
  }
  const outcome = session.apply(changeSet);
  if (!outcome.ok) return fail(`折れ線を${noun}ことができませんでした: ${outcome.error}`);
  const skipped = reasons.length > 0 ? `(${reasons.length} 個は対象外: ${reasons[0]})` : "";
  return { ok: true, message: `${replacements.length}個の折れ線を${closed ? "閉じました" : "開きました"}${skipped}` };
}

/** プロパティ欄からの、値の編集(座標・半径・角度・文字の高さ・回転)。1つの値、1回が Undo の1段階 */
export function setGeometryProperty(session: DocumentSession, editability: Editability, id: EntityId, field: GeometryField, value: number): EditOutcome {
  const found = editableEntity(session, editability, id, "値を変更");
  if (!found.ok) return found;
  // 表示の精度(有効数字12桁)で、いまの値と同じなら、何もしない(「1」を「1.0」に書き直しただけで、変更の履歴・reshaped の印を作らない)
  const current = geometryValueOf(found.entity, field);
  if (current !== null && Number.isFinite(value) && Number(current.toPrecision(12)) === Number(value.toPrecision(12))) return fail("値を変更できませんでした: 値が変わりません");
  const edit = withGeometryValue(found.entity, field, value);
  if (!edit.ok) return fail(`値を変更できませんでした: ${edit.error}`);
  const failed = applyReplacement(session, found.entity, withReshapedSource(found.entity, edit.entity), "値を変更", "値を変更");
  return failed ?? { ok: true, message: "値を変更しました" };
}
