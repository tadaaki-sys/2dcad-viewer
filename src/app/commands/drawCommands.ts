// 作図のコマンド(LINE・PLINE・RECT)。React にも画面にも依存しない。
// 図面は直接変更せず、「図形を追加する」依頼(addEntities)を返す。適用と履歴への記録は、画面の側が DocumentSession を通して行う。
// 描いた分は、終了(Enter・Esc)したときに、まとめて1つの変更(Undoの1段階)になる。
import type { CommandOutput, PreviewShape, PromptStep } from "../../core/commands";
import type { Point2D } from "../../types/cad";
import { isDegenerateRectangle, isSamePoint, makeLine, makePolyline, makeRectangle, rectangleCorners } from "../drawing/newEntities";
import type { DrawingStyle } from "../drawing/newEntities";
import { formatCoordinate } from "./format";
import { NO_DOCUMENT_MESSAGE } from "./types";
import type { AppCommandContext, AppCommandDefinition, AppRequest } from "./types";

type Step = PromptStep<AppRequest>;
type Output = CommandOutput<AppRequest>;

/** 描けるか確かめて、描く見た目を返す。描けないときは、理由のメッセージを返す */
export function drawingStyleOf(context: AppCommandContext): { ok: true; style: DrawingStyle } | { ok: false; message: string } {
  if (!context.isDocumentOpen) return { ok: false, message: NO_DOCUMENT_MESSAGE };
  if (!context.drawTarget.ok) return { ok: false, message: context.drawTarget.reason };
  return { ok: true, style: { layer: context.drawTarget.layer, color: context.drawTarget.color } };
}

const RECT_ENDED_MESSAGE = "RECT を終了しました(図形は描かれませんでした)";

function samePointMessage(): string {
  return "直前の点と同じ点です。別の点を指示してください";
}

/** 点を順に指示する案内。1点目の後は U(1点戻す)、3点目の後は C(閉じる)が使える */
function pointPrompt(count: number): string {
  if (count === 0) return "始点を指示してください";
  const hints = ["U=1点戻す", ...(count >= 3 ? ["C=閉じる"] : []), "Enter=終了"];
  return `次の点を指示してください[${hints.join("/")}]`;
}

function keywordsFor(count: number): string[] {
  return count === 0 ? [] : count >= 3 ? ["U", "C"] : ["U"];
}

/** 点を順に指示する段階(LINE・PLINE 共通)。finish は、指示した点から、確定する内容を作る */
function chainStep(points: readonly Point2D[], finish: (points: readonly Point2D[], closed: boolean) => Output): Step {
  const count = points.length;
  const step: Step = {
    type: "prompt",
    prompt: pointPrompt(count),
    expect: "point",
    keywords: keywordsFor(count),
    acceptsEnter: true,
    basePoint: count > 0 ? points[count - 1] : undefined,
    // 2点以上あれば、終了すると図形になる(ページを閉じる前の確認の対象)
    pending: count >= 2,
    preview: (cursor): readonly PreviewShape[] =>
      count > 0 ? [{ kind: "polyline", points: [...points, cursor], closed: false }] : [],
    onCancel: () => finish(points, false),
    onInput: (input) => {
      if (input.kind === "point") {
        if (count > 0 && isSamePoint(points[count - 1], input.point)) {
          return { ...step, messages: [samePointMessage()] };
        }
        return chainStep([...points, input.point], finish);
      }
      if (input.kind === "keyword") {
        if (input.keyword === "U") return chainStep(points.slice(0, -1), finish);
        if (input.keyword === "C") return { type: "done", ...finish(points, true) };
      }
      return { type: "done", ...finish(points, false) };
    },
  };
  return step;
}

