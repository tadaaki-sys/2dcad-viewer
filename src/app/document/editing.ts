// 図形の編集(移動・回転・複写・削除)を、図面に適用する。React にも画面にも依存しない。
// 1回の操作は、1つの変更(ChangeSet)にまとめて、DocumentSession に渡す。だから、複数の図形を一括で動かしても、
// 履歴は1段階で、Undo は1回で、全部が元に戻る(「100個の図形を移動」)。
import { addEntitiesChangeSet, removeEntitiesChangeSet, replaceEntitiesChangeSet } from "../../core/history";
import { getEntity, indexOfEntity } from "../../core/model";
import type { EntityId } from "../../core/model";
import { stretchEntityGeometry } from "../../core/geometry/stretch";
import type { StretchWindow } from "../../core/geometry/stretch";
import { composeAffine, IDENTITY_MATRIX, isIdentity, isSimilarity, transformEntityGeometry } from "../../core/geometry/transform";
import type { Affine2D, CadEntity, SourceRecord } from "../../types/cad";
import { isNewEntityId, resolveEditTargets } from "./editability";
import type { Editability } from "./editability";
import type { DocumentSession } from "./documentSession";

export type EditOutcome = { ok: true; message: string } | { ok: false; message: string };

function skippedNote(skipped: number, reason: string | null): string {
  return skipped > 0 ? `(編集できない図形 ${skipped} 個は除きました: ${reason ?? ""})` : "";
}

/** 図形を、描画順(図面の並び)の順に並べる。存在しないIDは除く */
function inDrawingOrder(session: DocumentSession, ids: readonly EntityId[]): CadEntity[] {
  return ids
    .map((id) => ({ entity: getEntity(session.document, id), index: indexOfEntity(session.document, id) }))
    .filter((item): item is { entity: CadEntity; index: number } => item.entity !== undefined)
    .sort((a, b) => a.index - b.index)
    .map((item) => item.entity);
}

/**
 * 元データとの対応(sourceRecord)を、変換 matrix を施した分だけ更新する。
 * - すでに対応がある図形: 行列を合成する
 * - 取り込んだ図形そのもの(対応がまだ無い): その図形自身の記録への対応を、新しく付ける
 * - 新しく描いた図形(元データに記録が無い): 付けない
 */
function nextSourceRecord(entity: CadEntity, matrix: Affine2D): SourceRecord | undefined {
  if (entity.sourceRecord !== undefined) {
    const composed = composeAffine(entity.sourceRecord.matrix, matrix);
    if (!composed.every(Number.isFinite)) throw new Error("変換の合成結果が大きすぎて、扱えません");
    // reshaped(頂点が個別に動いた印)は、そのまま引き継ぐ
    return { ...entity.sourceRecord, matrix: composed };
  }
  if (!isNewEntityId(entity.id)) return { id: entity.id, matrix };
  return undefined;
}

/** 図形を、移動・回転(matrix)で動かした、新しい図形。形以外は、そのまま。元データとの対応も更新する */
export function movedEntity(entity: CadEntity, matrix: Affine2D): CadEntity {
  const moved = transformEntityGeometry(entity, matrix);
  const sourceRecord = nextSourceRecord(entity, matrix);
  if (sourceRecord === undefined) return moved;
  return { ...moved, sourceRecord };
}

/** 変換が何も動かさないときの、断りの文(操作の名前ごと) */
function noChangeMessage(noun: string): string {
  if (noun === "回転") return "回転角が0度です";
  if (noun === "拡大縮小") return "倍率が1です";
  return `${noun}量が0です`;
}

