// 作図コマンドが作る、新しい図形(線・ポリライン・長方形)。React にも画面にも依存しない。
// 色は、取り込んだ図形と同じく、レイヤーの色を数値にして持つ(保存の Phase で、レイヤー色の指定(BYLAYER)へ戻す)。
import type { CadLine, CadPolyline, Point2D } from "../../types/cad";

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
