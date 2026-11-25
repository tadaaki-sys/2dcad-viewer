// 寸法の形(寸法線・寸法補助線・矢印・弧・数値)を、定義点とスタイルの値から計算する。画面にもファイル形式にも依存しない純粋な処理。
// 描画(CanvasRenderer)・範囲(entityBounds)・選択(Selection)・仮表示が、同じ関数を使う。そのため、見た目と選択範囲がずれない。
//
// 配置の規則(AutoCAD の既定に近い、簡単な規則):
// - 直線の寸法(水平・垂直・平行): 寸法線は position を通る。起点から寸法線までの距離が extensionOffset より大きいときだけ、寸法補助線を引く。
//   長さが矢印2本分(2 × arrowSize)に満たないときは、矢印を外側に出す(寸法線の外側に、矢印の長さの2倍の線を足す)。
//   文字は、矢印の間に収まるとき(長さ ≥ 文字の幅 + 矢印2本分)は、寸法線の中央の上に置く。収まらないときは、終点の外側に置く。
// - 半径: 中心から position への向きで、円周上の矢印の位置が決まる。矢印の先から position まで線を引き、その先に文字を置く。
// - 直径: 中心を通る直線寸法(寸法補助線なし)として扱う。向きは、中心から position への向き。
// - 角度: 頂点から position までの距離が弧の半径。position の向きを含む側の角(0〜360度)を測る。腕が弧に届かないときは、寸法補助線を引く。
// 文字は、線に沿って回転し、下から読める向き(-90度を超え90度以下)にそろえる。
import type { CadDimension, CadText, Point2D } from "../../types/cad";
import { DIMENSION_UNITS, formatDimensionAngle, formatDimensionDiameter, formatDimensionLength, formatDimensionRadius } from "./dimensionFormat";
import { exactCosSin } from "../geometry/transform";
import { measureTextBlock } from "../text/textLayout";

const TWO_PI = Math.PI * 2;
/** 文字と線の間隔(文字の高さに対する割合) */
export const DIMENSION_TEXT_GAP_FACTOR = 0.3;
/** 矢印の幅の半分(矢印の長さに対する割合。幅は長さの1/3) */
const ARROW_HALF_WIDTH_RATIO = 1 / 6;
/** 寸法補助線が、寸法線より先へ出る長さ(矢印の長さに対する割合) */
const EXTENSION_OVERSHOOT_RATIO = 0.5;
/** 矢印を外側に出すときの、寸法線の外側へ伸ばす線の長さ(矢印の長さに対する割合) */
const OUTSIDE_STUB_RATIO = 2;
/** これより短い長さ・距離は、0 として扱う(寸法にならない) */
const MIN_LENGTH = 1e-9;
/** 寸法の弧を折れ線にするときの、全周あたりの分割数(選択・範囲用。ズームに依存しない) */
const ARC_SEGMENTS_PER_FULL_CIRCLE = 48;

export type DimensionSegment = readonly [Point2D, Point2D];
export type DimensionArrow = readonly [Point2D, Point2D, Point2D];
export type DimensionArc = { center: Point2D; radius: number; startAngle: number; sweep: number };
export type DimensionTextPlacement = {
  text: string;
  position: Point2D;
  rotation: number;
  height: number;
  verticalAlign: "bottom" | "middle";
};

export type DimensionLayout = {
  /** 寸法線・寸法補助線 */
  segments: readonly DimensionSegment[];
  /** 矢印(塗りつぶしの三角形) */
  arrows: readonly DimensionArrow[];
  /** 角度寸法の弧 */
  arc: DimensionArc | null;
  text: DimensionTextPlacement;
  /** 測定値。長さ・半径・直径は図面の単位(mm)、角度はラジアン */
  value: number;
};

type Vec = { x: number; y: number };

const add = (p: Point2D, v: Vec, k = 1): Point2D => ({ x: p.x + v.x * k, y: p.y + v.y * k });
const sub = (a: Point2D, b: Point2D): Vec => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a: Vec, b: Vec): number => a.x * b.x + a.y * b.y;
const normal = (v: Vec): Vec => ({ x: -v.y, y: v.x });
const lengthOf = (v: Vec): number => Math.hypot(v.x, v.y);

