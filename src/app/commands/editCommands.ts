// 編集のコマンド(MOVE・COPY・ROTATE・DELETE)。React にも画面にも依存しない。
// 図面は直接変更せず、「図形を動かす・複写する・削除する」依頼を返す。適用と履歴への記録は、画面の側が DocumentSession を通して行う。
// 1回のコマンドは、Undo の1段階になる(複数の図形も、COPY の繰り返しも、まとめて1段階)。
//
// 対象の図形: 先に選択してあれば、その選択を使う。無ければ、選択を待つ(ふだんの選択操作で選んで、Enter で確定)。
// ブロックの中身・寸法など、編集できない図形は、理由を表示して除く。編集できる図形が無ければ、何もしない。
import type { CommandOutput, PreviewShape, PromptStep } from "../../core/commands";
import { rotationMatrix, translationMatrix } from "../../core/geometry/transform";
import type { Affine2D, Point2D } from "../../types/cad";
import { isSamePoint } from "../drawing/newEntities";
import { formatCoordinate } from "./format";
import { NO_DOCUMENT_MESSAGE } from "./types";
import type { AppCommandContext, AppCommandDefinition, AppRequest } from "./types";

type Step = PromptStep<AppRequest>;
type Output = CommandOutput<AppRequest>;
type Targets = readonly string[];
type Preview = (matrices: readonly Affine2D[]) => readonly PreviewShape[];

const NOT_READY_MESSAGE = "図面の準備中、または読み込み中です。少し待ってからお試しください";
const SELECT_PROMPT = "対象の図形を選択して、Enter を押してください";

function endedMessage(name: string, detail = "図形は変更されませんでした"): string {
  return `${name} を終了しました(${detail})`;
}

function countLabel(count: number, action: string): string {
  return count === 1 ? `図形を${action}` : `${count}個の図形を${action}`;
}

/** 基点から、カーソルへの案内線(仮表示) */
function guideLine(from: Point2D, to: Point2D): PreviewShape {
  return { kind: "polyline", points: [from, to], closed: false };
}

/**
 * コマンドの最初の段階。選択済みなら、それを対象にして next へ。選択が無ければ、選択を待つ。
 * next は、編集できる図形(ID)を受け取って、最初の入力を待つ段階を返す。
 */
function startWithTargets(name: string, context: AppCommandContext, next: (targets: Targets, notice: readonly string[]) => Step | { type: "done"; requests: readonly AppRequest[]; messages?: readonly string[] }) {
  const { editing } = context;
  if (!context.isDocumentOpen) return { type: "done" as const, messages: [NO_DOCUMENT_MESSAGE] };
  if (!editing.ready) return { type: "done" as const, messages: [NOT_READY_MESSAGE] };

  const accept = (ids: readonly string[]): Step | { type: "done"; requests?: readonly AppRequest[]; messages?: readonly string[] } => {
    const resolved = editing.resolveTargets(ids);
    if (resolved.editable.length === 0) {
      return { type: "done", messages: [`${name}: 編集できる図形が選択されていません(${resolved.reason ?? "対象がありません"})`] };
    }
    const notice = resolved.skipped > 0 ? [`編集できない図形 ${resolved.skipped} 個は除きました(${resolved.reason ?? ""})`] : [];
    return next(resolved.editable, notice);
  };

  const selection = editing.getSelection();
  if (selection.length > 0) return accept(selection);

  const selectionStep: Step = {
    type: "prompt",
    prompt: SELECT_PROMPT,
    expect: "selection",
    onInput: (input) => {
      if (input.ids.length === 0) {
        return { ...selectionStep, messages: ["図形が選択されていません。選択してから Enter を押してください(Esc で取り消し)"] };
      }
      return accept(input.ids);
    },
  };
  return selectionStep;
}

// ---- MOVE ----

