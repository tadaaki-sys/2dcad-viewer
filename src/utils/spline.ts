import type { Point2D } from "../types/cad";
import { pointToSegmentDistance } from "./geometry";

// 1本のスプラインの総点数の上限。大きな図面ではスプラインが数千本あり、点数がそのまま描画負荷になる。
const MAX_POINTS_PER_SPLINE = 1200;
// ノットスパンごとに最低この数へ等分してから、曲がり具合に応じて細分化する(S字でも弦の上に中点が乗る見落としを避ける)
const INITIAL_INTERVALS_PER_SPAN = 4;
const MAX_REFINE_DEPTH = 6;
// 許容誤差=スプライン自身の大きさ(制御点のバウンディング対角線)に対する比率。画面いっぱいに拡大しても誤差は数px以内
const FLATNESS_TOLERANCE_RATIO = 0.0005;
const KNOT_EPSILON = 1e-12;

export type SplineInput = {
  controlPoints?: Point2D[];
  fitPoints?: Point2D[];
  knots?: number[];
  degree?: number;
};

/** ノット列が(制御点数 + 次数 + 1)個で、単調非減少、かつ有効な定義域を持つか */
function hasValidKnots(controlPointCount: number, degree: number, knots: number[] | undefined): knots is number[] {
  if (!knots || knots.length !== controlPointCount + degree + 1) return false;
  for (let i = 1; i < knots.length; i++) {
    if (!(knots[i] >= knots[i - 1])) return false;
  }
  return knots[controlPointCount] - knots[degree] > KNOT_EPSILON;
}

/** de Boor法でB-スプライン曲線上のパラメータtの点を求める(重み無し=非有理) */
export function evaluateBSpline(controlPoints: Point2D[], knots: number[], degree: number, t: number): Point2D {
  const n = controlPoints.length;
  let span = degree;
  while (span < n - 1 && t >= knots[span + 1]) span++;

  const work = controlPoints.slice(span - degree, span + 1).map((p) => ({ x: p.x, y: p.y }));
  for (let r = 1; r <= degree; r++) {
    for (let j = degree; j >= r; j--) {
      const i = span - degree + j;
      const denominator = knots[i + degree - r + 1] - knots[i];
      const alpha = denominator > KNOT_EPSILON ? (t - knots[i]) / denominator : 0;
      work[j] = {
        x: (1 - alpha) * work[j - 1].x + alpha * work[j].x,
        y: (1 - alpha) * work[j - 1].y + alpha * work[j].y,
      };
    }
  }
  return work[degree];
}

function sampleBSpline(controlPoints: Point2D[], knots: number[], degree: number): Point2D[] {
  const n = controlPoints.length;
  const domainStart = knots[degree];
  const domainEnd = knots[n];

  const spans: Array<[number, number]> = [];
  for (let k = degree; k < n; k++) {
    if (knots[k + 1] - knots[k] > KNOT_EPSILON) spans.push([knots[k], knots[k + 1]]);
  }

  // スパン数が多いほど1スパンあたりの点数を絞り、総点数が上限を超えないようにする
  const spanCount = Math.max(1, spans.length);
  const initialIntervals = Math.max(1, Math.min(INITIAL_INTERVALS_PER_SPAN, Math.floor(MAX_POINTS_PER_SPLINE / spanCount)));
  const maxDepth =
    initialIntervals < INITIAL_INTERVALS_PER_SPAN
      ? 0
      : Math.max(0, Math.min(MAX_REFINE_DEPTH, Math.floor(Math.log2(MAX_POINTS_PER_SPLINE / (spanCount * INITIAL_INTERVALS_PER_SPAN)))));
  const tolerance = FLATNESS_TOLERANCE_RATIO * controlPolygonExtent(controlPoints);

  const evaluate = (t: number) => evaluateBSpline(controlPoints, knots, degree, t);
  const points: Point2D[] = [];

  /** [t0,t1]の中点が弦から許容誤差以上ずれている間、区間を二分して点を追加する(始点は含み終点は含まない) */
  function refine(t0: number, p0: Point2D, t1: number, p1: Point2D, depth: number): void {
    if (depth < maxDepth) {
      const tm = (t0 + t1) / 2;
      const pm = evaluate(tm);
      if (pointToSegmentDistance(pm, p0, p1) > tolerance) {
        refine(t0, p0, tm, pm, depth + 1);
        refine(tm, pm, t1, p1, depth + 1);
        return;
      }
    }
    points.push(p0);
  }

  for (const [t0, t1] of spans) {
    let tPrev = t0;
    let pPrev = evaluate(tPrev);
    for (let j = 1; j <= initialIntervals; j++) {
      const tNext = t0 + ((t1 - t0) * j) / initialIntervals;
      const pNext = evaluate(tNext);
      refine(tPrev, pPrev, tNext, pNext, 0);
      tPrev = tNext;
      pPrev = pNext;
    }
  }
  points.push(evaluate(domainEnd));
  if (points.length === 1) points.push(evaluate(domainStart));
  return points;
}

function controlPolygonExtent(points: Point2D[]): number {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return Math.hypot(maxX - minX, maxY - minY);
}

/**
 * DXFのSPLINEを描画/選択用の折れ線に近似する。
 * 制御点とノット列が整合していればB-スプラインとして評価し、無ければフィットポイント、
 * それも無ければ制御点列を結んだ折れ線にフォールバックする。有理スプラインの重みは無視する。
 * 2点未満しか得られない場合はnullを返す。
 */
export function tessellateSpline(input: SplineInput): Point2D[] | null {
  const controlPoints = input.controlPoints ?? [];
  const degree = Math.floor(input.degree ?? 3);

  if (controlPoints.length >= 2 && degree >= 1 && degree < controlPoints.length && hasValidKnots(controlPoints.length, degree, input.knots)) {
    return sampleBSpline(controlPoints, input.knots as number[], degree);
  }
  if ((input.fitPoints?.length ?? 0) >= 2) return input.fitPoints as Point2D[];
  if (controlPoints.length >= 2) return controlPoints;
  return null;
}
