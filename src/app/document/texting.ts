// 文字(TEXT・MTEXT)の内容の書き換え(TEXTEDIT)を、図面に適用する。React にも画面にも依存しない。
// 1回の操作が、1つの変更(ChangeSet)で、Undo の1段階。位置・スタイル・レイヤーなどは変えない(文字列だけを置き換える)。
// 元データとの対応(sourceRecord)は、内容が変わったので reshaped の印つき(TRIM などと同じ規則。保存では、いまの内容で書く)。
import { replaceEntitiesChangeSet } from "../../core/history";
import { getEntity } from "../../core/model";
import type { EntityId } from "../../core/model";
import { checkTextInput } from "../../core/text/textInput";
import type { CadText } from "../../types/cad";
import type { Editability } from "./editability";
import type { DocumentSession } from "./documentSession";
import type { EditOutcome } from "./editing";
import { withReshapedRecord } from "./pieces";

const NAME = "文字編集";

/** 文字 id の内容を、text に書き換える。元の図形が、削除された・編集できない・文字でないときは、理由つきで断る */
export function editTextContent(session: DocumentSession, editability: Editability, id: EntityId, text: string): EditOutcome {
  const target = getEntity(session.document, id);
  if (target === undefined) return { ok: false, message: `${NAME}できませんでした: 元の図形が見つかりません(削除された可能性があります)` };
  const why = editability.reasonFor(id);
  if (why !== null) return { ok: false, message: `${NAME}できません: ${why}` };
  if (target.type !== "TEXT") return { ok: false, message: `${NAME}できません: ${target.type} は、文字ではありません` };

  // 複数行文字(または、もともと改行を含む文字)だけ、複数行にできる。1行の文字は、改行を空白にする
  const multiline = target.isMText === true || target.text.includes("\n");
  const checked = checkTextInput(text, multiline);
  if (!checked.ok) return { ok: false, message: `${NAME}できません: ${checked.message}` };
  if (checked.text === target.text) return { ok: false, message: `${NAME}: 内容が変わっていません` };

  const edited = withReshapedRecord({ ...(target as CadText), text: checked.text }, target);
  try {
    const outcome = session.apply(replaceEntitiesChangeSet(session.document, [edited], "文字を編集"));
    if (!outcome.ok) return { ok: false, message: `${NAME}できませんでした: ${outcome.error}` };
  } catch (error) {
    return { ok: false, message: `${NAME}できませんでした: ${error instanceof Error ? error.message : String(error)}` };
  }
  return { ok: true, message: "文字を書き換えました" };
}
