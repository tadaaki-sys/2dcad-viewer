// 選択中の図形の描画順を変える(TOFRONT・TOBACK)。React にも画面にも依存しない。
// 対象は、編集してよい図形(新しく描いた図形と、取り込んだ最上位の図形)。ブロックの中身・寸法などは、除く。
import { drawOrderChangeSet, moveToBackChangeSet, moveToFrontChangeSet } from "../../core/history";
import type { DrawOrderPlacement } from "../../core/history";
import type { EditOutcome } from "./editing";
import { hasEntity } from "../../core/model";
import type { Editability } from "./editability";
import { resolveEditTargets } from "./editability";
import type { DocumentSession } from "./documentSession";

export type ReorderDirection = "front" | "back";

/** 選択中の編集できる図形を、最前面(front)・最背面(back)へ移す。結果の説明(コマンドラインに出す文)を返す */
export function reorderSelection(
  session: DocumentSession,
  editability: Editability,
  selectedIds: Iterable<string>,
  direction: ReorderDirection,
): string {
  const resolved = resolveEditTargets(editability, selectedIds);
  const targets = resolved.editable.filter((id) => hasEntity(session.document, id));
  if (targets.length === 0) {
    return resolved.skipped > 0
      ? `編集できる図形が選択されていません(${resolved.reason ?? "対象がありません"})`
      : "図形が選択されていません";
  }

  const where = direction === "front" ? "最前面" : "最背面";
  const label = `${where}へ移動`;
  let changeSet;
  try {
    changeSet =
      direction === "front"
        ? moveToFrontChangeSet(session.document, targets, label)
        : moveToBackChangeSet(session.document, targets, label);
  } catch (error) {
    return `順序を変えられませんでした: ${error instanceof Error ? error.message : String(error)}`;
  }
  if (changeSet === null) return `選択中の図形は、すでに${where}にあります`;

  const outcome = session.apply(changeSet);
  if (!outcome.ok) return `順序を変えられませんでした: ${outcome.error}`;
  const note = resolved.skipped > 0 ? `(編集できない図形 ${resolved.skipped} 個は対象外)` : "";
  return `${targets.length}個の図形を${where}へ移動しました${note}`;
}

const PLACEMENT_WORDS: Record<DrawOrderPlacement["kind"], string> = { front: "最前面", back: "最背面", above: "基準の図形の上", below: "基準の図形の下" };

/**
 * 図形(編集できるもの)の描画順を変える(DRAWORDER。Phase 19): 最前面・最背面・基準の図形の上・下。1回が Undo の1段階。
 * 基準の図形は、編集できなくてもよい(動かさないので)。
 */
export function reorderEntities(session: DocumentSession, editability: Editability, ids: Iterable<string>, placement: DrawOrderPlacement): EditOutcome {
  const resolved = resolveEditTargets(editability, ids);
  const targets = resolved.editable.filter((id) => hasEntity(session.document, id) && (placement.kind === "front" || placement.kind === "back" || id !== placement.referenceId));
  const note = resolved.skipped > 0 ? `(編集できない図形 ${resolved.skipped} 個は対象外: ${resolved.reason ?? ""})` : "";
  if (targets.length === 0) return { ok: false, message: `描画順を変えられる図形がありません${note}` };
  const where = PLACEMENT_WORDS[placement.kind];
  let changeSet;
  try {
    changeSet = drawOrderChangeSet(session.document, targets, placement, `${where}へ移動`);
  } catch (error) {
    return { ok: false, message: `描画順を変えられませんでした: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (changeSet === null) return { ok: false, message: `選んだ図形は、すでに${where}にあります` };
  const outcome = session.apply(changeSet);
  if (!outcome.ok) return { ok: false, message: `描画順を変えられませんでした: ${outcome.error}` };
  return { ok: true, message: `${targets.length}個の図形を${where}へ移動しました${note}` };
}

/** 文字・寸法(編集できるもの)を、まとめて最前面へ送る(TEXTTOFRONT。Phase 19) */
export function textToFront(session: DocumentSession, editability: Editability): EditOutcome {
  const ids = session.document.entities.filter((entity) => entity.type === "TEXT" || entity.type === "DIMENSION").map((entity) => entity.id);
  if (ids.length === 0) return { ok: false, message: "文字・寸法がありません" };
  return reorderEntities(session, editability, ids, { kind: "front" });
}