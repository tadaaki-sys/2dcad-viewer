// 図面の変更の内容(ChangeSet)。ファイル形式にも画面にも依存しない。
//
// - Undo は、変更の内容を反転して適用することで行う(図面の複製は持たない)。
// - 保存(io/)は、この内容を元データの差分に変換する(docs/architecture.md の「今後の方針」)。
// - 1つのChangeSetは、全部成功するか、全部しないか(原子的)のどちらかで適用する(apply.ts)。
import type { CadDocument } from "../model/document";
import { getEntity, indexOfEntity } from "../model/document";
import type { EntityId } from "../model/ids";
import type { CadEntity } from "../../types/cad";

/**
 * 図形の変更1つ。位置(index)は、「その変更を適用する直前の、描画順の配列」での位置。
 * ChangeSetの中の変更は、書かれた順に1つずつ適用される(前の変更の結果に対して、次の変更を適用する)。
 */
export type EntityChange =
  /** 図形を、描画順の index の位置に挿入する(0以上、現在の個数以下) */
  | { kind: "add"; entity: CadEntity; index: number }
  /** index の位置にある図形(entity)を削除する。entityは、削除前の図形そのもの(Undoで元に戻すために持つ) */
  | { kind: "remove"; entity: CadEntity; index: number }
  /** index の位置にある図形(before)を、after に置き換える。IDと位置は変わらない */
  | { kind: "replace"; before: CadEntity; after: CadEntity; index: number };

export type ChangeSet = {
  /** 利用者に見せる名前(例: 「線を追加」)。Undoの案内に使う */
  label: string;
  changes: readonly EntityChange[];
};

/** 変更を反転する。追加と削除を入れ替え、置き換えの前後を入れ替え、順序を逆にする */
export function invertChangeSet(changeSet: ChangeSet): ChangeSet {
  const inverted: EntityChange[] = [];
  for (let i = changeSet.changes.length - 1; i >= 0; i--) {
    const change = changeSet.changes[i];
    if (change.kind === "add") inverted.push({ kind: "remove", entity: change.entity, index: change.index });
    else if (change.kind === "remove") inverted.push({ kind: "add", entity: change.entity, index: change.index });
    else inverted.push({ kind: "replace", before: change.after, after: change.before, index: change.index });
  }
  return { label: changeSet.label, changes: inverted };
}

// ---- コマンドが変更を作るための補助 ----

/** 図形を、描画順の末尾(いちばん上)に追加する変更を作る。ChangeSet内の位置は、追加が進むごとに数える */
export function addEntitiesChangeSet(document: CadDocument, entities: readonly CadEntity[], label: string): ChangeSet {
  let next = document.entities.length;
  return { label, changes: entities.map((entity) => ({ kind: "add" as const, entity, index: next++ })) };
}

/**
 * 図形を削除する変更を作る。位置のずれを避けるため、後ろの図形から順に削除する。
 * 存在しないIDが含まれるときは、エラーにする(黙って無視しない)。
 */
export function removeEntitiesChangeSet(document: CadDocument, ids: readonly EntityId[], label: string): ChangeSet {
  const unique = [...new Set(ids)];
  const targets = unique.map((id) => {
    const entity = getEntity(document, id);
    if (entity === undefined) throw new Error(`削除する図形が見つかりません: ${id}`);
    return { entity, index: indexOfEntity(document, id) };
  });
  targets.sort((a, b) => b.index - a.index);
  return { label, changes: targets.map((t) => ({ kind: "remove" as const, entity: t.entity, index: t.index })) };
}

/** 図形を置き換える変更を作る(IDは変えない)。存在しないIDや、IDの異なる置き換えはエラーにする */
export function replaceEntitiesChangeSet(
  document: CadDocument,
  replacements: readonly CadEntity[],
  label: string,
): ChangeSet {
  const seen = new Set<EntityId>();
  const changes: EntityChange[] = replacements.map((after) => {
    if (seen.has(after.id)) throw new Error(`同じ図形を2回置き換えようとしています: ${after.id}`);
    seen.add(after.id);
    const before = getEntity(document, after.id);
    if (before === undefined) throw new Error(`置き換える図形が見つかりません: ${after.id}`);
    return { kind: "replace" as const, before, after, index: indexOfEntity(document, after.id) };
  });
  return { label, changes };
}
