// 作図コマンドが作る、新しい図形(線・ポリライン・長方形・円・円弧)。React にも画面にも依存しない。
// 色は、取り込んだ図形と同じく、レイヤーの色を数値にして持つ(保存の Phase で、レイヤー色の指定(BYLAYER)へ戻す)。
import type { ArcShape } from "../../core/geometry/construct";
import type { TextStyle } from "../../core/text/textStyle";
import { dimensionLineDash, dimensionValuesOf } from "../../core/dimension/dimensionStyle";
import type { DimensionStyle } from "../../core/dimension/dimensionStyle";
import { BYLAYER_COLOR, BYLAYER_LINETYPE } from "../../core/style/byLayer";
import type { CadArc, CadCircle, CadDimension, CadLine, DimensionRef, CadPolyline, CadText, EntityExtras, LineDash, Point2D } from "../../types/cad";
import type { DrawTarget } from "../commands/types";

/**
 * 新しい図形の見た目(現在のレイヤーと、その設定)。color・lineDash・lineWeight は、レイヤーの設定を解決した値で、
 * byLayer は、どの属性がレイヤーに従うかの印(Phase 17)。印が無ければ、図形自身の指定(ByObject)。
 */
export type DrawingStyle = { layer: string; color: string; lineDash?: LineDash; lineWeight?: number; byLayer?: number };

/** 描く先(現在のレイヤー)から、新しい図形の見た目を作る(レイヤーの色・線種・線の太さに従う、ByLayer) */
export function drawingStyleOfTarget(target: Extract<DrawTarget, { ok: true }>): DrawingStyle {
  return {
    layer: target.layer,
    color: target.color,
    ...(target.lineDash === undefined ? {} : { lineDash: target.lineDash }),
    ...(target.lineWeight === undefined ? {} : { lineWeight: target.lineWeight }),
    ...(target.byLayer === undefined ? {} : { byLayer: target.byLayer }),
  };
}

/** 線・折れ線・円・円弧が持つ、レイヤーに従う属性(線種・線の太さ・ByLayer の印) */
function lineAttributes(style: DrawingStyle): { lineDash?: LineDash; lineWeight?: number; byLayer?: number } {
  return {
    ...(style.lineDash === undefined ? {} : { lineDash: style.lineDash }),
    ...(style.lineWeight === undefined ? {} : { lineWeight: style.lineWeight }),
    ...(style.byLayer === undefined ? {} : { byLayer: style.byLayer }),
  };
}

/** この距離(図面の単位=mm)より近い2点は、同じ点として扱う。座標入力の計算の誤差(@10<90 など)を吸収する */
export const SAME_POINT_TOLERANCE = 1e-6;

export function isSamePoint(a: Point2D, b: Point2D): boolean {
  return Math.abs(a.x - b.x) < SAME_POINT_TOLERANCE && Math.abs(a.y - b.y) < SAME_POINT_TOLERANCE;
}

export function makeLine(id: string, start: Point2D, end: Point2D, style: DrawingStyle): CadLine & EntityExtras {
  return { id, type: "LINE", layer: style.layer, color: style.color, ...lineAttributes(style), start: { ...start }, end: { ...end } };
}

/** ポリライン(LWPOLYLINE)。円弧(bulge)は持たない、直線だけの折れ線 */
export function makePolyline(id: string, points: readonly Point2D[], closed: boolean, style: DrawingStyle): CadPolyline & EntityExtras {
  return {
    id,
    type: "LWPOLYLINE",
    layer: style.layer,
    color: style.color,
    ...lineAttributes(style),
    vertices: points.map((p) => ({ x: p.x, y: p.y })),
    closed,
  };
}

export function makeCircle(id: string, center: Point2D, radius: number, style: DrawingStyle): CadCircle & EntityExtras {
  return { id, type: "CIRCLE", layer: style.layer, color: style.color, ...lineAttributes(style), center: { ...center }, radius };
}

/** 円弧。角度はラジアンで、始点から終点へ反時計回り(DXFのARCと同じ) */
export function makeArc(id: string, arc: ArcShape, style: DrawingStyle): CadArc & EntityExtras {
  return {
    id,
    type: "ARC",
    layer: style.layer,
    color: style.color,
    ...lineAttributes(style),
    center: { ...arc.center },
    radius: arc.radius,
    startAngle: arc.startAngle,
    endAngle: arc.endAngle,
  };
}

