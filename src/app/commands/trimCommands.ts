// TRIM(トリム・切り取り)と EXTEND(延長)のコマンド。React にも画面にも依存しない。
// 流れ: 境界の図形を選ぶ(Enter。何も選ばずに Enter = すべての図形)→ 図形をクリック → 続けて何回でも(Enter・Esc で終了)。
// クリック1回ごとに、図面へ反映する(依頼を返して、コマンドは続ける)。Undo も、1クリックにつき1段階。
// 次のクリックは、反映後の形が相手になるため、コマンドの終わりまで待たない。
// クリックは、吸着しない(rawPoints)。吸着すると、境界との交点に吸い寄せられて、どちら側を切るか決まらないため。
import { NOT_READY_MESSAGE } from "./editCommands";
import type { Step } from "./editCommands";
import { NO_DOCUMENT_MESSAGE } from "./types";
import type { AppCommandContext, AppCommandDefinition } from "./types";

type Mode = "trim" | "extend";

const COMMAND_NAME: Record<Mode, string> = { trim: "TRIM", extend: "EXTEND" };

/** 境界を選んだあとの、クリックを繰り返す段階 */
function clickStep(mode: Mode, edgeIds: readonly string[] | null, notice: readonly string[]): Step {
  const step: Step = {
    type: "prompt",
    prompt:
      mode === "trim"
        ? "切り取る部分をクリックしてください[Enter=終了]"
        : "延ばす図形の、端に近い所をクリックしてください[Enter=終了]",
    expect: "point",
    acceptsEnter: true,
    rawPoints: true,
    messages: notice,
    onInput: (input) => {
      if (input.kind === "enter") return { type: "done", messages: [`${COMMAND_NAME[mode]} を終了しました`] };
      if (input.kind !== "point") return step;
      // 反映の依頼を出して、同じ段階で、次のクリックを待つ
      return { ...step, messages: [], requests: [{ type: "trimAt", mode, point: input.point, edgeIds }] };
    },
  };
  return step;
}

function start(mode: Mode, context: AppCommandContext): Step | { type: "done"; messages: readonly string[] } {
  if (!context.isDocumentOpen) return { type: "done", messages: [NO_DOCUMENT_MESSAGE] };
  if (!context.editing.ready) return { type: "done", messages: [NOT_READY_MESSAGE] };
  const word = mode === "trim" ? "切り取り境界" : "延長先の境界";
  return {
    type: "prompt",
    prompt: `${word}の図形を選択して、Enter を押してください(何も選ばずに Enter = すべての図形)`,
    expect: "selection",
    onInput: (input) => {
      // 何も選ばれていなければ、表示中のすべての図形が境界(edgeIds = null)
      const edgeIds = input.ids.length === 0 ? null : input.ids;
      const notice = [edgeIds === null ? "すべての図形を境界にします" : `境界の図形: ${edgeIds.length}個`];
      return clickStep(mode, edgeIds, notice);
    },
  };
}

export const TRIM_COMMANDS: readonly AppCommandDefinition[] = [
  { name: "TRIM", aliases: ["TR"], description: "境界で図形を切り取る(クリックを繰り返せる)", start: (context) => start("trim", context) },
  { name: "EXTEND", aliases: ["EX"], description: "境界まで図形を延ばす(クリックを繰り返せる)", start: (context) => start("extend", context) },
];
