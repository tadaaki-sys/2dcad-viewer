// 図面の変更の内容(ChangeSet)。ファイル形式にも画面にも依存しない。
//
// - Undo は、変更の内容を反転して適用することで行う(図面の複製は持たない)。
// - 保存(io/)は、この内容を元データの差分に変換する(docs/architecture.md の「今後の方針」)。
// - 1つのChangeSetは、全部成功するか、全部しないか(原子的)のどちらかで適用する(apply.ts)。
import type { CadDocument } from "../model/document";
import { getEntity, indexOfEntity } from "../model/document";
import type { EntityId } from "../model/ids";
import type { CadEntity, CadGroup, CadLayer } from "../../types/cad";

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
  | { kind: "replace"; before: CadEntity; after: CadEntity; index: number }
  /**
   * 描画順の入れ替え。from の位置にある図形(entity)を取り出し、取り出したあとの配列の to の位置に入れる。
   * (0以上、個数-1以下。後ろにあるほど上に描かれる)
   */
  | { kind: "move"; entity: CadEntity; from: number; to: number };

/**
 * レイヤー表・全体の線種尺度の変更(Phase 17)。図形の変更と同じ ChangeSet に入れて、1つの変更として適用する
 * (レイヤーの色を変えたら、ByLayer の図形の置き換えも、同じ Undo の1段階になる)。
 * 位置(index)は、「その変更を適用する直前の、レイヤー表の配列」での位置。
 * レイヤーの「表示・非表示」は、履歴の対象ではない(図面の表示設定)ので、置き換えでは、いまの表示状態を引き継ぐ。
 */
export type LayerChange =
  /** レイヤーを、表の index の位置に挿入する */
  | { kind: "layerAdd"; layer: CadLayer; index: number }
  /** index の位置にあるレイヤー(layer)を削除する。layer は、削除前のレイヤーそのもの(Undoで元に戻すために持つ) */
  | { kind: "layerRemove"; layer: CadLayer; index: number }
  /** index の位置にあるレイヤー(before)を、after に置き換える(名前・色・線種・線の太さ。位置は変わらない) */
  | { kind: "layerReplace"; before: CadLayer; after: CadLayer; index: number }
  /** 全体の線種尺度を、before から after に変える */
  | { kind: "ltScale"; before: number; after: number }
  /** グループを、グループ表の index の位置に足す(Phase 19) */
  | { kind: "groupAdd"; group: CadGroup; index: number }
  /** index の位置のグループ(group)を削除する。group は、削除前のグループそのもの */
  | { kind: "groupRemove"; group: CadGroup; index: number }
  /** index の位置のグループ(before)を、after に置き換える(名前・図形の一覧) */
  | { kind: "groupReplace"; before: CadGroup; after: CadGroup; index: number };

export type Change = EntityChange | LayerChange;

export type ChangeSet = {
  /** 利用者に見せる名前(例: 「線を追加」)。Undoの案内に使う */
  label: string;
  changes: readonly Change[];
};