function unitOf(v: Vec): Vec | null {
  const length = lengthOf(v);
  if (!(length > MIN_LENGTH) || !Number.isFinite(length)) return null;
  return { x: v.x / length, y: v.y / length };
}

const modTwoPi = (angle: number): number => ((angle % TWO_PI) + TWO_PI) % TWO_PI;

/** 文字が、下から読める向き(-90度を超え90度以下)になるように、角度(ラジアン)をそろえる */
export function readableTextAngle(angle: number): number {
  let t = angle % TWO_PI;
  if (t > Math.PI) t -= TWO_PI;
  if (t <= -Math.PI) t += TWO_PI;
  if (t > Math.PI / 2 + 1e-9) t -= Math.PI;
  else if (t <= -Math.PI / 2 + 1e-9) t += Math.PI;
  return t;
}

function textWidthOf(text: string, height: number): number {
  return measureTextBlock({ text, height, boxWidth: undefined, widthFactor: undefined, isMText: false }).width;
}

function arrowAt(tip: Point2D, inward: Vec, side: Vec, size: number): DimensionArrow {
  const base = add(tip, inward, size);
  const half = size * ARROW_HALF_WIDTH_RATIO;
  return [tip, add(base, side, half), add(base, side, -half)];
}

type RunInput = {
  a: Point2D;
  b: Point2D;
  /** a から b へ向かう単位ベクトル */
  e: Vec;
  length: number;
  textString: string;
  entity: CadDimension;
};

/** 直線の寸法線(a から b)と、その矢印・文字。寸法補助線は含まない */
function layoutRun({ a, b, e, length, textString, entity }: RunInput): Pick<DimensionLayout, "segments" | "arrows" | "text"> {
  const { textHeight, arrowSize } = entity.values;
  const side = normal(e);
  const gap = textHeight * DIMENSION_TEXT_GAP_FACTOR;
  const width = textWidthOf(textString, textHeight);
  const arrowsOutside = length < 2 * arrowSize;
  const textInside = length >= width + 2 * arrowSize;
  const segments: DimensionSegment[] = [[a, b]];
  const arrows: DimensionArrow[] = [];
  if (arrowsOutside) {
    const stub = arrowSize * OUTSIDE_STUB_RATIO;
    segments.push([a, add(a, e, -stub)], [b, add(b, e, stub)]);
    arrows.push(arrowAt(a, { x: -e.x, y: -e.y }, side, arrowSize), arrowAt(b, e, side, arrowSize));
  } else {
    arrows.push(arrowAt(a, e, side, arrowSize), arrowAt(b, { x: -e.x, y: -e.y }, side, arrowSize));
  }
  const rotation = readableTextAngle(Math.atan2(e.y, e.x));
  let text: DimensionTextPlacement;
  if (textInside) {
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const up = { x: -Math.sin(rotation), y: Math.cos(rotation) };
    text = { text: textString, position: add(mid, up, gap), rotation, height: textHeight, verticalAlign: "bottom" };
  } else {
    const beyond = (arrowsOutside ? arrowSize * OUTSIDE_STUB_RATIO : 0) + gap + width / 2;
    text = { text: textString, position: add(b, e, beyond), rotation, height: textHeight, verticalAlign: "middle" };
  }
  return { segments, arrows, text };
}

