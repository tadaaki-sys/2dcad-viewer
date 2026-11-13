// 作図のコマンド(CIRCLE・ARC)。React にも画面にも依存しない。
// 図面は直接変更せず、「図形を追加する」依頼(addEntities)を返す(LINE・PLINE・RECT と同じ)。
// 1回の作図は、1つの変更(Undoの1段階)になる。
//
//   CIRCLE  中心 → 半径(点の指示、または数値)。D=直径(数値)
//   ARC     始点 → 通過点 → 終点(3点)。C=中心を先に指定して、中心 → 始点 → 終点(反時計回り)
import type { CommandOutput, PreviewShape, PromptStep } from "../../core/commands";
import { arcFromCenterStartEnd, arcThroughThreePoints, isUsableRadius, MAX_RADIUS, MIN_RADIUS } from "../../core/geometry/construct";
import type { ArcShape } from "../../core/geometry/construct";
import type { Point2D } from "../../types/cad";
import { isSamePoint, makeArc, makeCircle } from "../drawing/newEntities";
import type { DrawingStyle } from "../drawing/newEntities";
import { drawingStyleOf } from "./drawCommands";
import { formatCoordinate } from "./format";
import type { AppCommandContext, AppCommandDefinition, AppRequest } from "./types";

type Step = PromptStep<AppRequest>;
type Output = CommandOutput<AppRequest>;

const CIRCLE_ENDED_MESSAGE = "CIRCLE を終了しました(図形は描かれませんでした)";
const ARC_ENDED_MESSAGE = "ARC を終了しました(図形は描かれませんでした)";

function radiusRangeMessage(): string {
  return `半径が小さすぎるか大きすぎます(使える範囲: ${String(MIN_RADIUS)} 〜 ${String(MAX_RADIUS)})`;
}

function distanceBetween(a: Point2D, b: Point2D): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function circleAdded(context: AppCommandContext, style: DrawingStyle, center: Point2D, radius: number): Output {
  const entity = makeCircle(context.allocateEntityId(), center, radius, style);
  return {
    messages: [`円を追加しました(半径 ${formatCoordinate(radius)})`],
    requests: [{ type: "addEntities", entities: [entity], label: "円を追加" }],
  };
}

function arcAdded(context: AppCommandContext, style: DrawingStyle, arc: ArcShape): Output {
  const entity = makeArc(context.allocateEntityId(), arc, style);
  return {
    messages: [`円弧を追加しました(半径 ${formatCoordinate(arc.radius)})`],
    requests: [{ type: "addEntities", entities: [entity], label: "円弧を追加" }],
  };
}

/** CIRCLE の直径を数値で入力する段階 */
function diameterStep(context: AppCommandContext, style: DrawingStyle, center: Point2D): Step {
  const step: Step = {
    type: "prompt",
    prompt: "直径を数値で入力してください(例: 200)",
    expect: "distance",
    acceptsEnter: true,
    basePoint: center,
    onInput: (input) => {
      if (input.kind === "enter") return { type: "done", messages: [CIRCLE_ENDED_MESSAGE] };
      if (input.kind !== "distance") return step;
      const radius = input.value / 2;
      if (!isUsableRadius(radius)) return { ...step, messages: [radiusRangeMessage()] };
      return { type: "done", ...circleAdded(context, style, center, radius) };
    },
  };
  return step;
}

/** CIRCLE の半径の段階。図面のクリックでも、数値でも答えられる */
function radiusStep(context: AppCommandContext, style: DrawingStyle, center: Point2D): Step {
  const step: Step = {
    type: "prompt",
    prompt: "半径を指示するか、数値で入力してください[D=直径]",
    expect: "point",
    keywords: ["D"],
    acceptsEnter: true,
    acceptsDistance: true,
    basePoint: center,
    preview: (cursor): readonly PreviewShape[] => {
      const radius = distanceBetween(center, cursor);
      return isUsableRadius(radius) ? [{ kind: "circle", center, radius }] : [];
    },
    onInput: (input) => {
      if (input.kind === "enter") return { type: "done", messages: [CIRCLE_ENDED_MESSAGE] };
      if (input.kind === "keyword") return diameterStep(context, style, center);
      const radius = input.kind === "distance" ? input.value : distanceBetween(center, input.point);
      if (!isUsableRadius(radius)) return { ...step, messages: [radiusRangeMessage()] };
      return { type: "done", ...circleAdded(context, style, center, radius) };
    },
  };
  return step;
}

function circleStart(context: AppCommandContext, style: DrawingStyle): Step {
  return {
    type: "prompt",
    prompt: "円の中心を指示してください",
    expect: "point",
    acceptsEnter: true,
    onInput: (input) => (input.kind === "point" ? radiusStep(context, style, input.point) : { type: "done", messages: [CIRCLE_ENDED_MESSAGE] }),
  };
}

const THREE_POINT_FAILURE =
  "この3点では円弧になりません(一直線上にある、同じ点がある、または半径が大きすぎます)。別の点を指示してください";

