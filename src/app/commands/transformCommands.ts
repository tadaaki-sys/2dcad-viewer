// 図形の形を変える編集のコマンド(MIRROR・SCALE・STRETCH)。React にも画面にも依存しない。
// 図面は直接変更せず、依頼を返す。適用と履歴への記録は、画面の側が DocumentSession を通して行う(1コマンド = Undoの1段階)。
//
// MIRROR: 鏡像軸の2点 →「元の図形を削除しますか?」。いいえ(既定)なら、鏡像を複写。はいなら、元の図形を鏡像にする(ID は保つ)。
//         文字は反転させない(挿入点だけを動かし、向きは変えない)。
// SCALE : 基点 → 倍率(数値)。R で「参照の長さ → 新しい長さ」。
// STRETCH: 交差窓の2点 → 基点 → 移動先。窓の中の頂点・端点だけを動かす。
import { windowCorners, windowFromCorners } from "../../core/geometry/stretch";
import type { StretchWindow } from "../../core/geometry/stretch";
import { reflectionMatrix, scaleMatrix } from "../../core/geometry/transform";
import { normalizeCommandName } from "../../core/commands";
import type { Point2D } from "../../types/cad";
import { isSamePoint } from "../drawing/newEntities";
import { baseStep, countLabel, endedMessage, guideLine, NOT_READY_MESSAGE, startWithTargets } from "./editCommands";
import type { Preview, Step, Targets } from "./editCommands";
import { NO_DOCUMENT_MESSAGE } from "./types";
import type { AppCommandContext, AppCommandDefinition, AppRequest } from "./types";

/** 倍率の範囲。これより小さい(大きい)倍率は、図形がつぶれる・桁あふれするので、受け付けない */
export const MIN_SCALE_FACTOR = 1e-6;
export const MAX_SCALE_FACTOR = 1e6;

/** 倍率の表示(有効数字6桁まで。余分な 0 は付けない) */
function formatFactor(factor: number): string {
  return String(Number(factor.toPrecision(6)));
}

const distance = (a: Point2D, b: Point2D): number => Math.hypot(a.x - b.x, a.y - b.y);

// ---- MIRROR ----

/** 「元の図形を削除しますか?」。文字で答える(Enter = いいえ) */
function mirrorDeleteStep(targets: Targets, matrix: readonly [number, number, number, number, number, number]): Step {
  const step: Step = {
    type: "prompt",
    prompt: "元の図形を削除しますか? [はい(Y)/いいえ(N)] <N>",
    expect: "text",
    onInput: (input) => {
      const answer = normalizeCommandName(input.text);
      if (answer === "" || answer === "N" || answer === "NO" || answer === "いいえ") {
        return { type: "done", requests: [{ type: "copyEntities", ids: targets, matrices: [matrix], label: countLabel(targets.length, "鏡像コピー") }] };
      }
      if (answer === "Y" || answer === "YES" || answer === "はい") {
        return { type: "done", requests: [{ type: "transformEntities", ids: targets, matrix, label: countLabel(targets.length, "鏡像化"), noun: "鏡像化" }] };
      }
      return { ...step, messages: ["Y(はい)か N(いいえ)で答えてください(Enter = いいえ)"] };
    },
  };
  return step;
}

function mirrorSecondPointStep(targets: Targets, first: Point2D, preview: Preview): Step {
  const step: Step = {
    type: "prompt",
    prompt: "鏡像軸の2点目を指示してください",
    expect: "point",
    acceptsEnter: true,
    basePoint: first,
    preview: (cursor) => {
      const matrix = reflectionMatrix(first, cursor);
      return [...(matrix === null ? [] : preview([matrix])), guideLine(first, cursor)];
    },
    onInput: (input) => {
      if (input.kind === "enter") return { type: "done", messages: [endedMessage("MIRROR")] };
      if (input.kind !== "point") return step;
      const matrix = reflectionMatrix(first, input.point);
      if (matrix === null) return { ...step, messages: ["1点目と同じ点です(鏡像軸が決まりません)。別の点を指示してください"] };
      return mirrorDeleteStep(targets, matrix);
    },
  };
  return step;
}

function mirrorFirstPointStep(targets: Targets, preview: Preview, notice: readonly string[]): Step {
  return {
    type: "prompt",
    prompt: "鏡像軸の1点目を指示してください",
    expect: "point",
    acceptsEnter: true,
    messages: notice,
    onInput: (input) => (input.kind === "point" ? mirrorSecondPointStep(targets, input.point, preview) : { type: "done", messages: [endedMessage("MIRROR")] }),
  };
}

// ---- SCALE ----

