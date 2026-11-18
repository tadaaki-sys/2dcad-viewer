// OFFSET(平行複写)を、図面に適用する。React にも画面にも依存しない。
// 1回の操作が、1つの変更(ChangeSet)で、Undo の1段階。元の図形は、変えない(新しい図形を1つ、描画順の末尾に追加する)。
// 新しい図形のレイヤー・色・線種・線の太さは、元の図形と同じ(core/geometry/offset.ts が、元の図形の属性を引き継ぐ)。
// 元データとの対応(sourceRecord)は、形が新しいので reshaped の印つきで、元の図形の記録を指す
// (保存のとき、元の記録の属性を引き継いで、いまの形で書くため。TRIM で分かれた片方と同じ規則)。新しく描いた図形のオフセットには付かない。
import { addEntitiesChangeSet } from "../../core/history";
import { getEntity } from "../../core/model";
import type { EntityId } from "../../core/model";
import { OFFSET_TYPES, offsetEntity, offsetSideTowards, offsetThroughPoint } from "../../core/geometry/offset";
import type { OffsetSide } from "../../core/geometry/offset";
import type { CadEntity, Point2D } from "../../types/cad";
import type { Editability } from "./editability";
import type { DocumentSession } from "./documentSession";
import { reshapedSourceRecord } from "./editing";
import type { EditOutcome } from "./editing";
import { isFinitePiece } from "./pieces";

const NAME = "オフセット";

/** 数値の表示(有効数字6桁まで。余分な 0 は付けない) */
const formatDistance = (value: number): string => String(Number(value.toPrecision(6)));

/**
 * 図形 id を、距離だけ、点 point のある側へ写す。distance が null なら、通過点(OFFSET の T): 点を通るように、距離と側を決める。
 * 元の図形が、削除された・編集できない・対象の種類でないときは、理由つきで断る。
 */
export function offsetAt(session: DocumentSession, editability: Editability, id: EntityId, distance: number | null, point: Point2D): EditOutcome {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return { ok: false, message: `${NAME}できませんでした: 点の位置が正しくありません` };
  const source = getEntity(session.document, id);
  if (source === undefined) return { ok: false, message: `${NAME}できませんでした: 元の図形が見つかりません(削除された可能性があります)` };
  const why = editability.reasonFor(id);
  if (why !== null) return { ok: false, message: `${NAME}できません: ${why}` };
  if (!OFFSET_TYPES.has(source.type)) return { ok: false, message: `${NAME}できません: ${source.type} は、${NAME}できません(線・円弧・円・折れ線が対象です)` };

  let amount: number;
  let side: OffsetSide;
  if (distance === null) {
    const through = offsetThroughPoint(source, point);
    if (through === null) return { ok: false, message: `${NAME}できません: 通過点が図形の上にあります(距離が0になります)` };
    amount = through.distance;
    side = through.side;
  } else {
    const towards = offsetSideTowards(source, point);
    if (towards === null) return { ok: false, message: `${NAME}できません: どちら側へ写すか決まりません(図形や、その延長線の上ではない点を指示してください)` };
    amount = distance;
    side = towards;
  }

  let created: CadEntity;
  try {
    const result = offsetEntity(source, amount, side);
    if (!result.ok) return { ok: false, message: `${NAME}できません: ${result.reason}` };
    if (!isFinitePiece(result.entity)) return { ok: false, message: `${NAME}できませんでした: 結果の座標が正しくありません` };
    const { sourceRecord: _ignored, ...shape } = result.entity;
    void _ignored;
    const record = reshapedSourceRecord(source);
    created = { ...shape, id: session.allocateEntityId(), ...(record === undefined ? {} : { sourceRecord: record }) } as CadEntity;
  } catch (error) {
    return { ok: false, message: `${NAME}できませんでした: ${error instanceof Error ? error.message : String(error)}` };
  }
  const outcome = session.apply(addEntitiesChangeSet(session.document, [created], "図形をオフセット"));
  if (!outcome.ok) return { ok: false, message: `${NAME}できませんでした: ${outcome.error}` };
  return { ok: true, message: `図形を${NAME}しました(距離 ${formatDistance(amount)})` };
}
