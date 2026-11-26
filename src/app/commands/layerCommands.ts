// レイヤー・線種・線の太さのコマンド(LAYER・LINETYPE・LINEWEIGHT・LTSCALE・LAYMOVE)。React にも画面にも依存しない。
// 図面は直接変更せず、依頼を返す。適用と履歴への記録は、画面の側が DocumentSession を通して行う(app/document/layering.ts)。
import { NOT_READY_MESSAGE, endedMessage, startWithTargets } from "./editCommands";
import type { Step } from "./editCommands";
import { NO_DOCUMENT_MESSAGE } from "./types";
import type { AppCommandContext, AppCommandDefinition, LayerPanelTab } from "./types";

function panelCommand(name: string, aliases: readonly string[], description: string, tab: LayerPanelTab): AppCommandDefinition {
  return {
    name,
    aliases,
    description,
    start: (context) => (context.isDocumentOpen ? { type: "done", requests: [{ type: "openLayers", tab }] } : { type: "done", messages: [NO_DOCUMENT_MESSAGE] }),
  };
}

function ltScaleStep(current: number): Step {
  const step: Step = {
    type: "prompt",
    prompt: `全体の線種尺度を入力してください(現在 ${current}。Enter で取り消し)`,
    expect: "text",
    onInput: (input) => {
      const text = input.text.trim();
      if (text === "") return { type: "done", messages: [endedMessage("LTSCALE", "線種尺度は変更されませんでした")] };
      // Number("") や Number("0x10") のような、数として読めてしまう文字は、数字だけの形に限って受ける
      if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(text)) return { ...step, messages: ["数値で入力してください(例: 0.5)"] };
      const value = Number(text);
      if (!Number.isFinite(value)) return { ...step, messages: ["数値で入力してください(例: 0.5)"] };
      return { type: "done", requests: [{ type: "setLineTypeScale", value }] };
    },
  };
  return step;
}

function layerNameStep(context: AppCommandContext, targets: readonly string[], notice: readonly string[]): Step {
  const current = context.drawTarget.ok ? context.drawTarget.layer : null;
  const step: Step = {
    type: "prompt",
    prompt: `移す先のレイヤー名を入力してください${current === null ? "" : `(Enter = 現在のレイヤー「${current}」)`}`,
    expect: "text",
    messages: notice,
    onInput: (input) => {
      const name = input.text.trim() === "" ? current : input.text.trim();
      if (name === null) return { ...step, messages: ["レイヤー名を入力してください"] };
      return { type: "done", requests: [{ type: "moveToLayer", ids: targets, layer: name }] };
    },
  };
  return step;
}

export const LAYER_COMMANDS: readonly AppCommandDefinition[] = [
  panelCommand("LAYER", ["LA"], "レイヤーの管理パネルを開く(作成・色・線種・線の太さ・名前・削除)", "layers"),
  panelCommand("LINETYPE", ["LT"], "線種の一覧と、全体の線種尺度のパネルを開く", "linetypes"),
  panelCommand("LINEWEIGHT", ["LW"], "線の太さの一覧のパネルを開く", "lineweights"),
  {
    name: "LTSCALE",
    aliases: ["LTS"],
    description: "全体の線種尺度(破線の長さの倍率)を変える",
    start: (context) => {
      if (!context.isDocumentOpen) return { type: "done", messages: [NO_DOCUMENT_MESSAGE] };
      if (!context.editing.ready) return { type: "done", messages: [NOT_READY_MESSAGE] };
      return ltScaleStep(context.ltScale);
    },
  },
  {
    name: "LAYMOVE",
    description: "選んだ図形を、別のレイヤーへ移す(ByLayer の色・線種・線の太さは、移した先に従う)",
    start: (context) => startWithTargets("LAYMOVE", context, (targets, notice) => layerNameStep(context, targets, notice)),
  },
];