/** ARC(3点)の終点の段階 */
function threePointEndStep(context: AppCommandContext, style: DrawingStyle, start: Point2D, through: Point2D): Step {
  const step: Step = {
    type: "prompt",
    prompt: "円弧の終点を指示してください",
    expect: "point",
    acceptsEnter: true,
    preview: (cursor): readonly PreviewShape[] => {
      const arc = arcThroughThreePoints(start, through, cursor);
      return arc !== null
        ? [{ kind: "arc", ...arc }]
        : [{ kind: "polyline", points: [start, through, cursor], closed: false }];
    },
    onInput: (input) => {
      if (input.kind === "enter") return { type: "done", messages: [ARC_ENDED_MESSAGE] };
      if (input.kind !== "point") return step;
      const arc = arcThroughThreePoints(start, through, input.point);
      if (arc === null) return { ...step, messages: [THREE_POINT_FAILURE] };
      return { type: "done", ...arcAdded(context, style, arc) };
    },
  };
  return step;
}

/** ARC(3点)の通過点の段階 */
function throughStep(context: AppCommandContext, style: DrawingStyle, start: Point2D): Step {
  const step: Step = {
    type: "prompt",
    prompt: "円弧の通過点を指示してください",
    expect: "point",
    acceptsEnter: true,
    preview: (cursor): readonly PreviewShape[] =>
      isSamePoint(start, cursor) ? [] : [{ kind: "polyline", points: [start, cursor], closed: false }],
    onInput: (input) => {
      if (input.kind === "enter") return { type: "done", messages: [ARC_ENDED_MESSAGE] };
      if (input.kind !== "point") return step;
      if (isSamePoint(start, input.point)) return { ...step, messages: ["始点と同じ点です。別の点を指示してください"] };
      return threePointEndStep(context, style, start, input.point);
    },
  };
  return step;
}

/** ARC(中心・始点・終点)の終点の段階 */
function centerEndStep(context: AppCommandContext, style: DrawingStyle, center: Point2D, start: Point2D): Step {
  const step: Step = {
    type: "prompt",
    prompt: "円弧の終点を指示してください(中心からの方向だけが使われます。反時計回りに描きます)",
    expect: "point",
    acceptsEnter: true,
    preview: (cursor): readonly PreviewShape[] => {
      const result = arcFromCenterStartEnd(center, start, cursor);
      return result.ok ? [{ kind: "arc", ...result.arc }] : [{ kind: "polyline", points: [center, cursor], closed: false }];
    },
    onInput: (input) => {
      if (input.kind === "enter") return { type: "done", messages: [ARC_ENDED_MESSAGE] };
      if (input.kind !== "point") return step;
      const result = arcFromCenterStartEnd(center, start, input.point);
      if (!result.ok) {
        const messages: Record<typeof result.reason, string> = {
          "non-finite": "座標の値が正しくありません。別の点を指示してください",
          radius: radiusRangeMessage(),
          "end-at-center": "中心と同じ点です。別の点を指示してください",
          "same-direction": "始点と同じ方向です(角度の範囲が0になります)。別の点を指示してください",
        };
        return { ...step, messages: [messages[result.reason]] };
      }
      return { type: "done", ...arcAdded(context, style, result.arc) };
    },
  };
  return step;
}

/** ARC(中心・始点・終点)の始点の段階。中心からの距離が半径になる */
function centerStartStep(context: AppCommandContext, style: DrawingStyle, center: Point2D): Step {
  const step: Step = {
    type: "prompt",
    prompt: "円弧の始点を指示してください(中心からの距離が半径になります)",
    expect: "point",
    acceptsEnter: true,
    basePoint: center,
    preview: (cursor): readonly PreviewShape[] =>
      isSamePoint(center, cursor) ? [] : [{ kind: "polyline", points: [center, cursor], closed: false }],
    onInput: (input) => {
      if (input.kind === "enter") return { type: "done", messages: [ARC_ENDED_MESSAGE] };
      if (input.kind !== "point") return step;
      if (!isUsableRadius(distanceBetween(center, input.point))) return { ...step, messages: [radiusRangeMessage()] };
      return centerEndStep(context, style, center, input.point);
    },
  };
  return step;
}

function arcStart(context: AppCommandContext, style: DrawingStyle): Step {
  return {
    type: "prompt",
    prompt: "円弧の始点を指示してください[C=中心を先に指定]",
    expect: "point",
    keywords: ["C"],
    acceptsEnter: true,
    onInput: (input) => {
      if (input.kind === "point") return throughStep(context, style, input.point);
      if (input.kind === "keyword") {
        return {
          type: "prompt",
          prompt: "円弧の中心を指示してください",
          expect: "point",
          acceptsEnter: true,
          onInput: (centerInput) =>
            centerInput.kind === "point"
              ? centerStartStep(context, style, centerInput.point)
              : { type: "done", messages: [ARC_ENDED_MESSAGE] },
        };
      }
      return { type: "done", messages: [ARC_ENDED_MESSAGE] };
    },
  };
}

export const CIRCLE_ARC_COMMANDS: readonly AppCommandDefinition[] = [
  {
    name: "CIRCLE",
    aliases: ["C"],
    description: "円を描く",
    start: (context) => {
      const target = drawingStyleOf(context);
      if (!target.ok) return { type: "done", messages: [target.message] };
      return circleStart(context, target.style);
    },
  },
  {
    name: "ARC",
    aliases: ["A"],
    description: "円弧を描く",
    start: (context) => {
      const target = drawingStyleOf(context);
      if (!target.ok) return { type: "done", messages: [target.message] };
      return arcStart(context, target.style);
    },
  },
];
