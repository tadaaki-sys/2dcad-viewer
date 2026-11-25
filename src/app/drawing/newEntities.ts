// 作図コマンドが作る、新しい図形(線・ポリライン・長方形・円・円弧)。React にも画面にも依存しない。
// 色は、取り込んだ図形と同じく、レイヤーの色を数値にして持つ(保存の Phase で、レイヤー色の指定(BYLAYER)へ戻す)。
import type { ArcShape } from "../../core/geometry/construct";
import type { TextStyle } from "../../core/text/textStyle";
import { dimensionLineDash, dimensionValuesOf } from "../../core/dimension/dimensionStyle";
import type { DimensionStyle } from "../../core/dimension/dimensionStyle";
import type { CadArc, CadCircle, CadDimension, CadLine, CadPolyline, CadText, Point2D } from "../../types/cad";

/** 新しい図形の見た目(現在のレイヤーと、その色) */
export type DrawingStyle = { layer: string; color: string };

/** この距離(図面の単位=mm)より近い2点は、同じ点として扱う。座標入力の計算の誤差(@10<90 など)を吸収する */
export const SAME_POINT_TOLERANCE = 1e-6;

export function isSamePoint(a: Point2D, b: Point2D): boolean {
  return Math.abs(a.x - b.x) < SAME_POINT_TOLERANCE && Math.abs(a.y - b.y) < SAME_POINT_TOLERANCE;
}

export function makeLine(id: string, start: Point2D, end: Point2D, style: DrawingStyle): CadLine {
  return { id, type: "LINE", layer: style.layer, color: style.color, start: { ...start }, end: { ...end } };
}

/** ポリライン(LWPOLYLINE)。円弧(bulge)は持たない、直線だけの折れ線 */
export function makePolyline(id: string, points: readonly Point2D[], closed: boolean, style: DrawingStyle): CadPolyline {
  return {
    id,
    type: "LWPOLYLINE",
    layer: style.layer,
    color: style.color,
    vertices: points.map((p) => ({ x: p.x, y: p.y })),
    closed,
  };
}

export function makeCircle(id: string, center: Point2D, radius: number, style: DrawingStyle): CadCircle {
  return { id, type: "CIRCLE", layer: style.layer, color: style.color, center: { ...center }, radius };
}

/** 円弧。角度はラジアンで、始点から終点へ反時計回り(DXFのARCと同じ) */
export function makeArc(id: string, arc: ArcShape, style: DrawingStyle): CadArc {
  return {
    id,
    type: "ARC",
    layer: style.layer,
    color: style.color,
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
): CadText {
  const multiline = boxWidth !== undefined;
  return {
    id,
    type: "TEXT",
    layer: style.layer,
    color: style.color,
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
 */
export function makeDimension(id: string, geometry: DimensionGeometry, dimensionStyle: DimensionStyle, target: DrawingStyle): CadDimension {
  const lineDash = dimensionLineDash(dimensionStyle.linetype, dimensionStyle.textHeight);
  return {
    id,
    type: "DIMENSION",
    layer: target.layer,
    color: dimensionStyle.color ?? target.color,
    ...(lineDash === undefined ? {} : { lineDash }),
    kind: geometry.kind,
    p1: { ...geometry.p1 },
    p2: { ...geometry.p2 },
    ...(geometry.p3 === undefined ? {} : { p3: { ...geometry.p3 } }),
    position: { ...geometry.position },
    ...(geometry.rotation === undefined ? {} : { rotation: geometry.rotation }),
    values: dimensionValuesOf(dimensionStyle),
    styleName: dimensionStyle.name,
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

export function makeRectangle(id: string, first: Point2D, second: Point2D, style: DrawingStyle): CadPolyline {
  return makePolyline(id, rectangleCorners(first, second), true, style);
}
