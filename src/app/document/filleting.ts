// FILLET(角の丸め)・CHAMFER(角の面取り)を、図面に適用する。React にも画面にも依存しない。
// 1回の操作が、1つの変更(ChangeSet)で、Undo の1段階。
//   - 別々の2本の線: 2本を置き換え + 円弧(面取りは線)を1つ追加(描画順の末尾)。半径(距離)0 のときは、2本を置き換えるだけ。
//   - 1本の折れ線の隣り合う2本の線分: その折れ線を置き換えるだけ(円弧は、折れ線の頂点になる)。
// 元データとの対応(sourceRecord)は、形が変わったので reshaped の印つき(TRIM・OFFSET と同じ規則):
//   置き換えた図形は、それぞれ自分の記録。新しく足す円弧・線は、1つ目の図形の記録(属性も、1つ目と同じ)。新しく描いた図形には付かない。
import { addEntitiesChangeSet, replaceEntitiesChangeSet } from "../../core/history";
import type { ChangeSet } from "../../core/history";
import { getEntity } from "../../core/model";
import type { EntityId } from "../../core/model";
import { cornerEntities, FILLET_TYPES } from "../../core/geometry/fillet";
import type { CornerMode } from "../../core/geometry/fillet";
import type { CadEntity, Point2D } from "../../types/cad";
import type { Editability } from "./editability";
import type { DocumentSession } from "./documentSession";
import type { EditOutcome } from "./editing";
import { isFinitePiece, withReshapedRecord } from "./pieces";

/** 数値の表示(有効数字6桁まで。余分な 0 は付けない) */
const formatNumber = (value: number): string => String(Number(value.toPrecision(6)));

/** 図形を指したクリック(図形のIDと、クリックした位置) */
export type CornerTarget = { id: EntityId; point: Point2D };

/**
 * 2つの図形 first・second の角を、丸める・面取りする。
 * 元の図形が、削除された・編集できない・対象の種類でないときは、理由つきで断る。
 */
export function cornerAt(session: DocumentSession, editability: Editability, mode: CornerMode, first: CornerTarget, second: CornerTarget): EditOutcome {
  const name = mode.kind === "fillet" ? "フィレット" : "面取り";
  const label = mode.kind === "fillet" ? "角を丸める" : "角を面取りする";
  const document = session.document;
  const firstEntity = getEntity(document, first.id);
  const secondEntity = getEntity(document, second.id);
  if (firstEntity === undefined || secondEntity === undefined) {
    return { ok: false, message: `${name}できませんでした: 元の図形が見つかりません(削除された可能性があります)` };
  }
  for (const entity of [firstEntity, secondEntity]) {
    const why = editability.reasonFor(entity.id);
    if (why !== null) return { ok: false, message: `${name}できません: ${why}` };
    if (!FILLET_TYPES.has(entity.type)) return { ok: false, message: `${name}できません: ${entity.type} は、${name}できません(線・折れ線が対象です)` };
  }

  let changeSet: ChangeSet;
  try {
    const result = cornerEntities(firstEntity, first.point, secondEntity, second.point, mode);
    if (!result.ok) return { ok: false, message: `${name}できません: ${result.reason}` };
    const sourceOf = (id: EntityId): CadEntity => (id === first.id ? firstEntity : secondEntity);
    const replaced = result.replaced.map((entity) => withReshapedRecord(entity, sourceOf(entity.id)));
    // 新しく足す図形の、記録は1つ目の図形のもの。結果が壊れていないか、IDを払い出す前に確認する
    const addedShapes = result.added.map((entity) => withReshapedRecord(entity, firstEntity));
    if ([...replaced, ...addedShapes].some((entity) => !isFinitePiece(entity))) {
      return { ok: false, message: `${name}できませんでした: 結果の座標が正しくありません` };
    }
    // 例外を投げうる変更の組み立てを先に行い、そのあとで ID を払い出す(組み立てに失敗しても、番号を使わない)
    const replace = replaceEntitiesChangeSet(document, replaced, label);
    const added = addedShapes.map((entity) => ({ ...entity, id: session.allocateEntityId() }) as CadEntity);
    changeSet = { label, changes: [...replace.changes, ...addEntitiesChangeSet(document, added, label).changes] };
  } catch (error) {
    return { ok: false, message: `${name}できませんでした: ${error instanceof Error ? error.message : String(error)}` };
  }
  const outcome = session.apply(changeSet);
  if (!outcome.ok) return { ok: false, message: `${name}できませんでした: ${outcome.error}` };

  if (mode.kind === "fillet") {
    return { ok: true, message: mode.radius === 0 ? "角を作りました(半径 0: 2本の線を、交点で結びました)" : `角を丸めました(半径 ${formatNumber(mode.radius)})` };
  }
  if (mode.distance1 === 0) return { ok: true, message: "角を作りました(距離 0: 2本の線を、交点で結びました)" };
  return { ok: true, message: `角を面取りしました(距離 ${formatNumber(mode.distance1)}, ${formatNumber(mode.distance2)})` };
}
