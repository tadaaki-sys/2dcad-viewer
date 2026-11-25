// 寸法のコマンド(DIMHORIZONTAL・DIMVERTICAL・DIMALIGNED・DIMRADIUS・DIMDIAMETER・DIMANGULAR・DIMSTYLE)。
// React にも画面にも依存しない。図面は直接変更せず、依頼を返す。適用と履歴への記録は、画面の側が DocumentSession を通して行う
// (1回の寸法 = Undoの1段階)。寸法は、1つ描くと終了する。
//
// DIMHORIZONTAL / DIMVERTICAL / DIMALIGNED: 1つ目の点 → 2つ目の点 → 寸法線の位置
// DIMRADIUS / DIMDIAMETER               : 円・円弧をクリック → 文字の側の点
// DIMANGULAR                            : 1本目の線をクリック → 2本目の線をクリック → 弧が通る点(Enter で、頂点・点1・点2 の3点指定)
// DIMSTYLE                              : 寸法スタイルの管理パネルを開く
// 寸法の見た目(文字の高さ・矢印・小数桁・単位・補助線の間隔・色・レイヤー・線種)は、コマンドを始めた時点の現在のスタイルの値を使う。
// 図形を指すクリックは、吸着しない(rawPoints): 吸着すると、ほかの図形の端点などへ吸い寄せられて、指したい図形が決まらないため。
import type { CommandStep, PreviewShape } from "../../core/commands";
import { entityPreviewShapes } from "../../core/commands/entityPreview";
import { angularFromLines, intersectionOfLines, pointOnCircleToward } from "../../core/dimension/dimensionConstruct";
import { layoutDimension } from "../../core/dimension/dimensionGeometry";
import type { DimensionStyle } from "../../core/dimension/dimensionStyle";
import { IDENTITY_MATRIX } from "../../core/geometry/transform";
import type { CadDimension, CadEntity, Point2D } from "../../types/cad";
import { isSamePoint, makeDimension } from "../drawing/newEntities";
import type { DimensionGeometry, DrawingStyle } from "../drawing/newEntities";
import { endedMessage, NOT_READY_MESSAGE } from "./editCommands";
import type { Step } from "./editCommands";
import { NO_DOCUMENT_MESSAGE } from "./types";
import type { AppCommandContext, AppCommandDefinition, AppRequest } from "./types";

const NAME = "寸法";
const NO_DIMENSION_DETAIL = "寸法は描かれませんでした";
const HALF_PI = Math.PI / 2;

/** 寸法を描く前の確認(図面が開いている・編集できる・描ける)の結果。描けるなら、描く見た目と、寸法スタイルを返す */
type Ready = { ok: true; drawing: DrawingStyle; style: DimensionStyle } | { ok: false; done: { type: "done"; messages: readonly string[] } };

function readyFor(context: AppCommandContext): Ready {
  const done = (message: string): Ready => ({ ok: false, done: { type: "done", messages: [message] } });
  if (!context.isDocumentOpen) return done(NO_DOCUMENT_MESSAGE);
  if (!context.editing.ready) return done(NOT_READY_MESSAGE);
  const style = context.dimensionStyle;
  // スタイルがレイヤーを指定していれば、そのレイヤー。指定が無ければ、現在のレイヤー
  const target = style.layer === null ? context.drawTarget : context.layerTarget(style.layer);
  if (!target.ok) return done(style.layer === null ? target.reason : `寸法スタイル「${style.name}」のレイヤー: ${target.reason}`);
  return { ok: true, drawing: { layer: target.layer, color: target.color }, style };
}

/** 寸法の定義点から、寸法を作る(図形のIDは、確定のときに払い出す) */
type Build = (position: Point2D) => DimensionGeometry;

/**
 * 寸法線の位置(または文字の側・弧が通る点)を指示する段階。
 * カーソルを動かすたびに、その位置の寸法を、仮表示する。確定のとき、形が計算できなければ、理由を知らせて、やり直せる。
 */