/** 変更を反転する。追加と削除を入れ替え、置き換えの前後を入れ替え、順序を逆にする */
export function invertChangeSet(changeSet: ChangeSet): ChangeSet {
  const inverted: Change[] = [];
  for (let i = changeSet.changes.length - 1; i >= 0; i--) {
    const change = changeSet.changes[i];
    switch (change.kind) {
      case "add":
        inverted.push({ kind: "remove", entity: change.entity, index: change.index });
        break;
      case "remove":
        inverted.push({ kind: "add", entity: change.entity, index: change.index });
        break;
      case "move":
        inverted.push({ kind: "move", entity: change.entity, from: change.to, to: change.from });
        break;
      case "replace":
        inverted.push({ kind: "replace", before: change.after, after: change.before, index: change.index });
        break;
      case "layerAdd":
        inverted.push({ kind: "layerRemove", layer: change.layer, index: change.index });
        break;
      case "layerRemove":
        inverted.push({ kind: "layerAdd", layer: change.layer, index: change.index });
        break;
      case "layerReplace":
        inverted.push({ kind: "layerReplace", before: change.after, after: change.before, index: change.index });
        break;
      case "ltScale":
        inverted.push({ kind: "ltScale", before: change.after, after: change.before });
        break;
      case "groupAdd":
        inverted.push({ kind: "groupRemove", group: change.group, index: change.index });
        break;
      case "groupRemove":
        inverted.push({ kind: "groupAdd", group: change.group, index: change.index });
        break;
      case "groupReplace":
        inverted.push({ kind: "groupReplace", before: change.after, after: change.before, index: change.index });
        break;
    }
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

/** 指定した図形の、いまの描画順の位置を、小さい順に並べて返す。存在しないIDはエラー */
function sortedTargets(document: CadDocument, ids: readonly EntityId[]): Array<{ entity: CadEntity; index: number }> {
  const targets = [...new Set(ids)].map((id) => {
    const entity = getEntity(document, id);
    if (entity === undefined) throw new Error(`順序を変える図形が見つかりません: ${id}`);
    return { entity, index: indexOfEntity(document, id) };
  });
  targets.sort((a, b) => a.index - b.index);
  return targets;
}

/**
 * 図形を、最前面(描画順の末尾)へ移す変更を作る。指定した図形どうしの前後関係は、そのまま保つ。
 * すでに最前面にまとまっているときは、何も変わらないので null を返す。
 */
export function moveToFrontChangeSet(document: CadDocument, ids: readonly EntityId[], label: string): ChangeSet | null {
  const targets = sortedTargets(document, ids);
  const total = document.entities.length;
  const count = targets.length;
  if (count === 0) return null;
  if (targets[0].index === total - count && targets[count - 1].index === total - 1) return null;
  // 小さい順に末尾へ移す。前に移した図形の分だけ、あとの図形の位置は1つずつ前へずれる
  const changes: EntityChange[] = targets.map((target, i) => ({
    kind: "move" as const,
    entity: target.entity,
    from: target.index - i,
    to: total - 1,
  }));
  return { label, changes };
}

/** 図形を、最背面(描画順の先頭)へ移す変更を作る。前後関係は保つ。すでに最背面にまとまっているときは null */
export function moveToBackChangeSet(document: CadDocument, ids: readonly EntityId[], label: string): ChangeSet | null {
  const targets = sortedTargets(document, ids);
  const count = targets.length;
  if (count === 0) return null;
  if (targets[0].index === 0 && targets[count - 1].index === count - 1) return null;
  // 大きい順に先頭へ移す。前に移した図形の分だけ、あとの図形の位置は1つずつ後ろへずれる
  const changes: EntityChange[] = [];
  for (let i = 0; i < count; i++) {
    const target = targets[count - 1 - i];
    changes.push({ kind: "move", entity: target.entity, from: target.index + i, to: 0 });
  }
  return { label, changes };
}

/** 描画順の置き場所(Phase 19): 最前面・最背面・基準の図形の上(すぐ前面)・下(すぐ背面) */
export type DrawOrderPlacement = { kind: "front" } | { kind: "back" } | { kind: "above"; referenceId: EntityId } | { kind: "below"; referenceId: EntityId };

/**
 * 図形の描画順を変える変更を作る(Phase 19)。指定した図形どうしの前後関係は保つ。
 * 「取り出して(削除、位置の大きい順)、入れ直す(追加、位置の小さい順)」の形にする。適用は、どちらも1回の走査で済む
 * (1件ずつの move は、動かす数 × 図形数の時間になるため。大きな選択でも、速く)。図形は同じオブジェクトのまま。
 * すでにその並びになっているときは null。存在しない ID・基準が指定した図形に含まれるときは、エラー。
 */
export function drawOrderChangeSet(document: CadDocument, ids: readonly EntityId[], placement: DrawOrderPlacement, label: string): ChangeSet | null {
  const targets = sortedTargets(document, ids);
  const count = targets.length;
  if (count === 0) return null;
  const total = document.entities.length;
  let start: number;
  if (placement.kind === "front") start = total - count;
  else if (placement.kind === "back") start = 0;
  else {
    const reference = indexOfEntity(document, placement.referenceId);
    if (reference < 0) throw new Error(`基準の図形が見つかりません: ${placement.referenceId}`);
    if (targets.some((t) => t.entity.id === placement.referenceId)) throw new Error("基準の図形は、動かす図形に含められません");
    // 取り出したあとの、基準の図形の位置
    const before = targets.filter((t) => t.index < reference).length;
    const at = reference - before;
    start = placement.kind === "above" ? at + 1 : at;
  }
  // 入れ直したあとの位置が、元の位置と全部同じなら、並びは変わらない
  if (targets.every((t, j) => t.index === start + j)) return null;
  const changes: EntityChange[] = [];
  for (let j = count - 1; j >= 0; j--) changes.push({ kind: "remove", entity: targets[j].entity, index: targets[j].index });
  for (let j = 0; j < count; j++) changes.push({ kind: "add", entity: targets[j].entity, index: start + j });
  return { label, changes };
}