// 文字のコマンド(TEXT・MTEXT・TEXTEDIT・TEXTSTYLE)。React にも画面にも依存しない。
// 図面は直接変更せず、依頼を返す。適用と履歴への記録は、画面の側が DocumentSession を通して行う(1回の操作 = Undoの1段階)。
//
// TEXT    : 挿入点 → 回転角(角度の数値、または点。Enter = 0度)→ 文字を入力(1行)→ 図形を1つ追加。
// MTEXT   : 枠の1つ目の角 → 反対の角(枠の幅になる)→ 文字を入力(複数行)→ 図形を1つ追加。枠の幅で折り返す。
// TEXTEDIT: 文字をクリック → 内容を直す(位置・スタイルは変えない)。
// TEXTSTYLE: 文字スタイルの管理パネルを開く。
// 文字の入力は、画面の入力パネルで行う(段階が editor を宣言する)。入力した文字は、ふつうの TextInput として受け取る。
// 文字の見た目(フォント・高さ・幅係数・斜体・配置)は、コマンドを始めた時点の現在のスタイルの値を、そのまま使う。
import type { CommandStep, PreviewShape } from "../../core/commands";
import { checkTextInput } from "../../core/text/textInput";
import type { TextStyle } from "../../core/text/textStyle";
import type { Point2D } from "../../types/cad";
import { isSamePoint, makeText, rectangleCorners } from "../drawing/newEntities";
import type { DrawingStyle } from "../drawing/newEntities";
import { drawingStyleOf } from "./drawCommands";
import { endedMessage, NOT_READY_MESSAGE } from "./editCommands";
import type { Step } from "./editCommands";
import { NO_DOCUMENT_MESSAGE } from "./types";
import type { AppCommandContext, AppCommandDefinition, AppRequest } from "./types";

const TWO_PI = Math.PI * 2;
const EDIT_NAME = "文字編集";
/** 複数行文字の枠の幅の上限(mm)。これを超える枠は、断る */
const MAX_BOX_WIDTH = 1e9;

/** 角度(度)を、0 以上 2π 未満のラジアンにする。先に 360 で割った余りにする(巨大な値で、掛け算が桁あふれして NaN にならないように) */
const radiansOf = (degrees: number): number => ((((degrees % 360) + 360) % 360) * Math.PI) / 180;

/** 文字を入力する段階(画面の入力パネル)。accept が、確かめた文字から、次の段階(または終了)を作る */
function textInputStep(prompt: string, multiline: boolean, initial: string | undefined, accept: (text: string) => CommandStep<AppRequest>): Step {
  const step: Step = {
    type: "prompt",
    prompt,
    expect: "text",
    editor: { multiline, initial },
    onInput: (input) => {
      const checked = checkTextInput(input.text, multiline);
      // 入力した文字は、直せるように、パネルに残す(パネルは、状態が進むたびに作り直されるので、最初の文字として渡す)
      if (!checked.ok) return { ...step, editor: { multiline, initial: input.text }, messages: [checked.message] };
      return accept(checked.text);
    },
  };
  return step;
}

// ---- TEXT ----

