// 変更の内容(ChangeSet)をドキュメントへ適用する。元のドキュメントは書き換えず、新しいドキュメントを返す。
// 全部成功するか、全部しないか(原子的): 1つでも合わなければ、何も変えずに理由を返す。
import type { CadDocument } from "../model/document";
import { parseNewEntityCounter } from "../model/ids";
import type { EntityId } from "../model/ids";
import type { CadEntity } from "../../types/cad";
import type { ChangeSet } from "./changeSet";

export type ApplyResult = { ok: true; document: CadDocument } | { ok: false; error: string };

function fail(error: string): ApplyResult {
  return { ok: false, error };
}

/**
 * 変更を適用する。確かめること:
 *  - 位置(index)が範囲内であること
 *  - 削除・置き換えの対象が、その位置に、実際にある図形(同じオブジェクト)であること
 *  - 追加する図形のIDが、まだ使われていないこと、レイヤーが存在すること
 *  - 置き換えで、IDが変わらないこと
 * 触っていない図形は、同じオブジェクトのまま引き継ぐ。
 */
export function applyChangeSet(document: CadDocument, changeSet: ChangeSet): ApplyResult {
  if (changeSet.changes.length === 0) return fail("変更がありません");

  const entities: CadEntity[] = document.entities.slice();
  // 適用の途中でIDが存在するかを、元の索引との差分(追加でtrue、削除でfalse)で管理する(位置は変わるので、索引の位置は使わない)
  const presence = new Map<EntityId, boolean>();
  const isPresent = (id: EntityId) => presence.get(id) ?? document.indexById.has(id);
  let nextNewId = document.nextNewId;

  for (let step = 0; step < changeSet.changes.length; step++) {
    const change = changeSet.changes[step];
    const where = `${step + 1}番目の変更(${change.kind})`;
    const index = change.index;
    if (!Number.isInteger(index) || index < 0) return fail(`${where}: 位置が正しくありません: ${index}`);

    if (change.kind === "add") {
      if (index > entities.length) return fail(`${where}: 位置が範囲外です: ${index}`);
      const id = change.entity.id;
      if (isPresent(id)) return fail(`${where}: 図形IDがすでに使われています: ${id}`);
      if (!document.layerIndexByName.has(change.entity.layer)) {
        return fail(`${where}: レイヤーが存在しません: ${change.entity.layer}`);
      }
      entities.splice(index, 0, change.entity);
      presence.set(id, true);
      // 新しく作る図形のIDと、今後払い出すIDが重ならないようにする
      const counter = parseNewEntityCounter(id);
      if (counter !== null && counter >= nextNewId) nextNewId = counter + 1;
    } else if (change.kind === "remove") {
      if (index >= entities.length) return fail(`${where}: 位置が範囲外です: ${index}`);
      if (entities[index] !== change.entity) return fail(`${where}: その位置の図形が、削除しようとした図形と一致しません: ${change.entity.id}`);
      entities.splice(index, 1);
      presence.set(change.entity.id, false);
    } else {
      if (index >= entities.length) return fail(`${where}: 位置が範囲外です: ${index}`);
      if (change.before.id !== change.after.id) {
        return fail(`${where}: 置き換えで図形IDは変えられません: ${change.before.id} → ${change.after.id}`);
      }
      if (entities[index] !== change.before) return fail(`${where}: その位置の図形が、置き換えようとした図形と一致しません: ${change.before.id}`);
      if (change.after.layer !== change.before.layer && !document.layerIndexByName.has(change.after.layer)) {
        return fail(`${where}: レイヤーが存在しません: ${change.after.layer}`);
      }
      entities[index] = change.after;
    }
  }

  const indexById = new Map<EntityId, number>();
  for (let i = 0; i < entities.length; i++) indexById.set(entities[i].id, i);
  if (indexById.size !== entities.length) return fail("適用すると図形IDが重複します");

  return { ok: true, document: { ...document, entities, indexById, nextNewId } };
}