function layoutLinear(entity: CadDimension): DimensionLayout | null {
  const { p1, p2, position } = entity;
  let u: Vec | null;
  if (entity.kind === "linear") {
    const rotation = entity.rotation ?? 0;
    // 90度の倍数(水平・垂直)は、ぴったりの値(0・±1)にする(cos(90°) = 6e-17 の誤差が、座標に入らないように)
    if (Number.isFinite(rotation)) {
      const { cos, sin } = exactCosSin(rotation);
      u = { x: cos, y: sin };
    } else u = null;
  } else {
    u = unitOf(sub(p2, p1));
  }
  if (u === null) return null;
  const n = normal(u);
  const s1 = dot(sub(position, p1), n);
  const s2 = dot(sub(position, p2), n);
  const a = add(p1, n, s1);
  const b = add(p2, n, s2);
  const signed = dot(sub(b, a), u);
  const length = Math.abs(signed);
  if (!(length > MIN_LENGTH) || !Number.isFinite(length)) return null;
  const e = signed >= 0 ? u : { x: -u.x, y: -u.y };
  const { extensionOffset, arrowSize } = entity.values;
  const segments: DimensionSegment[] = [];
  const overshoot = arrowSize * EXTENSION_OVERSHOOT_RATIO;
  for (const [origin, onLine, s] of [[p1, a, s1], [p2, b, s2]] as const) {
    if (Math.abs(s) > extensionOffset) {
      const toward = s > 0 ? n : { x: -n.x, y: -n.y };
      segments.push([add(origin, toward, extensionOffset), add(onLine, toward, overshoot)]);
    }
  }
  const run = layoutRun({ a, b, e, length, textString: formatDimensionLength(length, entity.values), entity });
  return { segments: [...segments, ...run.segments], arrows: run.arrows, arc: null, text: run.text, value: length };
}

/** 半径・直径の、円の中心・半径・中心から見た文字側の向き。決まらないときは null */
function circleParts(entity: CadDimension): { center: Point2D; radius: number; direction: Vec } | null {
  const center = entity.p1;
  const radius = lengthOf(sub(entity.p2, center));
  if (!(radius > MIN_LENGTH) || !Number.isFinite(radius)) return null;
  const toward = sub(entity.position, center);
  // 文字の側の点が中心と(ほぼ)同じなら、半径を決めた点の向きにする
  const direction = lengthOf(toward) > radius * 1e-9 ? unitOf(toward) : unitOf(sub(entity.p2, center));
  return direction === null ? null : { center, radius, direction };
}

function layoutRadius(entity: CadDimension): DimensionLayout | null {
  const parts = circleParts(entity);
  if (parts === null) return null;
  const { center, radius, direction } = parts;
  const { textHeight, arrowSize } = entity.values;
  const tip = add(center, direction, radius);
  // 矢印の先から文字の側の点までの線。短すぎるときは、矢印2本分の長さにする
  let toText = unitOf(sub(entity.position, tip));
  const reach = lengthOf(sub(entity.position, tip));
  let end = entity.position;
  if (toText === null || reach < 2 * arrowSize) {
    toText = toText ?? direction;
    end = add(tip, toText, 2 * arrowSize);
  }
  const textString = formatDimensionRadius(radius, entity.values);
  const width = textWidthOf(textString, textHeight);
  const gap = textHeight * DIMENSION_TEXT_GAP_FACTOR;
  const rotation = readableTextAngle(Math.atan2(toText.y, toText.x));
  return {
    segments: [[tip, end]],
    arrows: [arrowAt(tip, toText, normal(toText), arrowSize)],
    arc: null,
    text: { text: textString, position: add(end, toText, gap + width / 2), rotation, height: textHeight, verticalAlign: "middle" },
    value: radius,
  };
}

function layoutDiameter(entity: CadDimension): DimensionLayout | null {
  const parts = circleParts(entity);
  if (parts === null) return null;
  const { center, radius, direction } = parts;
  const a = add(center, direction, -radius);
  const b = add(center, direction, radius);
  const length = radius * 2;
  if (!Number.isFinite(length)) return null;
  const run = layoutRun({ a, b, e: direction, length, textString: formatDimensionDiameter(length, entity.values), entity });
  return { segments: run.segments, arrows: run.arrows, arc: null, text: run.text, value: length };
}