function positionStep(prompt: string, basePoint: Point2D | undefined, build: Build, refusal: string, ready: Extract<Ready, { ok: true }>, context: AppCommandContext, summary: (value: CadDimension) => string): Step {
  const candidate = (position: Point2D, id: string): CadDimension => makeDimension(id, build(position), ready.style, ready.drawing);
  const step: Step = {
    type: "prompt",
    prompt,
    expect: "point",
    acceptsEnter: true,
    basePoint,
    preview: (cursor): readonly PreviewShape[] => entityPreviewShapes(candidate(cursor, "preview"), IDENTITY_MATRIX),
    onInput: (input) => {
      if (input.kind === "enter") return { type: "done", messages: [endedMessage("寸法", NO_DIMENSION_DETAIL)] };
      if (input.kind !== "point") return step;
      const dimension = candidate(input.point, context.allocateEntityId());
      if (layoutDimension(dimension) === null) return { ...step, messages: [`${NAME}を作れません: ${refusal}`] };
      return { type: "done", messages: [summary(dimension)], requests: [{ type: "addEntities", entities: [dimension], label: "寸法を追加" }] };
    },
  };
  return step;
}

const lengthText = (dimension: CadDimension): string => layoutDimension(dimension)?.text.text ?? "";

// ---- 水平・垂直・平行 ----

type LinearKind = "horizontal" | "vertical" | "aligned";

const LINEAR_LABELS: Readonly<Record<LinearKind, string>> = { horizontal: "水平", vertical: "垂直", aligned: "平行" };

function linearGeometry(kind: LinearKind, p1: Point2D, p2: Point2D, position: Point2D): DimensionGeometry {
  if (kind === "aligned") return { kind: "aligned", p1, p2, position };
  return { kind: "linear", p1, p2, position, rotation: kind === "horizontal" ? 0 : HALF_PI };
}

function linearSecondStep(kind: LinearKind, p1: Point2D, ready: Extract<Ready, { ok: true }>, context: AppCommandContext): Step {
  const step: Step = {
    type: "prompt",
    prompt: "2つ目の点を指示してください",
    expect: "point",
    acceptsEnter: true,
    basePoint: p1,
    preview: (cursor): readonly PreviewShape[] => (isSamePoint(p1, cursor) ? [] : [{ kind: "polyline", points: [p1, cursor], closed: false }]),
    onInput: (input) => {
      if (input.kind === "enter") return { type: "done", messages: [endedMessage("寸法", NO_DIMENSION_DETAIL)] };
      if (input.kind !== "point") return step;
      const p2 = input.point;
      if (isSamePoint(p1, p2)) return { ...step, messages: ["1つ目の点と同じ点です。別の点を指示してください"] };
      // 水平・垂直の寸法は、測る方向の距離が 0 だと、寸法にならない
      if (kind === "horizontal" && Math.abs(p1.x - p2.x) < 1e-6) return { ...step, messages: ["2点の水平方向の距離が 0 です(垂直に並んでいます)。別の点を指示してください"] };
      if (kind === "vertical" && Math.abs(p1.y - p2.y) < 1e-6) return { ...step, messages: ["2点の垂直方向の距離が 0 です(水平に並んでいます)。別の点を指示してください"] };
      return positionStep(
        "寸法線の位置を指示してください[Enter=終了]",
        p2,
        (position) => linearGeometry(kind, p1, p2, position),
        "寸法の長さを計算できません",
        ready,
        context,
        (dimension) => `${LINEAR_LABELS[kind]}寸法を追加しました(${lengthText(dimension)})`,
      );
    },
  };
  return step;
}

function linearFirstStep(kind: LinearKind, ready: Extract<Ready, { ok: true }>, context: AppCommandContext): Step {
  const step: Step = {
    type: "prompt",
    prompt: `1つ目の点を指示してください(${LINEAR_LABELS[kind]}寸法。スタイル ${ready.style.name})`,
    expect: "point",
    acceptsEnter: true,
    onInput: (input) => {
      if (input.kind === "enter") return { type: "done", messages: [endedMessage("寸法", NO_DIMENSION_DETAIL)] };
      if (input.kind !== "point") return step;
      return linearSecondStep(kind, input.point, ready, context);
    },
  };
  return step;
}

// ---- 半径・直径 ----

type RoundKind = "radius" | "diameter";

const ROUND_LABELS: Readonly<Record<RoundKind, string>> = { radius: "半径", diameter: "直径" };

/** 円・円弧の、中心と半径(円・円弧でない・半径が正しくないときは null) */
function circleOf(entity: CadEntity | null): { center: Point2D; radius: number } | null {
  if (entity === null || (entity.type !== "CIRCLE" && entity.type !== "ARC")) return null;
  return entity.radius > 0 && Number.isFinite(entity.radius) ? { center: entity.center, radius: entity.radius } : null;
}