function moveSecondStep(targets: Targets, base: Point2D, preview: Preview, notice: readonly string[]): Step {
  const step: Step = {
    type: "prompt",
    prompt: "移動先の点を指示してください",
    expect: "point",
    acceptsEnter: true,
    basePoint: base,
    messages: notice,
    preview: (cursor) => [...preview([translationMatrix(cursor.x - base.x, cursor.y - base.y)]), guideLine(base, cursor)],
    onInput: (input) => {
      if (input.kind === "enter") return { type: "done", messages: [endedMessage("MOVE")] };
      if (input.kind !== "point") return step;
      if (isSamePoint(base, input.point)) {
        return { ...step, messages: ["基点と同じ点です(移動量が0です)。別の点を指示してください"] };
      }
      const request: AppRequest = {
        type: "transformEntities",
        ids: targets,
        matrix: translationMatrix(input.point.x - base.x, input.point.y - base.y),
        label: countLabel(targets.length, "移動"),
        noun: "移動",
      };
      return { type: "done", requests: [request] };
    },
  };
  return step;
}

// ---- COPY ----

function copyLabel(count: number, times: number): string {
  if (times === 1) return countLabel(count, "コピー");
  return count === 1 ? `図形をコピー(${times}回)` : `${count}個の図形をコピー(${times}回)`;
}

function copyFinish(targets: Targets, offsets: readonly Affine2D[]): Output {
  if (offsets.length === 0) return { messages: [endedMessage("COPY", "コピーは作られませんでした")] };
  return { requests: [{ type: "copyEntities", ids: targets, matrices: offsets, label: copyLabel(targets.length, offsets.length) }] };
}

/** コピー先を、繰り返して指示する段階。Enter・Esc で終了して、まとめて確定する(Undo は1段階) */
function copyStep(targets: Targets, base: Point2D, preview: Preview, offsets: readonly Affine2D[], notice: readonly string[]): Step {
  const count = offsets.length;
  // すでに指示したコピー先の形は、この段階の間は変わらないので、1回だけ作る(カーソルを動かすたびに作り直さない)
  let placedShapes: readonly PreviewShape[] | null = null;
  const step: Step = {
    type: "prompt",
    prompt: count === 0 ? "コピー先の点を指示してください" : "次のコピー先の点を指示してください[U=1つ戻す/Enter=終了]",
    expect: "point",
    keywords: count === 0 ? [] : ["U"],
    acceptsEnter: true,
    basePoint: base,
    // 確定前のコピーがあるとき、ページを閉じる前の確認の対象にする
    pending: count > 0,
    messages: notice,
    // すでに指示したコピー先(まだ確定していない)の形も、一緒に表示する
    preview: (cursor) => {
      placedShapes ??= count === 0 ? [] : preview(offsets);
      return [...placedShapes, ...preview([translationMatrix(cursor.x - base.x, cursor.y - base.y)]), guideLine(base, cursor)];
    },
    onCancel: () => copyFinish(targets, offsets),
    onInput: (input) => {
      if (input.kind === "point") {
        if (isSamePoint(base, input.point)) {
          return { ...step, messages: ["基点と同じ点です(移動量が0です)。別の点を指示してください"] };
        }
        return copyStep(targets, base, preview, [...offsets, translationMatrix(input.point.x - base.x, input.point.y - base.y)], []);
      }
      if (input.kind === "keyword" && input.keyword === "U") return copyStep(targets, base, preview, offsets.slice(0, -1), []);
      return { type: "done", ...copyFinish(targets, offsets) };
    },
  };
  return step;
}

// ---- ROTATE ----