function layoutAngular(entity: CadDimension): DimensionLayout | null {
  const vertex = entity.p1;
  const arm1 = entity.p2;
  const arm2 = entity.p3;
  if (arm2 === undefined) return null;
  const v1 = sub(arm1, vertex);
  const v2 = sub(arm2, vertex);
  const vp = sub(entity.position, vertex);
  const radius = lengthOf(vp);
  // 腕・位置のベクトルが、桁あふれで有限でなくなるときは、向き(atan2)が正しくならないので、断る
  if (!Number.isFinite(lengthOf(v1)) || !Number.isFinite(lengthOf(v2))) return null;
  if (!(lengthOf(v1) > MIN_LENGTH) || !(lengthOf(v2) > MIN_LENGTH) || !(radius > MIN_LENGTH) || !Number.isFinite(radius)) return null;
  const a1 = Math.atan2(v1.y, v1.x);
  const a2 = Math.atan2(v2.y, v2.x);
  const ap = Math.atan2(vp.y, vp.x);
  const sweepFirstToSecond = modTwoPi(a2 - a1);
  const containsPosition = modTwoPi(ap - a1) <= sweepFirstToSecond;
  const start = containsPosition ? a1 : a2;
  const sweep = containsPosition ? sweepFirstToSecond : TWO_PI - sweepFirstToSecond;
  // 2本の腕が重なる(角が 0 度または 360 度)ときは、角度として測れない
  if (!(sweep > 1e-9) || !(sweep < TWO_PI - 1e-9)) return null;
  const end = start + sweep;
  const { arrowSize, extensionOffset, textHeight } = entity.values;
  const startPoint = add(vertex, { x: Math.cos(start), y: Math.sin(start) }, radius);
  const endPoint = add(vertex, { x: Math.cos(end), y: Math.sin(end) }, radius);
  const segments: DimensionSegment[] = [];
  // 腕の上の点が、弧より手前にあるときだけ、そこから弧の先まで寸法補助線を引く
  const startArm = containsPosition ? v1 : v2;
  const endArm = containsPosition ? v2 : v1;
  for (const [armVector, angle] of [[startArm, start], [endArm, end]] as const) {
    const reach = lengthOf(armVector);
    const dir = { x: Math.cos(angle), y: Math.sin(angle) };
    if (radius > reach + extensionOffset) segments.push([add(vertex, dir, reach + extensionOffset), add(vertex, dir, radius + arrowSize * EXTENSION_OVERSHOOT_RATIO)]);
  }
  const tangentStart = { x: -Math.sin(start), y: Math.cos(start) };
  const tangentEnd = { x: -Math.sin(end), y: Math.cos(end) };
  const outside = radius * sweep < 2 * arrowSize;
  const sign = outside ? -1 : 1;
  const arrows: DimensionArrow[] = [
    arrowAt(startPoint, { x: tangentStart.x * sign, y: tangentStart.y * sign }, { x: Math.cos(start), y: Math.sin(start) }, arrowSize),
    arrowAt(endPoint, { x: -tangentEnd.x * sign, y: -tangentEnd.y * sign }, { x: Math.cos(end), y: Math.sin(end) }, arrowSize),
  ];
  const mid = start + sweep / 2;
  const rotation = readableTextAngle(mid + Math.PI / 2);
  const up = { x: -Math.sin(rotation), y: Math.cos(rotation) };
  const onArc = add(vertex, { x: Math.cos(mid), y: Math.sin(mid) }, radius);
  const text: DimensionTextPlacement = {
    text: formatDimensionAngle(sweep, entity.values),
    position: add(onArc, up, textHeight * DIMENSION_TEXT_GAP_FACTOR),
    rotation,
    height: textHeight,
    verticalAlign: "bottom",
  };
  return { segments, arrows, arc: { center: vertex, radius, startAngle: start, sweep }, text, value: sweep };
}

function isFinitePoint(p: Point2D): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y);
}

/** 寸法の値(スタイルの値)が、計算できる範囲か */
function valuesAreUsable(entity: CadDimension): boolean {
  const v = entity.values;
  const sizesOk = Number.isFinite(v.textHeight) && v.textHeight > 0 && Number.isFinite(v.arrowSize) && v.arrowSize > 0 && Number.isFinite(v.extensionOffset) && v.extensionOffset >= 0;
  // 数値の整形に使う値(単位・小数桁・単位の表示)も、使える値か(読み込んだデータが不正でも、"?" を寸法の値として表示しない)
  const formatOk = DIMENSION_UNITS.includes(v.unit) && Number.isFinite(v.decimals) && Number.isFinite(v.angleDecimals) && typeof v.showUnit === "boolean";
  return sizesOk && formatOk;
}

/**
 * 寸法の形を計算する。定義点やスタイルの値が正しくない(長さ 0・重なる腕・有限でない値)ときは null。
 * 図形は変えない。結果は、毎回、新しく作る(図形が変わらない限り、同じ結果)。
 */
