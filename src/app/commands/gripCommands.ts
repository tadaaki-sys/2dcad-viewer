// グリップ・頂点のコマンド(GRIPEDIT・VERTEXADD・VERTEXDEL・PCLOSE・POPEN)(Phase 18)。React にも画面にも依存しない。
// 図面は直接変更せず、依頼を返す。適用と履歴への記録は、画面の側が DocumentSession を通して行う(app/document/gripEditing.ts)。
//
// GRIPEDIT は、グリップのクリックで、画面が始める(コマンド欄に打つものではない)。動かす先の点を待つ段階は、ふつうの点の指示なので、
// 吸着・ORTHO/POLAR・数値入力(長さ・角度)・Esc が、そのまま使える。
import { endedMessage, NOT_READY_MESSAGE, startWithTargets } from "./editCommands";
import type { Step } from "./editCommands";
import { NO_DOCUMENT_MESSAGE } from "./types";
import type { AppCommandDefinition } from "./types";

/** クリックした位置の折れ線を探して、依頼にする。見つからなければ、理由を知らせて、同じ段階に残る */
function vertexStep(name: string, noun: string, prompt: string, request: "addVertex" | "deleteVertex", pick: (point: { x: number; y: number }, name: string) => { ok: true; id: string } | { ok: false; message: string }): Step {
  // 指示した回数(1回ごとに、図面へ適用される)。終了のメッセージが、実際と食い違わないように
  let requested = 0;
  const step: Step = {
    type: "prompt",
    prompt,
    expect: "point",
    rawPoints: true,
    acceptsEnter: true,
    onInput: (input) => {
      if (input.kind === "enter") return { type: "done", messages: [endedMessage(name, requested > 0 ? `指示した ${requested} 回の分は、適用済みです` : "図形は変更されませんでした")] };
      if (input.kind !== "point") return step;
      const picked = pick(input.point, noun);
      if (!picked.ok) return { ...step, messages: [picked.message] };
      // 続けて、ほかの位置も指せる(1回ごとが、Undo の1段階)。Enter・Esc で終了
      requested++;
      return { ...step, messages: [], requests: [{ type: request, id: picked.id, point: input.point }] };
    },
  };
  return step;
}

export const GRIP_COMMANDS: readonly AppCommandDefinition[] = [
  {
    name: "GRIPEDIT",
    description: "グリップを動かす(図形を選んで、つかむ点をクリックすると始まる。コマンド欄から使うものではない)",
    start: (context) => {
      if (!context.isDocumentOpen) return { type: "done", messages: [NO_DOCUMENT_MESSAGE] };
      if (!context.editing.ready) return { type: "done", messages: [NOT_READY_MESSAGE] };
      const grip = context.editing.takePendingGrip();
      if (grip === null) return { type: "done", messages: ["GRIPEDIT: 動かすグリップが指定されていません(図形を選んで、グリップをクリックしてください)"] };
      const preview = context.editing.createGripPreview(grip.id, grip.index);
      const step: Step = {
        type: "prompt",
        prompt: "グリップの新しい位置を指示してください(Esc で取り消し)",
        expect: "point",
        acceptsEnter: true,
        basePoint: grip.point,
        preview: (cursor) => preview(cursor),
        onInput: (input) => {
          if (input.kind === "enter") return { type: "done", messages: [endedMessage("GRIPEDIT")] };
          if (input.kind !== "point") return step;
          return { type: "done", requests: [{ type: "moveGrip", id: grip.id, index: grip.index, point: input.point }] };
        },
      };
      return step;
    },
  },
  {
    name: "VERTEXADD",
    description: "折れ線の線分をクリックして、頂点を足す(Enter・Esc で終了)",
    start: (context) => {
      if (!context.isDocumentOpen) return { type: "done", messages: [NO_DOCUMENT_MESSAGE] };
      if (!context.editing.ready) return { type: "done", messages: [NOT_READY_MESSAGE] };
      const { editing } = context;
      return vertexStep("VERTEXADD", "頂点の追加", "頂点を足す折れ線の線分をクリックしてください(Enter で終了)", "addVertex", (point, noun) => editing.pickEntity(point, noun, "chain"));
    },
  },
  {
    name: "VERTEXDEL",
    description: "折れ線の頂点をクリックして、削除する(Enter・Esc で終了)",
    start: (context) => {
      if (!context.isDocumentOpen) return { type: "done", messages: [NO_DOCUMENT_MESSAGE] };
      if (!context.editing.ready) return { type: "done", messages: [NOT_READY_MESSAGE] };
      const { editing } = context;
      return vertexStep("VERTEXDEL", "頂点の削除", "削除する折れ線の頂点をクリックしてください(Enter で終了)", "deleteVertex", (point, noun) => editing.pickEntity(point, noun, "chain"));
    },
  },
  {
    name: "PCLOSE",
    description: "折れ線を閉じる",
    start: (context) =>
      startWithTargets("PCLOSE", context, (targets, notice) => ({ type: "done", messages: notice, requests: [{ type: "setPolylinesClosed", ids: targets, closed: true }] })),
  },
  {
    name: "POPEN",
    description: "折れ線を開く",
    start: (context) =>
      startWithTargets("POPEN", context, (targets, notice) => ({ type: "done", messages: notice, requests: [{ type: "setPolylinesClosed", ids: targets, closed: false }] })),
  },
];