/** 倍率が使えるか確かめて、使えれば依頼にする。使えなければ、理由つきで、同じ段階にとどまる */
function scaleOrStay(targets: Targets, base: Point2D, factor: number, stay: Step): Step | { type: "done"; requests: readonly AppRequest[] } {
  if (!Number.isFinite(factor) || factor <= 0) return { ...stay, messages: ["倍率は、0より大きい数値で入力してください"] };
  if (factor < MIN_SCALE_FACTOR || factor > MAX_SCALE_FACTOR) {
    return { ...stay, messages: [`倍率は、${MIN_SCALE_FACTOR} 以上 ${MAX_SCALE_FACTOR} 以下にしてください`] };
  }
  if (factor === 1) return { ...stay, messages: ["倍率が1です(大きさは変わりません)。別の倍率を入力してください"] };
  return {
    type: "done",
    requests: [
      {
        type: "transformEntities",
        ids: targets,
        matrix: scaleMatrix(base, factor),
        label: `${countLabel(targets.length, "拡大縮小")}(×${formatFactor(factor)})`,
        noun: "拡大縮小",
      },
    ],
  };
}

/** 参照の長さを決めたあと、新しい長さを指示する(基点からの距離)。倍率 = 新しい長さ ÷ 参照の長さ */
function newLengthStep(targets: Targets, base: Point2D, referenceLength: number, preview: Preview): Step {
  const step: Step = {
    type: "prompt",
    prompt: `新しい長さを指示するか、数値で入力してください(参照の長さ ${formatFactor(referenceLength)}。基点からの距離)`,
    expect: "point",
    acceptsEnter: true,
    acceptsDistance: true,
    numberMeaning: "length",
    basePoint: base,
    preview: (cursor) => {
      const factor = distance(base, cursor) / referenceLength;
      const usable = Number.isFinite(factor) && factor >= MIN_SCALE_FACTOR && factor <= MAX_SCALE_FACTOR && factor !== 1;
      return [...(usable ? preview([scaleMatrix(base, factor)]) : []), guideLine(base, cursor)];
    },
    onInput: (input) => {
      if (input.kind === "enter") return { type: "done", messages: [endedMessage("SCALE")] };
      if (input.kind === "distance") return scaleOrStay(targets, base, input.value / referenceLength, step);
      if (input.kind !== "point") return step;
      return scaleOrStay(targets, base, distance(base, input.point) / referenceLength, step);
    },
  };
  return step;
}

/** 参照の長さの2点目 */
function referenceSecondPointStep(targets: Targets, base: Point2D, first: Point2D, preview: Preview): Step {
  const step: Step = {
    type: "prompt",
    prompt: "参照の長さの2点目を指示してください",
    expect: "point",
    acceptsEnter: true,
    basePoint: first,
    preview: (cursor) => [guideLine(first, cursor)],
    onInput: (input) => {
      if (input.kind === "enter") return { type: "done", messages: [endedMessage("SCALE")] };
      if (input.kind !== "point") return step;
      const length = distance(first, input.point);
      if (!(length > 0)) return { ...step, messages: ["1点目と同じ点です(参照の長さが0です)。別の点を指示してください"] };
      return newLengthStep(targets, base, length, preview);
    },
  };
  return step;
}

/** 参照の長さ(数値、または2点) */
function referenceLengthStep(targets: Targets, base: Point2D, preview: Preview): Step {
  const step: Step = {
    type: "prompt",
    prompt: "参照の長さを入力するか、2点を指示してください",
    expect: "point",
    acceptsEnter: true,
    acceptsDistance: true,
    numberMeaning: "plain",
    onInput: (input) => {
      if (input.kind === "enter") return { type: "done", messages: [endedMessage("SCALE")] };
      if (input.kind === "distance") {
        if (!(input.value > 0) || !Number.isFinite(input.value)) return { ...step, messages: ["参照の長さは、0より大きい数値で入力してください"] };
        return newLengthStep(targets, base, input.value, preview);
      }
      if (input.kind !== "point") return step;
      return referenceSecondPointStep(targets, base, input.point, preview);
    },
  };
  return step;
}

function scaleFactorStep(targets: Targets, base: Point2D, preview: Preview): Step {
  const step: Step = {
    type: "prompt",
    prompt: "倍率を入力してください(例: 2、0.5)[R=参照]",
    expect: "point",
    keywords: ["R"],
    acceptsEnter: true,
    acceptsDistance: true,
    numberMeaning: "plain",
    onInput: (input) => {
      if (input.kind === "enter") return { type: "done", messages: [endedMessage("SCALE")] };
      if (input.kind === "keyword") return referenceLengthStep(targets, base, preview);
      if (input.kind === "distance") return scaleOrStay(targets, base, input.value, step);
      return { ...step, messages: ["倍率は、数値で入力してください(R で、参照の長さから決められます)"] };
    },
  };
  return step;
}

