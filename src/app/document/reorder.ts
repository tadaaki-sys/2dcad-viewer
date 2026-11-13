// 選択中の図形の描画順を変える(TOFRONT・TOBACK)。React にも画面にも依存しない。
// この Phase では、新しく描いた図形(ID が n<番号>)だけが対象。取り込んだ図形の順序変更は、編集してよい図形かの分類
// (io の editable / readOnly)をアプリの層へ渡す仕組みと一緒に、後の Phase で行う。
import { moveToBackChangeSet, moveToFrontChangeSet } from "../../core/history";
import { hasEntity, parseNewEntityCounter } from "../../core/model";
import type { DocumentSession } from "./documentSession";

export type ReorderDirection = "front" | "back";

/** 選択中の新しい図形を、最前面(front)・最背面(back)へ移す。結果の説明(コマンドラインに出す文)を返す */
export function reorderSelection(
  session: DocumentSession,
  selectedIds: Iterable<string>,
  direction: ReorderDirection,
): string {
  const targets: string[] = [];
  let ignored = 0;
  for (const id of selectedIds) {
    if (parseNewEntityCounter(id) !== null && hasEntity(session.document, id)) targets.push(id);
    else ignored++;
  }
  if (targets.length === 0) {
    return "新しく描いた図形が選択されていません(取り込んだ図形の順序は、まだ変えられません)";
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
  const note = ignored > 0 ? `(取り込んだ図形 ${ignored} 個は対象外)` : "";
  return `${targets.length}個の図形を${where}へ移動しました${note}`;
}
