// 変更の内容(ChangeSet)をドキュメントへ適用する。元のドキュメントは書き換えず、新しいドキュメントを返す。
// 全部成功するか、全部しないか(原子的): 1つでも合わなければ、何も変えずに理由を返す。
import type { CadDocument } from "../model/document";
import { parseNewEntityCounter } from "../model/ids";
import type { EntityId } from "../model/ids";
import type { CadEntity } from "../../types/cad";
import type { ChangeSet, EntityChange } from "./changeSet";

export type ApplyResult = { ok: true; document: CadDocument } | { ok: false; error: string };

type Applied = { ok: true; entities: CadEntity[]; nextNewId: number } | { ok: false; error: string };

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

/**
 * 変更を適用する。確かめること:
 *  - 位置(index)が範囲内であること
 *  - 削除・置き換えの対象が、その位置に、実際にある図形(同じオブジェクト)であること
 *  - 追加する図形のIDが、まだ使われていないこと、レイヤーが存在すること
 *  - 置き換えで、IDが変わらないこと
 * 触っていない図形は、同じオブジェクトのまま引き継ぐ。
 *
 * 削除だけ・追加だけの大きな変更(多数の図形の削除と、その Undo)は、1回の走査で適用する(applyBulk)。
 * それ以外、または、その条件に合わない変更は、1件ずつ順に適用する(applySequentially。エラーの文言もこちらが出す)。
 */
export function applyChangeSet(document: CadDocument, changeSet: ChangeSet): ApplyResult {
  if (changeSet.changes.length === 0) return fail("変更がありません");
  const bulk = applyBulk(document, changeSet.changes);
  if (bulk !== null) return finish(document, bulk);
  return applyBulkThenReplaces(document, changeSet.changes) ?? finish(document, applySequentially(document, changeSet.changes));
}

/**
 * 削除だけ(または追加だけ)の大きな変更のあとに、置き換えが続く変更(連動寸法の追従が、置き換えを足したとき)を、
 * 前半は1回の走査(applyBulk)、後半は1件ずつ、で適用する。多数の図形の削除が、置き換えが1つ付いただけで、遅い経路に落ちないように。
 * 前半が高速経路の条件に合わない・失敗するときは null(1件ずつの適用に任せる。エラーの文言もそちらが出す)。
 */
function applyBulkThenReplaces(document: CadDocument, changes: readonly EntityChange[]): ApplyResult | null {
  const kind = changes[0].kind;
  if (kind !== "remove" && kind !== "add") return null;
  let split = 0;
  while (split < changes.length && changes[split].kind === kind) split++;
  if (split === changes.length) return null;
  for (let i = split; i < changes.length; i++) if (changes[i].kind !== "replace") return null;
  const bulk = applyBulk(document, changes.slice(0, split));
  if (bulk === null) return null;
  const middle = finish(document, bulk);
  if (!middle.ok) return null;
  const tail = applySequentially(middle.document, changes.slice(split));
  // 後半が失敗するときも、null(1件ずつの適用に任せる。何番目の変更か、という文言が、同じになる)
  return tail.ok ? finish(middle.document, tail) : null;
}

/** 1件ずつ順に適用する方法だけで適用する(高速経路を通らない)。高速経路と結果が同じことを、テストで確かめるために使う */
export function applyChangeSetSequentially(document: CadDocument, changeSet: ChangeSet): ApplyResult {
  if (changeSet.changes.length === 0) return fail("変更がありません");
  return finish(document, applySequentially(document, changeSet.changes));
}

function finish(document: CadDocument, applied: Applied): ApplyResult {
  if (!applied.ok) return applied;
  const { entities, nextNewId } = applied;
  const indexById = new Map<EntityId, number>();
  for (let i = 0; i < entities.length; i++) indexById.set(entities[i].id, i);
  if (indexById.size !== entities.length) return fail("適用すると図形IDが重複します");
  return { ok: true, document: { ...document, entities, indexById, nextNewId } };
}