/**
 * 文字(TEXT・MTEXT)。描いたときの文字スタイルの値を、そのまま持つ(コピー)。スタイル名は記録するだけ。
 * boxWidth を渡すと、複数行文字(MTEXT)になる(枠の幅で折り返す。垂直の配置は、枠の上に合わせて top にする)。
 */
export function makeText(
  id: string,
  position: Point2D,
  text: string,
  rotation: number,
  textStyle: TextStyle,
  style: DrawingStyle,
  boxWidth?: number,
): CadText & EntityExtras {
  const multiline = boxWidth !== undefined;
  return {
    id,
    type: "TEXT",
    layer: style.layer,
    color: style.color,
    // 文字は、色だけがレイヤーに従う(線種・線の太さは持たない)
    ...(style.byLayer === undefined || (style.byLayer & BYLAYER_COLOR) === 0 ? {} : { byLayer: BYLAYER_COLOR }),
    position: { ...position },
    text,
    height: textStyle.height,
    ...(textStyle.widthFactor !== 1 ? { widthFactor: textStyle.widthFactor } : {}),
    rotation,
    horizontalAlign: textStyle.horizontalAlign,
    verticalAlign: multiline ? "top" : textStyle.verticalAlign,
    fontFamily: textStyle.fontFamily,
    italic: textStyle.italic,
    styleName: textStyle.name,
    ...(multiline ? { boxWidth, isMText: true } : {}),
  };
}

/** 寸法の、種類ごとの定義点(CadDimension の p1・p2・p3・position・rotation) */
export type DimensionGeometry = Pick<CadDimension, "kind" | "p1" | "p2" | "p3" | "position" | "rotation">;

/**
 * 寸法。描いたときの寸法スタイルの値を、そのまま持つ(コピー。スタイル名は記録するだけ)。
 * 色は、スタイルが色を指定していればそれ、無ければ描くレイヤーの色。線種は、スタイルの線種。
 * refs は、関連付ける図形(連動寸法。無ければ、連動しない寸法)。
 */
export function makeDimension(id: string, geometry: DimensionGeometry, dimensionStyle: DimensionStyle, target: DrawingStyle, refs: readonly DimensionRef[] = []): CadDimension & EntityExtras {
  // 線種が bylayer なら、描くレイヤーの線種(解決済みの破線)に従う。色も、スタイルが指定していなければ、レイヤーの色に従う
  const followsLinetype = dimensionStyle.linetype === "bylayer";
  const lineDash = followsLinetype ? target.lineDash : dimensionLineDash(dimensionStyle.linetype, dimensionStyle.textHeight);
  const byLayer = (dimensionStyle.color === null ? BYLAYER_COLOR : 0) | (followsLinetype ? BYLAYER_LINETYPE : 0);
  return {
    id,
    type: "DIMENSION",
    layer: target.layer,
    color: dimensionStyle.color ?? target.color,
    ...(lineDash === undefined ? {} : { lineDash }),
    ...(byLayer === 0 ? {} : { byLayer }),
    kind: geometry.kind,
    p1: { ...geometry.p1 },
    p2: { ...geometry.p2 },
    ...(geometry.p3 === undefined ? {} : { p3: { ...geometry.p3 } }),
    position: { ...geometry.position },
    ...(geometry.rotation === undefined ? {} : { rotation: geometry.rotation }),
    values: dimensionValuesOf(dimensionStyle),
    styleName: dimensionStyle.name,
    ...(refs.length > 0 ? { refs: refs.map((ref) => ({ ...ref, anchor: { ...ref.anchor } })) } : {}),
  };
}

/** 長方形の4つの頂点(1つ目の角から、反時計回りか時計回りかは、2つ目の角の向きで決まる) */
export function rectangleCorners(first: Point2D, second: Point2D): Point2D[] {
  return [
    { x: first.x, y: first.y },
    { x: second.x, y: first.y },
    { x: second.x, y: second.y },
    { x: first.x, y: second.y },
  ];
}

/** 幅または高さが(ほぼ)0で、長方形にならないか */
export function isDegenerateRectangle(first: Point2D, second: Point2D): boolean {
  return Math.abs(first.x - second.x) < SAME_POINT_TOLERANCE || Math.abs(first.y - second.y) < SAME_POINT_TOLERANCE;
}

export function makeRectangle(id: string, first: Point2D, second: Point2D, style: DrawingStyle): CadPolyline & EntityExtras {
  return makePolyline(id, rectangleCorners(first, second), true, style);
}