export function layoutDimension(entity: CadDimension): DimensionLayout | null {
  const points = [entity.p1, entity.p2, entity.position, ...(entity.p3 === undefined ? [] : [entity.p3])];
  if (!points.every(isFinitePoint) || !valuesAreUsable(entity)) return null;
  let layout: DimensionLayout | null;
  switch (entity.kind) {
    case "linear":
    case "aligned":
      layout = layoutLinear(entity);
      break;
    case "radius":
      layout = layoutRadius(entity);
      break;
    case "diameter":
      layout = layoutDiameter(entity);
      break;
    case "angular":
      layout = layoutAngular(entity);
      break;
  }
  if (layout === null) return null;
  // 計算の途中で、桁あふれして有限でなくなった結果は、描かない
  const outputs = [...layout.segments.flat(), ...layout.arrows.flat(), layout.text.position];
  if (!outputs.every(isFinitePoint) || !Number.isFinite(layout.value) || !Number.isFinite(layout.text.rotation)) return null;
  return layout;
}

/** 寸法の文字を、描画・範囲・選択で、ふつうの文字(TEXT)として扱うための、一時的な文字 */
export function dimensionTextEntity(entity: CadDimension, layout: DimensionLayout): CadText {
  return {
    id: entity.id,
    type: "TEXT",
    layer: entity.layer,
    color: entity.color,
    position: layout.text.position,
    text: layout.text.text,
    height: layout.text.height,
    rotation: layout.text.rotation,
    horizontalAlign: "center",
    verticalAlign: layout.text.verticalAlign,
  };
}

/**
 * 弧を折れ線にした点列(窓選択・範囲用の固定の分割)。弧が x・y 方向の極値(0・90・180・270度)をまたぐときは、その点も含める
 * (含めないと、範囲が、弧より最大で弦と弧の差だけ小さくなる)。弧への距離(クリックでの選択)は、折れ線ではなく、解析的に求める。
 */
export function dimensionArcPoints(arc: DimensionArc): Point2D[] {
  const count = Math.max(2, Math.round((arc.sweep / TWO_PI) * ARC_SEGMENTS_PER_FULL_CIRCLE));
  const at = (angle: number): Point2D => ({ x: arc.center.x + arc.radius * Math.cos(angle), y: arc.center.y + arc.radius * Math.sin(angle) });
  const points: Point2D[] = [];
  for (let i = 0; i <= count; i++) points.push(at(arc.startAngle + (arc.sweep * i) / count));
  for (let quarter = 0; quarter < 4; quarter++) {
    const axis = (quarter * Math.PI) / 2;
    if (modTwoPi(axis - arc.startAngle) <= arc.sweep) points.push(at(axis));
  }
  return points;
}

/** 定義点(形が決まらないときの、範囲・選択の代わりにもなる) */
export function dimensionDefiningPoints(entity: CadDimension): Point2D[] {
  return [entity.p1, entity.p2, ...(entity.p3 === undefined ? [] : [entity.p3]), entity.position];
}

/** 寸法の線として扱う線分(寸法線・寸法補助線・矢印の縁・弧)。計算できない寸法は、定義点を結ぶ線分 */
export function dimensionLineSegments(entity: CadDimension, layout: DimensionLayout | null = layoutDimension(entity), includeArc = true): DimensionSegment[] {
  if (layout === null) {
    const points = dimensionDefiningPoints(entity);
    return points.slice(1).map((point, i): DimensionSegment => [points[i], point]);
  }
  const segments: DimensionSegment[] = [...layout.segments];
  for (const [p, q, r] of layout.arrows) segments.push([p, q], [q, r], [r, p]);
  if (layout.arc !== null && includeArc) {
    // 弧を、極値の点を除いた、折れ線にする(極値の点は、点の並びの末尾に足してあり、弧の順にならない)
    const arc = layout.arc;
    const count = Math.max(2, Math.round((arc.sweep / TWO_PI) * ARC_SEGMENTS_PER_FULL_CIRCLE));
    const points = dimensionArcPoints(arc).slice(0, count + 1);
    for (let i = 1; i < points.length; i++) segments.push([points[i - 1], points[i]]);
  }
  return segments;
}