function roundPickStep(kind: RoundKind, ready: Extract<Ready, { ok: true }>, context: AppCommandContext): Step {
  const step: Step = {
    type: "prompt",
    prompt: `円または円弧をクリックしてください(${ROUND_LABELS[kind]}寸法。スタイル ${ready.style.name})[Enter=終了]`,
    expect: "point",
    acceptsEnter: true,
    rawPoints: true,
    onInput: (input) => {
      if (input.kind === "enter") return { type: "done", messages: [endedMessage("寸法", NO_DIMENSION_DETAIL)] };
      if (input.kind !== "point") return step;
      const picked = context.editing.pickEntity(input.point, NAME, "circular");
      if (!picked.ok) return { ...step, messages: [picked.message] };
      const circle = circleOf(context.editing.entityOf(picked.id));
      if (circle === null) return { ...step, messages: [`${NAME}できません: 円・円弧が見つからないか、半径が正しくありません`] };
      const onCircle = pointOnCircleToward(circle.center, circle.radius, input.point);
      return positionStep(
        kind === "radius" ? "寸法の文字の側の点を指示してください[Enter=終了]" : "直径の向きを決める点を指示してください(寸法は中心を通ります)[Enter=終了]",
        circle.center,
        (position) => ({ kind, p1: circle.center, p2: onCircle, position }),
        `${ROUND_LABELS[kind]}を計算できません`,
        ready,
        context,
        (dimension) => `${ROUND_LABELS[kind]}寸法を追加しました(${lengthText(dimension)})`,
      );
    },
  };
  return step;
}

// ---- 角度 ----

/** 1本の線(LINE)の端点。線でない・長さが正しくないときは null */
function lineOf(entity: CadEntity | null): { start: Point2D; end: Point2D } | null {
  if (entity === null || entity.type !== "LINE") return null;
  const length = Math.hypot(entity.end.x - entity.start.x, entity.end.y - entity.start.y);
  return length > 0 && Number.isFinite(length) ? { start: entity.start, end: entity.end } : null;
}

const ANGLE_SUMMARY = (dimension: CadDimension): string => `角度寸法を追加しました(${lengthText(dimension)})`;

/** 3点指定(頂点・1本目の腕の上の点・2本目の腕の上の点)の段階 */
function threePointSteps(ready: Extract<Ready, { ok: true }>, context: AppCommandContext): Step {
  const pointStep = (prompt: string, base: Point2D | undefined, next: (point: Point2D) => CommandStep<AppRequest>, sameAs?: Point2D): Step => {
    const step: Step = {
      type: "prompt",
      prompt,
      expect: "point",
      acceptsEnter: true,
      basePoint: base,
      preview: (cursor): readonly PreviewShape[] => (base === undefined || isSamePoint(base, cursor) ? [] : [{ kind: "polyline", points: [base, cursor], closed: false }]),
      onInput: (input) => {
        if (input.kind === "enter") return { type: "done", messages: [endedMessage("寸法", NO_DIMENSION_DETAIL)] };
        if (input.kind !== "point") return step;
        if (sameAs !== undefined && isSamePoint(sameAs, input.point)) return { ...step, messages: ["頂点と同じ点です。別の点を指示してください"] };
        return next(input.point);
      },
    };
    return step;
  };
  return pointStep("頂点を指示してください", undefined, (vertex) =>
    pointStep("1本目の腕の上の点を指示してください", vertex, (arm1) =>
      pointStep(
        "2本目の腕の上の点を指示してください",
        vertex,
        (arm2) =>
          positionStep(
            "寸法の弧が通る点を指示してください[Enter=終了]",
            vertex,
            (position) => ({ kind: "angular", p1: vertex, p2: arm1, p3: arm2, position }),
            "2本の腕が重なっているか、弧の位置が頂点と同じです",
            ready,
            context,
            ANGLE_SUMMARY,
          ),
        vertex,
      ),
      vertex,
    ),
  );
}

