// グループ・描画順のコマンド(GROUP・UNGROUP・GROUPEDIT・GROUPS・PICKSTYLE・DRAWORDER・TEXTTOFRONT)(Phase 19)。
// React にも画面にも依存しない。図面は直接変更せず、依頼を返す(app/document/grouping.ts・reorder.ts が適用する)。
import { normalizeCommandName } from "../../core/commands";
import { NOT_READY_MESSAGE, startWithTargets } from "./editCommands";
import type { Step, Targets } from "./editCommands";
import { NO_DOCUMENT_MESSAGE } from "./types";
import type { AppCommandContext, AppCommandDefinition } from "./types";

function readyOrDone(context: AppCommandContext): { type: "done"; messages: readonly string[] } | null {
  if (!context.isDocumentOpen) return { type: "done", messages: [NO_DOCUMENT_MESSAGE] };
  if (!context.editing.ready) return { type: "done", messages: [NOT_READY_MESSAGE] };
  return null;
}

function groupNameStep(targets: Targets, notice: readonly string[]): Step {
  return {
    type: "prompt",
    prompt: "グループ名を入力してください(Enter = 名前なし)",
    expect: "text",
    messages: notice,
    onInput: (input) => ({ type: "done", requests: [{ type: "createGroup", ids: targets, name: input.text.trim() === "" ? null : input.text.trim() }] }),
  };
}

/** GROUPEDIT: 追加・除外を選んだあと、図形を選ぶ */
function groupEditSelectStep(name: string, mode: "add" | "remove"): Step {
  const step: Step = {
    type: "prompt",
    prompt: `${mode === "add" ? "足す" : "外す"}図形を選択して、Enter を押してください`,
    expect: "selection",
    // グループ単位の選択(PICKSTYLE)がオンでも、1つずつ選ぶ(広げると、外したい図形の仲間まで外れて、グループが消える)
    individualSelection: true,
    onInput: (input) => {
      if (input.ids.length === 0) return { ...step, messages: ["図形が選択されていません。選択してから Enter を押してください(Esc で取り消し)"] };
      return { type: "done", requests: [{ type: "editGroup", name, ids: input.ids, mode }] };
    },
  };
  return step;
}

function groupEditModeStep(name: string): Step {
  const step: Step = {
    type: "prompt",
    prompt: `グループ「${name}」: [追加(A)/除外(R)]`,
    expect: "text",
    onInput: (input) => {
      const answer = normalizeCommandName(input.text);
      if (answer === "A" || answer === "追加") return groupEditSelectStep(name, "add");
      if (answer === "R" || answer === "除外") return groupEditSelectStep(name, "remove");
      return { ...step, messages: ["A(追加)か R(除外)で答えてください"] };
    },
  };
  return step;
}

function groupEditNameStep(context: AppCommandContext): Step {
  // Enter の既定は、選択中の図形が入っているグループ
  const selected = context.editing.getSelection();
  const current = selected.map((id) => context.editing.groupNameOf(id)).find((name): name is string => name !== null) ?? null;
  const step: Step = {
    type: "prompt",
    prompt: `編集するグループの名前を入力してください${current === null ? "" : `(Enter = 「${current}」)`}`,
    expect: "text",
    onInput: (input) => {
      const name = input.text.trim() === "" ? current : input.text.trim();
      if (name === null) return { ...step, messages: ["グループ名を入力してください"] };
      return groupEditModeStep(name);
    },
  };
  return step;
}

function drawOrderReferenceStep(context: AppCommandContext, targets: Targets, kind: "above" | "below"): Step {
  const step: Step = {
    type: "prompt",
    prompt: `基準の図形をクリックしてください(選んだ図形を、その${kind === "above" ? "上" : "下"}へ)`,
    expect: "point",
    rawPoints: true,
    acceptsEnter: true,
    onInput: (input) => {
      if (input.kind === "enter") return { type: "done", messages: ["DRAWORDER を終了しました(描画順は変わりませんでした)"] };
      if (input.kind !== "point") return step;
      // 基準の図形は、ロック・読み取り専用でもよい(基準は動かさない。reorderEntities も、基準の編集の可否を問わない)
      const picked = context.editing.pickEntity(input.point, "描画順の基準", "reference");
      if (!picked.ok) return { ...step, messages: [picked.message] };
      if (targets.includes(picked.id)) return { ...step, messages: ["基準には、動かす図形以外を選んでください"] };
      return { type: "done", requests: [{ type: "drawOrder", ids: targets, placement: { kind, referenceId: picked.id } }] };
    },
  };
  return step;
}

function drawOrderPlacementStep(context: AppCommandContext, targets: Targets, notice: readonly string[]): Step {
  const step: Step = {
    type: "prompt",
    prompt: "置き場所を選んでください [前面(F)/背面(B)/上(A)/下(U)]",
    expect: "text",
    messages: notice,
    onInput: (input) => {
      const answer = normalizeCommandName(input.text);
      if (answer === "F" || answer === "前面") return { type: "done", requests: [{ type: "drawOrder", ids: targets, placement: { kind: "front" } }] };
      if (answer === "B" || answer === "背面") return { type: "done", requests: [{ type: "drawOrder", ids: targets, placement: { kind: "back" } }] };
      if (answer === "A" || answer === "上") return drawOrderReferenceStep(context, targets, "above");
      if (answer === "U" || answer === "下") return drawOrderReferenceStep(context, targets, "below");
      return { ...step, messages: ["F(前面)・B(背面)・A(上)・U(下)で答えてください"] };
    },
  };
  return step;
}

export const GROUP_COMMANDS: readonly AppCommandDefinition[] = [
  {
    name: "GROUP",
    aliases: ["G"],
    description: "選んだ図形で、グループを作る(名前は入力。Enter で名前なし)",
    start: (context) => startWithTargets("GROUP", context, (targets, notice) => groupNameStep(targets, notice)),
  },
  {
    name: "UNGROUP",
    description: "選んだ図形が入っているグループを、解除する",
    start: (context) => readyOrDone(context) ?? startWithTargets("UNGROUP", context, (targets, notice) => ({ type: "done", messages: notice, requests: [{ type: "ungroup", ids: targets }] })),
  },
  {
    name: "GROUPEDIT",
    description: "グループに図形を足す・外す",
    start: (context) => readyOrDone(context) ?? groupEditNameStep(context),
  },
  {
    name: "GROUPS",
    description: "グループの一覧のパネルを開く",
    start: (context) => (context.isDocumentOpen ? { type: "done", requests: [{ type: "openGroups" }] } : { type: "done", messages: [NO_DOCUMENT_MESSAGE] }),
  },
  {
    name: "PICKSTYLE",
    description: "グループ単位の選択の、オン・オフ(Ctrl+Shift+A)",
    start: (context) => (context.isDocumentOpen ? { type: "done", requests: [{ type: "togglePickStyle" }] } : { type: "done", messages: [NO_DOCUMENT_MESSAGE] }),
  },
  {
    name: "DRAWORDER",
    aliases: ["DR"],
    description: "選んだ図形の描画順を変える(前面・背面・基準の図形の上・下)",
    start: (context) => startWithTargets("DRAWORDER", context, (targets, notice) => drawOrderPlacementStep(context, targets, notice)),
  },
  {
    name: "TEXTTOFRONT",
    description: "文字・寸法を、まとめて最前面へ",
    start: (context) => readyOrDone(context) ?? { type: "done", requests: [{ type: "textToFront" }] },
  },
];