// ---- STRETCH ----

function stretchTargetStep(ids: Targets, window: StretchWindow, base: Point2D, context: AppCommandContext, notice: readonly string[]): Step {
  const preview = context.editing.createStretchPreview(ids, window);
  const step: Step = {
    type: "prompt",
    prompt: "移動先の点を指示してください",
    expect: "point",
    acceptsEnter: true,
    basePoint: base,
    messages: notice,
    preview: (cursor) => [...preview(cursor.x - base.x, cursor.y - base.y), guideLine(base, cursor)],
    onInput: (input) => {
      if (input.kind === "enter") return { type: "done", messages: [endedMessage("STRETCH")] };
      if (input.kind !== "point") return step;
      if (isSamePoint(base, input.point)) return { ...step, messages: ["基点と同じ点です(移動量が0です)。別の点を指示してください"] };
      return {
        type: "done",
        requests: [{ type: "stretchEntities", ids, window, dx: input.point.x - base.x, dy: input.point.y - base.y, label: "ストレッチ" }],
      };
    },
  };
  return step;
}

function stretchBaseStep(ids: Targets, window: StretchWindow, context: AppCommandContext, notice: readonly string[]): Step {
  return {
    type: "prompt",
    prompt: "基点を指示してください",
    expect: "point",
    acceptsEnter: true,
    messages: notice,
    // 窓の枠を、仮に表示しておく(どこを囲んだかが、分かるように)
    preview: () => [{ kind: "polyline", points: windowCorners(window), closed: true }],
    onInput: (input) => (input.kind === "point" ? stretchTargetStep(ids, window, input.point, context, []) : { type: "done", messages: [endedMessage("STRETCH")] }),
  };
}

function stretchSecondCornerStep(first: Point2D, context: AppCommandContext): Step {
  const step: Step = {
    type: "prompt",
    prompt: "窓の、対角の点を指示してください",
    expect: "point",
    acceptsEnter: true,
    preview: (cursor) => [{ kind: "polyline", points: windowCorners(windowFromCorners(first, cursor)), closed: true }],
    onInput: (input) => {
      if (input.kind === "enter") return { type: "done", messages: [endedMessage("STRETCH")] };
      if (input.kind !== "point") return step;
      if (isSamePoint(first, input.point)) return { ...step, messages: ["1点目と同じ点です(窓の大きさが0です)。別の点を指示してください"] };
      const window = windowFromCorners(first, input.point);
      const found = context.editing.findInWindow(window);
      if (found.editable.length === 0) {
        return { type: "done", messages: [`STRETCH: 窓にかかる、編集できる図形がありません${found.skipped > 0 ? `(${found.reason ?? ""})` : ""}`] };
      }
      const notice = [
        `窓にかかる図形: ${found.editable.length}個${found.skipped > 0 ? `(編集できない図形 ${found.skipped} 個は除きました: ${found.reason ?? ""})` : ""}`,
      ];
      return stretchBaseStep(found.editable, window, context, notice);
    },
  };
  return step;
}

export const TRANSFORM_COMMANDS: readonly AppCommandDefinition[] = [
  {
    name: "MIRROR",
    aliases: ["MI"],
    description: "図形を鏡像にする(鏡像の複写、または、元の図形を鏡像に)",
    start: (context) =>
      startWithTargets("MIRROR", context, (targets, notice) => {
        const preview = context.editing.createPreview(targets);
        return mirrorFirstPointStep(targets, preview, notice);
      }),
  },
  {
    name: "SCALE",
    aliases: ["SC"],
    description: "図形を拡大・縮小する(倍率、または参照の長さ)",
    start: (context) =>
      startWithTargets("SCALE", context, (targets, notice) =>
        baseStep("SCALE", targets, notice, (base, preview) => scaleFactorStep(targets, base, preview), context),
      ),
  },
  {
    name: "STRETCH",
    aliases: ["S"],
    description: "交差窓で囲んだ頂点を動かして、図形の形を変える",
    start: (context) => {
      if (!context.isDocumentOpen) return { type: "done", messages: [NO_DOCUMENT_MESSAGE] };
      if (!context.editing.ready) return { type: "done", messages: [NOT_READY_MESSAGE] };
      const step: Step = {
        type: "prompt",
        prompt: "動かす部分を、交差窓で囲みます。窓の1点目を指示してください",
        expect: "point",
        acceptsEnter: true,
        onInput: (input) => (input.kind === "point" ? stretchSecondCornerStep(input.point, context) : { type: "done", messages: [endedMessage("STRETCH")] }),
      };
      return step;
    },
  },
];
