// 図形を、「残る図形の一覧(pieces)」に置き換える(TRIM・BREAK 共通)。React にも画面にも依存しない。
// 1つ残る=置き換え、2つに分かれる=置き換え + 追加(2つ目は新しい図形で、元の図形のすぐ上の描画順に入る)、無くなる=削除。
// 全部を1つの変更(ChangeSet)にして、Undo の1段階にする。
// 元データとの対応は、形が変わったので reshaped の印を付ける(分かれた2つ目も、同じ元の記録を指す。コピーと同じ規則)。
import { removeEntitiesChangeSet, replaceEntitiesChangeSet } from "../../core/history";
import type { ChangeSet } from "../../core/history";
import { indexOfEntity } from "../../core/model";
import type { CadEntity } from "../../types/cad";
import type { DocumentSession } from "./documentSession";
import { reshapedSourceRecord } from "./editing";

/** 結果の図形の座標が、すべて有限か(桁あふれ・計算の失敗で、壊れた図形を作らないための確認) */
export function isFinitePiece(entity: CadEntity): boolean {
  switch (entity.type) {
    case "LINE":
      return [entity.start.x, entity.start.y, entity.end.x, entity.end.y].every(Number.isFinite);
    case "LWPOLYLINE":
    case "POLYLINE":
      return entity.vertices.every((v) => Number.isFinite(v.x) && Number.isFinite(v.y));
    case "CIRCLE":
      return [entity.center.x, entity.center.y, entity.radius].every(Number.isFinite);
    case "ARC":
      return [entity.center.x, entity.center.y, entity.radius, entity.startAngle, entity.endAngle].every(Number.isFinite);
    default:
      return true;
  }
}

export type PiecesOutcome = { ok: true; detail: string } | { ok: false; message: string };

/**
 * target を pieces に置き換える。pieces[0] は、target の代わり(IDを保つ)。pieces[1] は、新しい図形。
 * @param removedDetail 図形が無くなったとき(pieces が空)の、メッセージの補足
 */
export function applyPieces(session: DocumentSession, target: CadEntity, pieces: readonly CadEntity[], label: string, name: string, removedDetail: string): PiecesOutcome {
  if (pieces.some((piece) => !isFinitePiece(piece))) return { ok: false, message: `${name}できませんでした: 結果の座標が正しくありません` };
  const document = session.document;
  const record = reshapedSourceRecord(target);
  // 結果の図形が、もとの記録を持っていても、いったん外して、対応を付け直す(対応を持たない図形には、付けない)
  const withRecord = (entity: CadEntity): CadEntity => {
    const { sourceRecord: _inherited, ...shape } = entity;
    void _inherited;
    return (record === undefined ? shape : { ...shape, sourceRecord: record }) as CadEntity;
  };
  let changeSet: ChangeSet;
  let detail: string;
  try {
    if (pieces.length === 0) {
      changeSet = removeEntitiesChangeSet(document, [target.id], label);
      detail = removedDetail;
    } else {
      const replace = replaceEntitiesChangeSet(document, [withRecord(pieces[0])], label);
      if (pieces.length === 1) {
        changeSet = replace;
        detail = "";
      } else {
        // 2つに分かれた: 2つ目は、新しい図形。元の図形のすぐ上の描画順に入れる
        const second = { ...withRecord(pieces[1]), id: session.allocateEntityId() } as CadEntity;
        changeSet = { label, changes: [...replace.changes, { kind: "add", entity: second, index: indexOfEntity(document, target.id) + 1 }] };
        detail = "(2つの図形に分かれました)";
      }
    }
  } catch (error) {
    return { ok: false, message: `${name}できませんでした: ${error instanceof Error ? error.message : String(error)}` };
  }
  const outcome = session.apply(changeSet);
  if (!outcome.ok) return { ok: false, message: `${name}できませんでした: ${outcome.error}` };
  return { ok: true, detail };
}
