// 選択中の図形の描画順を変える(TOFRONT・TOBACK)。React にも画面にも依存しない。
// 対象は、編集してよい図形(新しく描いた図形と、取り込んだ最上位の図形)。ブロックの中身・寸法などは、除く。
import { moveToBackChangeSet, moveToFrontChangeSet } from "../../core/history";
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