function rotateAngleStep(targets: Targets, base: Point2D, preview: Preview, notice: readonly string[]): Step {
  const finish = (degrees: number): Step | { type: "done"; requests: readonly AppRequest[] } => {
    if (!Number.isFinite(degrees)) return step;
    // 360 で割った余りにしてから使う(巨大な角度でも、精度を保つ。360度の倍数は、回転なし)。微小な角度は、0 とみなさない
    const reduced = degrees % 360;
    if (reduced === 0) return step;
    const normalized = (reduced + 360) % 360;
    const angle = (reduced * Math.PI) / 180;
    return {
      type: "done",
      requests: [
        {
          type: "transformEntities",
          ids: targets,
          matrix: rotationMatrix(base, angle),
          label: `${countLabel(targets.length, "回転")}(${formatCoordinate(normalized === 0 ? reduced : normalized)}度)`,
          noun: "回転",
        },
      ],
    };
  };
  const step: Step = {
    type: "prompt",
    prompt: "回転角を指示するか、数値(度)で入力してください(反時計回りが正)",
    expect: "point",
    acceptsEnter: true,
    // 数値だけの入力は、角度(度)として受け取る
    acceptsDistance: true,
    numberMeaning: "angle",
    basePoint: base,
    messages: notice,
    preview: (cursor) => {
      if (isSamePoint(base, cursor)) return [];
      const angle = Math.atan2(cursor.y - base.y, cursor.x - base.x);
      return [...preview([rotationMatrix(base, angle)]), guideLine(base, cursor)];
    },
    onInput: (input) => {
      if (input.kind === "enter") return { type: "done", messages: [endedMessage("ROTATE")] };
      if (input.kind === "distance") {
        const result = finish(input.value);
        return result === step ? { ...step, messages: ["回転角が0度です。別の角度を入力してください"] } : result;
      }
      if (input.kind !== "point") return step;
      if (isSamePoint(base, input.point)) {
        return { ...step, messages: ["基点と同じ点です(角度が決まりません)。別の点を指示してください"] };
      }
      const degrees = (Math.atan2(input.point.y - base.y, input.point.x - base.x) * 180) / Math.PI;
      const result = finish(degrees);
      return result === step ? { ...step, messages: ["回転角が0度です。別の点を指示してください"] } : result;
    },
  };
  return step;
}

/** 基点を指示する段階(MOVE・COPY・ROTATE 共通) */
function baseStep(name: string, targets: Targets, notice: readonly string[], next: (base: Point2D, preview: Preview) => Step, context: AppCommandContext): Step {
  const preview = context.editing.createPreview(targets);
  return {
    type: "prompt",
    prompt: "基点を指示してください",
    expect: "point",
    acceptsEnter: true,
    messages: notice,
    onInput: (input) => (input.kind === "point" ? next(input.point, preview) : { type: "done", messages: [endedMessage(name)] }),
  };
}

export const EDIT_COMMANDS: readonly AppCommandDefinition[] = [
  {
    name: "MOVE",
    aliases: ["MO"],
    description: "図形を移動する",
    start: (context) =>
      startWithTargets("MOVE", context, (targets, notice) =>
        baseStep("MOVE", targets, notice, (base, preview) => moveSecondStep(targets, base, preview, []), context),
      ),
  },
  {
    name: "COPY",
    aliases: ["CO", "CP"],
    description: "図形を複写する(繰り返せる)",
    start: (context) =>
      startWithTargets("COPY", context, (targets, notice) =>
        baseStep("COPY", targets, notice, (base, preview) => copyStep(targets, base, preview, [], []), context),
      ),
  },
  {
    name: "ROTATE",
    aliases: ["RO"],
    description: "図形を回転する",
    start: (context) =>
      startWithTargets("ROTATE", context, (targets, notice) =>
        baseStep("ROTATE", targets, notice, (base, preview) => rotateAngleStep(targets, base, preview, []), context),
      ),
  },
  {
    name: "DELETE",
    aliases: ["E", "DEL"],
    description: "図形を削除する",
    start: (context) =>
      startWithTargets("DELETE", context, (targets, notice) => ({
        type: "done",
        messages: notice,
        requests: [{ type: "deleteEntities", ids: targets, label: countLabel(targets.length, "削除") }],
      })),
  },
];