/** 選んだ図形を、移動・回転・拡大縮小・鏡像(相似変換)で動かす。編集できない図形は、除く。結果の説明を返す */
export function transformEntities(
  session: DocumentSession,
  editability: Editability,
  ids: readonly EntityId[],
  matrix: Affine2D,
  label: string,
  /** 操作の名前(「移動」「回転」)。メッセージに使う */
  noun: string,
): EditOutcome {
  if (!isSimilarity(matrix)) return { ok: false, message: `${noun}できませんでした: 移動・回転・拡大縮小・鏡像以外の変換は、扱えません` };
  if (isIdentity(matrix)) return { ok: false, message: noChangeMessage(noun) };
  const targets = resolveEditTargets(editability, ids);
  const entities = inDrawingOrder(session, targets.editable);
  if (entities.length === 0) {
    return { ok: false, message: `${noun}できる図形がありません${skippedNote(targets.skipped, targets.reason)}` };
  }
  let changeSet;
  try {
    changeSet = replaceEntitiesChangeSet(session.document, entities.map((entity) => movedEntity(entity, matrix)), label);
  } catch (error) {
    return { ok: false, message: `${noun}できませんでした: ${error instanceof Error ? error.message : String(error)}` };
  }
  const outcome = session.apply(changeSet);
  if (!outcome.ok) return { ok: false, message: `${noun}できませんでした: ${outcome.error}` };
  return { ok: true, message: `${entities.length}個の図形を${noun}しました${skippedNote(targets.skipped, targets.reason)}` };
}

/**
 * 選んだ図形を、複写する。matrices の1つごとに、全図形の複写を作る(1回の複写が、1つの matrix)。
 * 複写は、新しい図形(ID は n<番号>)として、描画順の末尾に、もとの前後関係を保って追加する。まとめて、履歴の1段階。
 * 取り込んだ図形の複写には、元データとの対応(sourceRecord)を付ける(保存のとき、元の記録の属性を引き継いで書くため)。
 */
export function copyEntities(
  session: DocumentSession,
  editability: Editability,
  ids: readonly EntityId[],
  matrices: readonly Affine2D[],
  label: string,
): EditOutcome {
  if (matrices.length === 0) return { ok: false, message: "複写の位置が指示されていません" };
  if (!matrices.every((matrix) => isSimilarity(matrix) && !isIdentity(matrix))) return { ok: false, message: "複写できませんでした: 何も動かさない、または、移動・回転・拡大縮小・鏡像以外の変換です" };
  const targets = resolveEditTargets(editability, ids);
  const sources = inDrawingOrder(session, targets.editable);
  if (sources.length === 0) return { ok: false, message: `複写できる図形がありません${skippedNote(targets.skipped, targets.reason)}` };

  // まず、全部の複写の形を作る(変換に失敗したら、ID を払い出す前に、何も確定せずに終える)。ID は、そのあとで付ける。
  const shaped: CadEntity[] = [];
  try {
    for (const matrix of matrices) {
      for (const source of sources) {
        // もとの図形が、元データの記録を持っているとき(取り込んだ図形、または、その複写)は、その記録への対応を引き継ぐ
        const root: SourceRecord | undefined = source.sourceRecord ?? (isNewEntityId(source.id) ? undefined : { id: source.id, matrix: IDENTITY_MATRIX });
        const { sourceRecord: _ignored, ...withoutRecord } = source;
        void _ignored;
        const copy: CadEntity = root === undefined ? withoutRecord : { ...withoutRecord, sourceRecord: root };
        // 複写した寸法は、連動しない寸法にする(複写を動かした点が、参照している図形から外れたまま、参照だけが残ると、
        // 参照した図形が変わったとき、複写が、図形の位置へ引き戻されるため)
        const plain: CadEntity = copy.type === "DIMENSION" && copy.refs !== undefined ? withoutRefs(copy) : copy;
        shaped.push(movedEntity(plain, matrix));
      }
    }
  } catch (error) {
    return { ok: false, message: `複写できませんでした: ${error instanceof Error ? error.message : String(error)}` };
  }
  const copies: CadEntity[] = shaped.map((entity) => ({ ...entity, id: session.allocateEntityId() }));
  const outcome = session.apply(addEntitiesChangeSet(session.document, copies, label));
  if (!outcome.ok) return { ok: false, message: `複写できませんでした: ${outcome.error}` };
  return { ok: true, message: `${sources.length}個の図形を${matrices.length}回、複写しました(合計 ${copies.length} 個を追加)${skippedNote(targets.skipped, targets.reason)}` };
}

/** 寸法から、関連付け(refs)を除いたもの */
function withoutRefs(dimension: Extract<CadEntity, { type: "DIMENSION" }>): CadEntity {
  const { refs: _refs, ...rest } = dimension;
  void _refs;
  return rest;
}

