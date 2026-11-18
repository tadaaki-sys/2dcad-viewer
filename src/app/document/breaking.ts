// BREAK(2点間の切断)を、図面に適用する。React にも画面にも依存しない。
// 1回の操作が、1つの変更(ChangeSet)で、Undo の1段階。結果の扱い(置き換え・分割・削除、元データとの対応)は、TRIM と同じ(pieces.ts)。
import { getEntity } from "../../core/model";
import type { EntityId } from "../../core/model";
import { breakEntity } from "../../core/geometry/break";
import type { Point2D } from "../../types/cad";
import type { Editability } from "./editability";
import type { DocumentSession } from "./documentSession";
import type { EditOutcome } from "./editing";
import { applyPieces } from "./pieces";
import { CURVE_TYPES } from "./picking";

const NAME = "切断";

/** 図形 id を、2点 first・second の間で切断する。元の図形が、削除された・編集できない・対象の種類でないときは、理由つきで断る */
export function breakAt(session: DocumentSession, editability: Editability, id: EntityId, first: Point2D, second: Point2D): EditOutcome {
  const target = getEntity(session.document, id);
  if (target === undefined) return { ok: false, message: `${NAME}できませんでした: 元の図形が見つかりません(削除された可能性があります)` };
  const why = editability.reasonFor(id);
  if (why !== null) return { ok: false, message: `${NAME}できません: ${why}` };
  if (!CURVE_TYPES.has(target.type)) return { ok: false, message: `${NAME}できません: ${target.type} は、${NAME}できません(線・円弧・円・折れ線が対象です)` };

  let result;
  try {
    result = breakEntity(target, first, second);
  } catch (error) {
    return { ok: false, message: `${NAME}できませんでした: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!result.ok) return { ok: false, message: `${NAME}できません: ${result.reason}` };
  const applied = applyPieces(session, target, result.pieces, "図形を切断", NAME, "(図形の全体を取り除いたため、図形を削除しました)");
  if (!applied.ok) return applied;
  return { ok: true, message: `図形を${NAME}しました${applied.detail}` };
}