/**
 * 削除だけ(位置が大きい順)、または追加だけ(位置が小さい順)の変更を、1回の走査で適用する。
 * 1件ごとに配列を詰め直す(splice)と、図形が散らばった大量の削除は「図形数 × 削除数」の時間になるため。
 * 条件に合わない(順序が違う・位置や対象が合わない、など)ときは null を返し、1件ずつの適用に任せる。
 * そうすれば、不正な変更のエラーの文言は、1件ずつの適用のものと同じになる。
 */
function applyBulk(document: CadDocument, changes: readonly EntityChange[]): Applied | null {
  const first = changes[0];
  if (first.kind === "remove") return applyBulkRemove(document, changes);
  if (first.kind === "add") return applyBulkAdd(document, changes);
  return null;
}

function applyBulkRemove(document: CadDocument, changes: readonly EntityChange[]): Applied | null {
  const source = document.entities;
  const removed = new Uint8Array(source.length);
  let previous = source.length;
  for (const change of changes) {
    if (change.kind !== "remove") return null;
    const index = change.index;
    // 位置が大きい順に並んでいれば、先に消した図形が、後の位置をずらさない(元の位置のまま照合できる)
    if (!Number.isInteger(index) || index < 0 || index >= previous) return null;
    if (source[index] !== change.entity) return null;
    removed[index] = 1;
    previous = index;
  }
  const entities: CadEntity[] = [];
  for (let i = 0; i < source.length; i++) if (removed[i] === 0) entities.push(source[i]);
  return { ok: true, entities, nextNewId: document.nextNewId };
}

function applyBulkAdd(document: CadDocument, changes: readonly EntityChange[]): Applied | null {
  const source = document.entities;
  const total = source.length + changes.length;
  // 位置が小さい順の追加は、後の追加が先の追加の位置をずらさない。だから、各 index が、そのまま最終的な位置になる
  const added = new Map<number, CadEntity>();
  const addedIds = new Set<EntityId>();
  let previous = -1;
  let nextNewId = document.nextNewId;
  for (let step = 0; step < changes.length; step++) {
    const change = changes[step];
    if (change.kind !== "add") return null;
    const index = change.index;
    // その時点の配列の長さ(元の長さ + これまでの追加数)以下で、前の追加より後ろ
    if (!Number.isInteger(index) || index <= previous || index > source.length + step) return null;
    const id = change.entity.id;
    if (document.indexById.has(id) || addedIds.has(id)) return null;
    if (!document.layerIndexByName.has(change.entity.layer)) return null;
    added.set(index, change.entity);
    addedIds.add(id);
    previous = index;
    const counter = parseNewEntityCounter(id);
    if (counter !== null && counter >= nextNewId) nextNewId = counter + 1;
  }
  const entities: CadEntity[] = new Array<CadEntity>(total);
  let cursor = 0;
  for (let i = 0; i < total; i++) {
    const entity = added.get(i);
    entities[i] = entity !== undefined ? entity : source[cursor++];
  }
  return { ok: true, entities, nextNewId };
}

/** 1件ずつ順に適用する。位置は、適用が進むごとに変わる(その時点の配列に対する位置) */
function applySequentially(document: CadDocument, changes: readonly EntityChange[]): Applied {
  const entities: CadEntity[] = document.entities.slice();
  // 適用の途中でIDが存在するかを、元の索引との差分(追加でtrue、削除でfalse)で管理する(位置は変わるので、索引の位置は使わない)
  const presence = new Map<EntityId, boolean>();
  const isPresent = (id: EntityId) => presence.get(id) ?? document.indexById.has(id);
  let nextNewId = document.nextNewId;

  for (let step = 0; step < changes.length; step++) {
    const change = changes[step];
    const where = `${step + 1}番目の変更(${change.kind})`;
    if (change.kind === "move") {
      const { from, to } = change;
      if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0) {
        return fail(`${where}: 位置が正しくありません: ${from} → ${to}`);
      }
      if (from >= entities.length || to >= entities.length) return fail(`${where}: 位置が範囲外です: ${from} → ${to}`);
      if (entities[from] !== change.entity) return fail(`${where}: その位置の図形が、移動しようとした図形と一致しません: ${change.entity.id}`);
      entities.splice(from, 1);
      entities.splice(to, 0, change.entity);
      continue;
    }

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
  return { ok: true, entities, nextNewId };
}