/** 選んだ図形を、削除する。編集できない図形は、除く */
export function deleteEntities(session: DocumentSession, editability: Editability, ids: readonly EntityId[], label: string): EditOutcome {
  const targets = resolveEditTargets(editability, ids);
  const entities = inDrawingOrder(session, targets.editable);
  if (entities.length === 0) return { ok: false, message: `削除できる図形がありません${skippedNote(targets.skipped, targets.reason)}` };
  let changeSet;
  try {
    changeSet = removeEntitiesChangeSet(session.document, entities.map((entity) => entity.id), label);
  } catch (error) {
    return { ok: false, message: `削除できませんでした: ${error instanceof Error ? error.message : String(error)}` };
  }
  const outcome = session.apply(changeSet);
  if (!outcome.ok) return { ok: false, message: `削除できませんでした: ${outcome.error}` };
  return { ok: true, message: `${entities.length}個の図形を削除しました${skippedNote(targets.skipped, targets.reason)}` };
}

/** ストレッチで形が変わった図形の、元データとの対応(reshaped の印を付ける)。新しく描いた図形には付かない */
export function reshapedSourceRecord(entity: CadEntity): SourceRecord | undefined {
  const root: SourceRecord | undefined = entity.sourceRecord ?? (isNewEntityId(entity.id) ? undefined : { id: entity.id, matrix: IDENTITY_MATRIX });
  return root === undefined ? undefined : { ...root, reshaped: true };
}

/**
 * 交差窓の中の頂点・端点を、(dx, dy)だけ動かして、図形の形を変える(STRETCH)。ids は、窓にかかる図形の候補。
 * 図形ごとの扱いは、core/geometry/stretch.ts。1つの依頼が、Undoの1段階。
 * 円弧・楕円・(半径・直径・角度の)寸法で、一部だけが窓に入っているものは、対象外(数を知らせる)。
 */
export function stretchEntities(
  session: DocumentSession,
  editability: Editability,
  ids: readonly EntityId[],
  window: StretchWindow,
  dx: number,
  dy: number,
  label: string,
): EditOutcome {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return { ok: false, message: "ストレッチできませんでした: 移動量が正しくありません" };
  if (dx === 0 && dy === 0) return { ok: false, message: "移動量が0です" };
  const targets = resolveEditTargets(editability, ids);
  const entities = inDrawingOrder(session, targets.editable);

  const replacements: CadEntity[] = [];
  let moved = 0;
  let reshaped = 0;
  let partial = 0;
  try {
    for (const entity of entities) {
      const outcome = stretchEntityGeometry(entity, window, dx, dy);
      if (outcome.kind === "moved") {
        const sourceRecord = nextSourceRecord(entity, outcome.matrix);
        replacements.push(sourceRecord === undefined ? outcome.entity : { ...outcome.entity, sourceRecord });
        moved++;
      } else if (outcome.kind === "reshaped") {
        const sourceRecord = reshapedSourceRecord(entity);
        replacements.push(sourceRecord === undefined ? outcome.entity : { ...outcome.entity, sourceRecord });
        reshaped++;
      } else if (outcome.kind === "partial-skipped") {
        partial++;
      }
    }
  } catch (error) {
    return { ok: false, message: `ストレッチできませんでした: ${error instanceof Error ? error.message : String(error)}` };
  }
  const notes = `${partial > 0 ? `(円弧・楕円・寸法 ${partial} 個は、一部だけが窓に入っているため、対象外)` : ""}${skippedNote(targets.skipped, targets.reason)}`;
  if (replacements.length === 0) return { ok: false, message: `窓の中に、動かせる頂点や図形がありません${notes}` };

  let changeSet;
  try {
    changeSet = replaceEntitiesChangeSet(session.document, replacements, label);
  } catch (error) {
    return { ok: false, message: `ストレッチできませんでした: ${error instanceof Error ? error.message : String(error)}` };
  }
  const outcome = session.apply(changeSet);
  if (!outcome.ok) return { ok: false, message: `ストレッチできませんでした: ${outcome.error}` };
  return { ok: true, message: `${replacements.length}個の図形をストレッチしました(形が変わった ${reshaped} 個、図形ごと移動 ${moved} 個)${notes}` };
}