function textRotationStep(position: Point2D, drawing: DrawingStyle, textStyle: TextStyle, context: AppCommandContext): Step {
  const step: Step = {
    type: "prompt",
    prompt: "回転角を指示してください(角度の数値、または点。Enter = 0度)",
    expect: "point",
    acceptsEnter: true,
    acceptsDistance: true,
    numberMeaning: "angle",
    basePoint: position,
    preview: (cursor): readonly PreviewShape[] => (isSamePoint(position, cursor) ? [] : [{ kind: "polyline", points: [position, cursor], closed: false }]),
    onInput: (input) => {
      let rotation: number;
      if (input.kind === "enter") rotation = 0;
      else if (input.kind === "distance") {
        if (!Number.isFinite(input.value)) return { ...step, messages: ["角度は、数値で入力してください"] };
        rotation = radiansOf(input.value);
        if (!Number.isFinite(rotation)) return { ...step, messages: ["角度は、数値で入力してください"] };
      } else if (input.kind === "point") {
        if (isSamePoint(position, input.point)) return { ...step, messages: ["挿入点と同じ点です。別の点を指示するか、角度を入力してください"] };
        rotation = (((Math.atan2(input.point.y - position.y, input.point.x - position.x)) % TWO_PI) + TWO_PI) % TWO_PI;
      } else return step;
      return textInputStep("文字を入力してください(Enter で確定、Esc で取り消し)", false, undefined, (text) => ({
        type: "done",
        messages: [`文字を追加しました(高さ ${textStyle.height} mm、スタイル ${textStyle.name})`],
        requests: [{ type: "addEntities", entities: [makeText(context.allocateEntityId(), position, text, rotation, textStyle, drawing)], label: "文字を追加" }],
      }));
    },
  };
  return step;
}

function textPositionStep(drawing: DrawingStyle, textStyle: TextStyle, context: AppCommandContext): Step {
  const step: Step = {
    type: "prompt",
    prompt: `文字の挿入点を指示してください(高さ ${textStyle.height} mm、スタイル ${textStyle.name})`,
    expect: "point",
    acceptsEnter: true,
    onInput: (input) => {
      if (input.kind === "enter") return { type: "done", messages: [endedMessage("TEXT", "文字は描かれませんでした")] };
      if (input.kind !== "point") return step;
      return textRotationStep(input.point, drawing, textStyle, context);
    },
  };
  return step;
}

// ---- MTEXT ----

function mtextSecondCornerStep(first: Point2D, drawing: DrawingStyle, textStyle: TextStyle, context: AppCommandContext): Step {
  const step: Step = {
    type: "prompt",
    prompt: "枠の反対の角を指示してください(枠の幅で折り返します)",
    expect: "point",
    acceptsEnter: true,
    basePoint: first,
    preview: (cursor): readonly PreviewShape[] => (Math.abs(cursor.x - first.x) < 1e-6 && Math.abs(cursor.y - first.y) < 1e-6 ? [] : [{ kind: "polyline", points: rectangleCorners(first, cursor), closed: true }]),
    onInput: (input) => {
      if (input.kind === "enter") return { type: "done", messages: [endedMessage("MTEXT", "文字は描かれませんでした")] };
      if (input.kind !== "point") return step;
      const width = Math.abs(input.point.x - first.x);
      if (!(width >= 1e-6)) return { ...step, messages: ["枠の幅が 0 です。横にずらした点を指示してください"] };
      if (width > MAX_BOX_WIDTH) return { ...step, messages: ["枠の幅が大きすぎます"] };
      const left = Math.min(first.x, input.point.x);
      const top = Math.max(first.y, input.point.y);
      // 基準点は、水平の配置(左・中・右)に応じた、枠の端・中央(上端)
      const x = textStyle.horizontalAlign === "left" ? left : textStyle.horizontalAlign === "right" ? left + width : left + width / 2;
      const position = { x, y: top };
      return textInputStep("文字を入力してください(Ctrl+Enter で確定、Esc で取り消し)", true, undefined, (text) => ({
        type: "done",
        messages: [`複数行文字を追加しました(枠の幅 ${Math.round(width * 10) / 10} mm、高さ ${textStyle.height} mm、スタイル ${textStyle.name})`],
        requests: [{ type: "addEntities", entities: [makeText(context.allocateEntityId(), position, text, 0, textStyle, drawing, width)], label: "複数行文字を追加" }],
      }));
    },
  };
  return step;
}