function angularSecondLineStep(first: { start: Point2D; end: Point2D }, ready: Extract<Ready, { ok: true }>, context: AppCommandContext): Step {
  const step: Step = {
    type: "prompt",
    prompt: "2本目の線をクリックしてください[Enter=終了]",
    expect: "point",
    acceptsEnter: true,
    rawPoints: true,
    onInput: (input) => {
      if (input.kind === "enter") return { type: "done", messages: [endedMessage("寸法", NO_DIMENSION_DETAIL)] };
      if (input.kind !== "point") return step;
      const picked = context.editing.pickEntity(input.point, NAME, "line");
      if (!picked.ok) return { ...step, messages: [picked.message] };
      const second = lineOf(context.editing.entityOf(picked.id));
      if (second === null) return { ...step, messages: [`${NAME}できません: 線が見つからないか、長さが正しくありません`] };
      // 2本の線が平行だと、角度が決まらない(ここで知らせて、別の線を選べるようにする)
      if (intersectionOfLines(first, second) === null) return { ...step, messages: [`${NAME}できません: 2本の線が平行です(角度を測れません)`] };
      return positionStep(
        "寸法の弧が通る点を指示してください(測る角の側)[Enter=終了]",
        undefined,
        (position) => {
          const result = angularFromLines(first, second, position);
          // 決まらない向き(頂点と同じ位置など)は、頂点と同じ点にして、形が計算できないものとして断る
          return result.ok ? { kind: "angular", p1: result.vertex, p2: result.arm1, p3: result.arm2, position } : { kind: "angular", p1: position, p2: position, p3: position, position };
        },
        "弧が通る点が、2本の線の交点と同じか、角が決まりません",
        ready,
        context,
        ANGLE_SUMMARY,
      );
    },
  };
  return step;
}

function angularFirstStep(ready: Extract<Ready, { ok: true }>, context: AppCommandContext): Step {
  const step: Step = {
    type: "prompt",
    prompt: `1本目の線をクリックしてください(角度寸法。スタイル ${ready.style.name})[Enter=3点指定]`,
    expect: "point",
    acceptsEnter: true,
    rawPoints: true,
    onInput: (input) => {
      if (input.kind === "enter") return threePointSteps(ready, context);
      if (input.kind !== "point") return step;
      const picked = context.editing.pickEntity(input.point, NAME, "line");
      if (!picked.ok) return { ...step, messages: [picked.message] };
      const first = lineOf(context.editing.entityOf(picked.id));
      if (first === null) return { ...step, messages: [`${NAME}できません: 線が見つからないか、長さが正しくありません`] };
      return angularSecondLineStep(first, ready, context);
    },
  };
  return step;
}

// ---- 定義 ----

function startWith(context: AppCommandContext, make: (ready: Extract<Ready, { ok: true }>) => Step) {
  const ready = readyFor(context);
  return ready.ok ? make(ready) : ready.done;
}

export const DIMENSION_COMMANDS: readonly AppCommandDefinition[] = [
  {
    name: "DIMHORIZONTAL",
    aliases: ["DH", "DIMLINEAR"],
    description: "水平寸法を描く(2点と、寸法線の位置を指定する)",
    start: (context) => startWith(context, (ready) => linearFirstStep("horizontal", ready, context)),
  },
  {
    name: "DIMVERTICAL",
    aliases: ["DV"],
    description: "垂直寸法を描く(2点と、寸法線の位置を指定する)",
    start: (context) => startWith(context, (ready) => linearFirstStep("vertical", ready, context)),
  },
  {
    name: "DIMALIGNED",
    aliases: ["DAL"],
    description: "平行寸法を描く(2点を結ぶ向きの寸法。2点と、寸法線の位置を指定する)",
    start: (context) => startWith(context, (ready) => linearFirstStep("aligned", ready, context)),
  },
  {
    name: "DIMRADIUS",
    aliases: ["DRA"],
    description: "半径寸法を描く(円・円弧をクリックして、文字の側の点を指定する)",
    start: (context) => startWith(context, (ready) => roundPickStep("radius", ready, context)),
  },
  {
    name: "DIMDIAMETER",
    aliases: ["DDI"],
    description: "直径寸法を描く(円・円弧をクリックして、向きを決める点を指定する)",
    start: (context) => startWith(context, (ready) => roundPickStep("diameter", ready, context)),
  },
  {
    name: "DIMANGULAR",
    aliases: ["DAN"],
    description: "角度寸法を描く(2本の線をクリックして、弧が通る点を指定する。Enter で3点指定)",
    start: (context) => startWith(context, (ready) => angularFirstStep(ready, context)),
  },
  {
    name: "DIMSTYLE",
    aliases: ["DST"],
    description: "寸法スタイル(文字の高さ・矢印・小数桁・単位・色・レイヤー・線種)の管理パネルを開く",
    start: () => ({ type: "done", requests: [{ type: "openDimensionStyles" }] }),
  },
];
