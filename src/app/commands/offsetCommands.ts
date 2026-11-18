// OFFSET(平行複写)と BREAK(2点間の切断)のコマンド。React にも画面にも依存しない。
// 図面は直接変更せず、依頼を返す。適用と履歴への記録は、画面の側が DocumentSession を通して行う(1回の操作 = Undoの1段階)。
//
// OFFSET: 距離(数値。T=通過点)→ 図形をクリック → 写す側(通過点のときは、通過点)をクリック → 続けて図形をクリック …(Enter・Esc で終了)。
//         元の図形は変えず、新しい図形を追加する。
// BREAK : 図形をクリック(そのクリックの位置が第1点)→ 第2点。F で、第1点を指定し直せる。第2点が第1点と同じなら、その点で2つに分ける。
//         円は、第1点から第2点まで、反時計回りに取り除く。
// 図形を指すクリックは、吸着しない(rawPoints): 吸着すると、ほかの図形の端点などへ吸い寄せられて、指したい図形が決まらないため。
import type { PreviewShape } from "../../core/commands";
import type { EntityId } from "../../core/model";
import type { Point2D } from "../../types/cad";
import { endedMessage, NOT_READY_MESSAGE } from "./editCommands";
import type { Step } from "./editCommands";
import { NO_DOCUMENT_MESSAGE } from "./types";
import type { AppCommandContext, AppCommandDefinition } from "./types";

const OFFSET_NAME = "オフセット";
const BREAK_NAME = "切断";

// ---- OFFSET ----

/** 写す側(通過点のときは、通過点)を指示する段階。distance が null なら、通過点 */
function offsetSideStep(context: AppCommandContext, id: EntityId, distance: number | null): Step {
  const preview = context.editing.createOffsetPreview(id);
  const step: Step = {
    type: "prompt",
    prompt: distance === null ? "通過点を指示してください[Enter=終了]" : "写す側の点を指示してください[Enter=終了]",
    expect: "point",
    acceptsEnter: true,
    // 距離を指定したときは、側を示すだけなので、吸着しない。通過点は、端点などに吸着して指示できる
    rawPoints: distance !== null,
    preview: (cursor): readonly PreviewShape[] => preview(distance, cursor),
    onInput: (input) => {
      if (input.kind === "enter") return { type: "done", messages: [endedMessage("OFFSET", "図形は、それまでの分だけ複写されています")] };
      if (input.kind !== "point") return step;
      // 反映の依頼を出して、図形を選ぶ段階へ戻る(次の図形を、続けて写せる)
      return { ...offsetPickStep(context, distance), messages: [], requests: [{ type: "offsetEntity", id, distance, point: input.point }] };
    },
  };
  return step;
}

/** 写す図形をクリックする段階 */
function offsetPickStep(context: AppCommandContext, distance: number | null): Step {
  const step: Step = {
    type: "prompt",
    prompt: "写す図形をクリックしてください[Enter=終了]",
    expect: "point",
    acceptsEnter: true,
    rawPoints: true,
    onInput: (input) => {
      if (input.kind === "enter") return { type: "done", messages: [endedMessage("OFFSET", "図形は、それまでの分だけ複写されています")] };
      if (input.kind !== "point") return step;
      const picked = context.editing.pickEntity(input.point, OFFSET_NAME);
      if (!picked.ok) return { ...step, messages: [picked.message] };
      return offsetSideStep(context, picked.id, distance);
    },
  };
  return step;
}

function offsetDistanceStep(context: AppCommandContext): Step {
  const step: Step = {
    type: "prompt",
    prompt: "オフセットの距離を数値で入力してください[T=通過点を指定/Enter=終了]",
    expect: "distance",
    keywords: ["T"],
    acceptsEnter: true,
    onInput: (input) => {
      if (input.kind === "enter") return { type: "done", messages: [endedMessage("OFFSET")] };
      if (input.kind === "keyword") return offsetPickStep(context, null);
      if (input.kind !== "distance") return step;
      if (!(input.value > 0) || !Number.isFinite(input.value)) return { ...step, messages: ["距離は、0 より大きい数にしてください"] };
      return offsetPickStep(context, input.value);
    },
  };
  return step;
}

// ---- BREAK ----

/** 第1点を指定し直す段階(F) */
function breakFirstPointStep(id: EntityId, context: AppCommandContext): Step {
  const step: Step = {
    type: "prompt",
    prompt: "第1点を指示してください",
    expect: "point",
    acceptsEnter: true,
    onInput: (input) => {
      if (input.kind === "enter") return { type: "done", messages: [endedMessage("BREAK")] };
      if (input.kind !== "point") return step;
      return breakSecondPointStep(id, input.point, context, []);
    },
  };
  return step;
}

function breakSecondPointStep(id: EntityId, first: Point2D, context: AppCommandContext, notice: readonly string[]): Step {
  const preview = context.editing.createBreakPreview(id, first);
  const step: Step = {
    type: "prompt",
    prompt: "第2点を指示してください[F=第1点を指定し直す/Enter=終了](第1点と同じ位置なら、その点で2つに分けます)",
    expect: "point",
    keywords: ["F"],
    acceptsEnter: true,
    basePoint: first,
    messages: notice,
    preview: (cursor): readonly PreviewShape[] => preview(cursor),
    onInput: (input) => {
      if (input.kind === "enter") return { type: "done", messages: [endedMessage("BREAK")] };
      if (input.kind === "keyword") return breakFirstPointStep(id, context);
      if (input.kind !== "point") return step;
      return { type: "done", requests: [{ type: "breakEntity", id, first, second: input.point }] };
    },
  };
  return step;
}

function breakPickStep(context: AppCommandContext): Step {
  const step: Step = {
    type: "prompt",
    prompt: "切断する図形をクリックしてください(クリックした位置が第1点になります)[Enter=終了]",
    expect: "point",
    acceptsEnter: true,
    rawPoints: true,
    onInput: (input) => {
      if (input.kind === "enter") return { type: "done", messages: [endedMessage("BREAK")] };
      if (input.kind !== "point") return step;
      const picked = context.editing.pickEntity(input.point, BREAK_NAME);
      if (!picked.ok) return { ...step, messages: [picked.message] };
      return breakSecondPointStep(picked.id, input.point, context, ["クリックした位置を、第1点にしました"]);
    },
  };
  return step;
}

function guard(context: AppCommandContext): { type: "done"; messages: readonly string[] } | null {
  if (!context.isDocumentOpen) return { type: "done", messages: [NO_DOCUMENT_MESSAGE] };
  if (!context.editing.ready) return { type: "done", messages: [NOT_READY_MESSAGE] };
  return null;
}

export const OFFSET_COMMANDS: readonly AppCommandDefinition[] = [
  {
    name: "OFFSET",
    aliases: ["O"],
    description: "図形を、距離だけ平行に複写する(繰り返せる)",
    start: (context) => guard(context) ?? offsetDistanceStep(context),
  },
  {
    name: "BREAK",
    aliases: ["BR"],
    description: "図形を、2点の間で切断する",
    start: (context) => guard(context) ?? breakPickStep(context),
  },
];