/** LINE: 指示した点を結ぶ線を、1本ずつの図形として作る */
function finishLines(context: AppCommandContext, style: DrawingStyle, points: readonly Point2D[], closed: boolean): Output {
  const segments: Array<[Point2D, Point2D]> = [];
  for (let i = 1; i < points.length; i++) segments.push([points[i - 1], points[i]]);
  if (closed && points.length >= 3 && !isSamePoint(points[points.length - 1], points[0])) {
    segments.push([points[points.length - 1], points[0]]);
  }
  if (segments.length === 0) return { messages: ["線は描かれませんでした"] };
  const entities = segments.map(([a, b]) => makeLine(context.allocateEntityId(), a, b, style));
  const label = entities.length === 1 ? "線を追加" : `線を追加(${entities.length}本)`;
  return { messages: [`${entities.length}本の線を追加しました`], requests: [{ type: "addEntities", entities, label }] };
}

/** PLINE: 指示した点を結ぶ、1本のポリラインを作る */
function finishPolyline(context: AppCommandContext, style: DrawingStyle, points: readonly Point2D[], closed: boolean): Output {
  if (points.length < 2) return { messages: ["ポリラインは描かれませんでした"] };
  const isClosed = closed && points.length >= 3;
  const entity = makePolyline(context.allocateEntityId(), points, isClosed, style);
  return {
    messages: [`ポリラインを追加しました(${points.length}点${isClosed ? "、閉じる" : ""})`],
    requests: [{ type: "addEntities", entities: [entity], label: "ポリラインを追加" }],
  };
}

/** RECT: 2つの角から、閉じたポリライン(4頂点)を作る */
function rectangleSecondStep(context: AppCommandContext, style: DrawingStyle, first: Point2D): Step {
  const step: Step = {
    type: "prompt",
    prompt: "対角の点を指示してください(例: @500,300)",
    expect: "point",
    acceptsEnter: true,
    basePoint: first,
    preview: (cursor): readonly PreviewShape[] =>
      isDegenerateRectangle(first, cursor) ? [] : [{ kind: "polyline", points: rectangleCorners(first, cursor), closed: true }],
    onInput: (input) => {
      // 空のEnterは、図形を作らずに終了する(Escと同じ)
      if (input.kind === "enter") return { type: "done", messages: [RECT_ENDED_MESSAGE] };
      if (input.kind !== "point") return step;
      if (isDegenerateRectangle(first, input.point)) {
        return { ...step, messages: ["幅または高さが0の長方形は作れません。別の点を指示してください"] };
      }
      const entity = makeRectangle(context.allocateEntityId(), first, input.point, style);
      const width = formatCoordinate(Math.abs(input.point.x - first.x));
      const height = formatCoordinate(Math.abs(input.point.y - first.y));
      return {
        type: "done",
        messages: [`長方形を追加しました(${width} × ${height})`],
        requests: [{ type: "addEntities", entities: [entity], label: "長方形を追加" }],
      };
    },
  };
  return step;
}

export const DRAW_COMMANDS: readonly AppCommandDefinition[] = [
  {
    name: "LINE",
    aliases: ["L"],
    description: "線を描く",
    start: (context) => {
      const target = drawingStyleOf(context);
      if (!target.ok) return { type: "done", messages: [target.message] };
      return chainStep([], (points, closed) => finishLines(context, target.style, points, closed));
    },
  },
  {
    name: "PLINE",
    aliases: ["PL"],
    description: "ポリラインを描く",
    start: (context) => {
      const target = drawingStyleOf(context);
      if (!target.ok) return { type: "done", messages: [target.message] };
      return chainStep([], (points, closed) => finishPolyline(context, target.style, points, closed));
    },
  },
  {
    name: "RECT",
    aliases: ["REC", "RECTANG"],
    description: "長方形を描く",
    start: (context) => {
      const target = drawingStyleOf(context);
      if (!target.ok) return { type: "done", messages: [target.message] };
      return {
        type: "prompt",
        prompt: "1つ目の角を指示してください",
        expect: "point",
        acceptsEnter: true,
        onInput: (input) =>
          input.kind === "point"
            ? rectangleSecondStep(context, target.style, input.point)
            : { type: "done", messages: [RECT_ENDED_MESSAGE] },
      };
    },
  },
];
