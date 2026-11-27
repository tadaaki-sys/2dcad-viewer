// 図形の値(座標・半径・角度・文字の高さ・回転)を1つ書き換える(Phase 18。プロパティ欄からの編集)。
// 画面にもファイル形式にも依存しない純粋な処理。図形は書き換えず、新しい図形を返す。角度は、度(画面の入力と同じ)。
import type { CadEntity } from "../../types/cad";
import { isUsableRadius, normalizeAngle } from "./construct";

export type GeometryField =
  | "startX"
  | "startY"
  | "endX"
  | "endY"
  | "centerX"
  | "centerY"
  | "radius"
  | "startAngle"
  | "endAngle"
  | "positionX"
  | "positionY"
  | "height"
  | "rotation";

export type GeometryEdit = { ok: true; entity: CadEntity } | { ok: false; error: string };

const fail = (error: string): GeometryEdit => ({ ok: false, error });

/** 文字の高さの範囲 */
export const MIN_TEXT_HEIGHT = 1e-6;
export const MAX_TEXT_HEIGHT = 1e9;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/** 座標の絶対値の上限(これを超える値は、描画・計算が壊れるので断る) */
const MAX_COORDINATE = 1e15;

/** 図形が、その項目を持っているか(プロパティ欄に、編集できる欄を出すかの判断にも使う) */
export function geometryFieldsOf(entity: CadEntity): readonly GeometryField[] {
  switch (entity.type) {
    case "LINE":
      return ["startX", "startY", "endX", "endY"];
    case "CIRCLE":
      return ["centerX", "centerY", "radius"];
    case "ARC":
      return ["centerX", "centerY", "radius", "startAngle", "endAngle"];
    case "TEXT":
      return ["positionX", "positionY", "height", "rotation"];
    case "POINT":
      return ["positionX", "positionY"];
    default:
      return [];
  }
}

const toDegrees = (radians: number): number => (radians * 180) / Math.PI;

/** 図形の、その項目のいまの値(角度は度)。その図形に無い項目は null */
export function geometryValueOf(entity: CadEntity, field: GeometryField): number | null {
  switch (entity.type) {
    case "LINE":
      return field === "startX" ? entity.start.x : field === "startY" ? entity.start.y : field === "endX" ? entity.end.x : field === "endY" ? entity.end.y : null;
    case "CIRCLE":
    case "ARC":
      if (field === "centerX") return entity.center.x;
      if (field === "centerY") return entity.center.y;
      if (field === "radius") return entity.radius;
      if (entity.type === "ARC" && field === "startAngle") return toDegrees(entity.startAngle);
      if (entity.type === "ARC" && field === "endAngle") return toDegrees(entity.endAngle);
      return null;
    case "TEXT":
      return field === "positionX" ? entity.position.x : field === "positionY" ? entity.position.y : field === "height" ? entity.height : field === "rotation" ? toDegrees(entity.rotation) : null;
    case "POINT":
      return field === "positionX" ? entity.position.x : field === "positionY" ? entity.position.y : null;
    default:
      return null;
  }
}

/** 値を1つ書き換えた図形。その図形に無い項目・正しくない値・形が作れない値は、理由を返す */
export function withGeometryValue(entity: CadEntity, field: GeometryField, value: number): GeometryEdit {
  if (!Number.isFinite(value)) return fail("数値で入力してください");
  if (!geometryFieldsOf(entity).includes(field)) return fail("この図形には、その項目がありません");
  const isAngle = field === "startAngle" || field === "endAngle" || field === "rotation";
  // 度 → ラジアンの掛け算が、桁あふれして、有限でない角度にならないようにする
  if (isAngle && !Number.isFinite(toRadians(value))) return fail("角度が大きすぎます");
  const isCoordinate = field.endsWith("X") || field.endsWith("Y");
  if (isCoordinate && Math.abs(value) > MAX_COORDINATE) return fail(`座標は、絶対値 ${MAX_COORDINATE} 以下にしてください`);

  switch (entity.type) {
    case "LINE": {
      const next =
        field === "startX" ? { ...entity, start: { ...entity.start, x: value } }
        : field === "startY" ? { ...entity, start: { ...entity.start, y: value } }
        : field === "endX" ? { ...entity, end: { ...entity.end, x: value } }
        : { ...entity, end: { ...entity.end, y: value } };
      if (next.start.x === next.end.x && next.start.y === next.end.y) return fail("始点と終点が同じ位置になります");
      return { ok: true, entity: next };
    }
    case "CIRCLE":
    case "ARC": {
      if (field === "centerX") return { ok: true, entity: { ...entity, center: { ...entity.center, x: value } } };
      if (field === "centerY") return { ok: true, entity: { ...entity, center: { ...entity.center, y: value } } };
      if (field === "radius") return isUsableRadius(value) ? { ok: true, entity: { ...entity, radius: value } } : fail("半径が小さすぎる、または大きすぎます");
      if (entity.type !== "ARC") return fail("この図形には、その項目がありません");
      const startAngle = field === "startAngle" ? normalizeAngle(toRadians(value)) : entity.startAngle;
      const endAngle = field === "endAngle" ? normalizeAngle(toRadians(value)) : entity.endAngle;
      const span = normalizeAngle(endAngle - startAngle);
      if (span < 1e-9 || 2 * Math.PI - span < 1e-9) return fail("開始角と終了角が同じ(または全周)になります");
      return { ok: true, entity: { ...entity, startAngle, endAngle } };
    }
    case "TEXT": {
      if (field === "positionX") return { ok: true, entity: { ...entity, position: { ...entity.position, x: value } } };
      if (field === "positionY") return { ok: true, entity: { ...entity, position: { ...entity.position, y: value } } };
      if (field === "height") return value >= MIN_TEXT_HEIGHT && value <= MAX_TEXT_HEIGHT ? { ok: true, entity: { ...entity, height: value } } : fail("文字の高さが小さすぎる、または大きすぎます");
      return { ok: true, entity: { ...entity, rotation: toRadians(value) } };
    }
    case "POINT":
      return { ok: true, entity: { ...entity, position: field === "positionX" ? { ...entity.position, x: value } : { ...entity.position, y: value } } };
    default:
      return fail("この図形には、その項目がありません");
  }
}