function mtextFirstCornerStep(drawing: DrawingStyle, textStyle: TextStyle, context: AppCommandContext): Step {
  const step: Step = {
    type: "prompt",
    prompt: `枠の1つ目の角を指示してください(高さ ${textStyle.height} mm、スタイル ${textStyle.name})`,
    expect: "point",
    acceptsEnter: true,
    onInput: (input) => {
      if (input.kind === "enter") return { type: "done", messages: [endedMessage("MTEXT", "文字は描かれませんでした")] };
      if (input.kind !== "point") return step;
      return mtextSecondCornerStep(input.point, drawing, textStyle, context);
    },
  };
  return step;
}

// ---- TEXTEDIT ----

function textEditPickStep(context: AppCommandContext): Step {
  const step: Step = {
    type: "prompt",
    prompt: "内容を直す文字をクリックしてください[Enter=終了]",
    expect: "point",
    acceptsEnter: true,
    rawPoints: true,
    onInput: (input) => {
      if (input.kind === "enter") return { type: "done", messages: [endedMessage("TEXTEDIT", "文字は変更されませんでした")] };
      if (input.kind !== "point") return step;
      const picked = context.editing.pickEntity(input.point, EDIT_NAME, "text");
      if (!picked.ok) return { ...step, messages: [picked.message] };
      const current = context.editing.textOf(picked.id);
      if (current === null) return { ...step, messages: [`${EDIT_NAME}できません: 文字が見つかりません(削除された可能性があります)`] };
      const multiline = current.isMText || current.text.includes("\n");
      return textInputStep(
        multiline ? "文字を直してください(Ctrl+Enter で確定、Esc で取り消し)" : "文字を直してください(Enter で確定、Esc で取り消し)",
        multiline,
        current.text,
        (text) => ({ type: "done", requests: [{ type: "editText", id: picked.id, text }] }),
      );
    },
  };
  return step;
}

// ---- 共通 ----

/** 文字を描く前の確認(図面が開いている・編集できる・描ける)。描けるなら、描く見た目を返す */
function drawingFor(context: AppCommandContext): { ok: true; drawing: DrawingStyle } | { ok: false; done: { type: "done"; messages: readonly string[] } } {
  if (!context.isDocumentOpen) return { ok: false, done: { type: "done", messages: [NO_DOCUMENT_MESSAGE] } };
  if (!context.editing.ready) return { ok: false, done: { type: "done", messages: [NOT_READY_MESSAGE] } };
  const drawing = drawingStyleOf(context);
  if (!drawing.ok) return { ok: false, done: { type: "done", messages: [drawing.message] } };
  return { ok: true, drawing: drawing.style };
}

export const TEXT_COMMANDS: readonly AppCommandDefinition[] = [
  {
    name: "TEXT",
    aliases: ["DT"],
    description: "文字を描く(挿入点・回転角・文字を指定する)",
    start: (context) => {
      const ready = drawingFor(context);
      return ready.ok ? textPositionStep(ready.drawing, context.textStyle, context) : ready.done;
    },
  },
  {
    name: "MTEXT",
    aliases: ["MT"],
    description: "複数行の文字を描く(枠を指定して、枠の幅で折り返す)",
    start: (context) => {
      const ready = drawingFor(context);
      return ready.ok ? mtextFirstCornerStep(ready.drawing, context.textStyle, context) : ready.done;
    },
  },
  {
    name: "TEXTEDIT",
    aliases: ["ED"],
    description: "文字の内容を直す(位置・スタイルは変えない)",
    start: (context) => {
      if (!context.isDocumentOpen) return { type: "done", messages: [NO_DOCUMENT_MESSAGE] };
      if (!context.editing.ready) return { type: "done", messages: [NOT_READY_MESSAGE] };
      return textEditPickStep(context);
    },
  },
  {
    name: "TEXTSTYLE",
    aliases: ["ST"],
    description: "文字スタイル(フォント・高さ・幅係数・斜体・配置)の管理パネルを開く",
    start: () => ({ type: "done", requests: [{ type: "openTextStyles" }] }),
  },
];
