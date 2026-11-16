// ダイナミック入力(カーソル付近の X・Y・長さ・角度の表示と、数値の入力)の計算。画面にも図面データにも依存しない純粋な処理。
//
// 点を待っている段階の種類(DynamicMode)で、入力できる項目が決まる。
//   absolute  基準点が無い(1点目): X・Y を入力できる
//   polar     基準点がある(2点目以降): 長さ・角度を入力できる(基準点からの極座標)
//   distance  数値だけを待つ段階(円の半径・直径): 長さだけ
//   angle     数値だけの入力が「角度」の意味の段階(ROTATE の回転角): 角度だけ
// 打っていない項目は、カーソルの値を使う(例: 長さだけ打って Enter なら、角度はカーソルの向き)。
// 角度は「度」で、+X方向を0、反時計回り。長さは mm。内部の値は丸めない(表示のときだけ小数1桁)。
import type { Point2D } from "../../types/cad";
import { parseCoordinateInput } from "./coordinateInput";
import type { ActiveCommand } from "./session";

export type DynamicMode = "absolute" | "polar" | "distance" | "angle";
export type DynamicField = "x" | "y" | "length" | "angle";

/** 打ち終えた(Tab で確定した)項目の値。長さは mm、角度は度 */
export type DynamicValues = Partial<Record<DynamicField, number>>;

const FIELDS_OF_MODE: Record<DynamicMode, readonly DynamicField[]> = {
  absolute: ["x", "y"],
  polar: ["length", "angle"],
  distance: ["length"],
  angle: ["angle"],
};

/** 実行中の段階が、ダイナミック入力の対象か。対象でなければ null */
export function dynamicModeOf(active: ActiveCommand | null): DynamicMode | null {
  if (active === null) return null;
  if (active.expect === "distance") return "distance";
  if (active.expect !== "point") return null;
  // 点の指示でも数値でも答えられる段階(円の半径)は、長さだけ
  if (active.acceptsDistance) {
    // 単なる数値(倍率・参照の長さ)の段階は、カーソルの位置と関係が無いので、ダイナミック入力は出さない(コマンドラインで入力する)
    if (active.numberMeaning === "plain") return null;
    return active.numberMeaning === "angle" ? "angle" : "distance";
  }
  return active.basePoint === null ? "absolute" : "polar";
}

/** そのモードで入力できる項目(Tab で、この順に切り替わる) */
export function inputFieldsOf(mode: DynamicMode): readonly DynamicField[] {
  return FIELDS_OF_MODE[mode];
}

/** 次(または前)の項目。最後の項目の次は、最初に戻る */
export function nextField(mode: DynamicMode, current: DynamicField, backwards: boolean): DynamicField {
  const fields = FIELDS_OF_MODE[mode];
  const index = fields.indexOf(current);
  const base = index < 0 ? 0 : index;
  return fields[(base + (backwards ? fields.length - 1 : 1)) % fields.length];
}

export const FIELD_LABELS: Record<DynamicField, string> = { x: "X", y: "Y", length: "長さ", angle: "角度" };

/** 角度(度)を 0 以上 360 未満にそろえる */
export function normalizeDegrees(degrees: number): number {
  const result = degrees % 360;
  const positive = result < 0 ? result + 360 : result;
  return positive >= 360 ? 0 : positive;
}

export type FieldParseResult = { ok: true; value: number } | { ok: false; error: string };

/** 1つの項目に打った文字を読み取る(数値だけ。全角・「−」も受け付ける。長さは0以上、角度は360で割った余りにそろえる) */
export function parseFieldText(field: DynamicField, text: string): FieldParseResult {
  const parsed = parseCoordinateInput(text, null);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  if (parsed.kind !== "distance") return { ok: false, error: `${FIELD_LABELS[field]}は数値で入力してください` };
  const value = parsed.value;
  if (field === "length" && value < 0) return { ok: false, error: "長さは0以上の数値で入力してください" };
  if (field === "angle") return { ok: true, value: normalizeDegrees(value) };
  return { ok: true, value };
}

/** カーソルの位置から見た、各項目の値(表示用)。基準点が無いときは、長さ・角度は null */
export type DynamicReadout = { x: number; y: number; length: number | null; angle: number | null };

export function readoutAt(cursor: Point2D, base: Point2D | null): DynamicReadout {
  if (base === null) return { x: cursor.x, y: cursor.y, length: null, angle: null };
  const dx = cursor.x - base.x;
  const dy = cursor.y - base.y;
  const length = Math.hypot(dx, dy);
  // 長さが0のときは、向きが決まらない(0度として表示する)
  const angle = length === 0 ? 0 : normalizeDegrees((Math.atan2(dy, dx) * 180) / Math.PI);
  return { x: cursor.x, y: cursor.y, length, angle };
}

export type DynamicResolveResult = { ok: true; point: Point2D } | { ok: false; error: string };

/**
 * 打った値から、指示する点を求める。打っていない項目は、カーソルの値を使う。
 * @param cursor いまのカーソルの位置(吸着後)。無いときは、打っていない項目を補えないので、エラー
 */
export function resolveDynamicPoint(
  mode: DynamicMode,
  base: Point2D | null,
  cursor: Point2D | null,
  values: DynamicValues,
): DynamicResolveResult {
  if (mode === "absolute") {
    if (cursor === null && (values.x === undefined || values.y === undefined)) return { ok: false, error: "カーソルを図面の上に置くか、X・Y の両方を入力してください" };
    const x = values.x ?? cursor!.x;
    const y = values.y ?? cursor!.y;
    return finite({ x, y });
  }
  if (base === null) return { ok: false, error: "基準になる点がありません" };
  if (mode === "angle") {
    // 角度だけを打つ段階: 角度は、打った値(無ければカーソルの向き)。長さは、カーソルまでの距離(カーソルが無い・同じ点なら 1)
    if (cursor === null && values.angle === undefined) {
      return { ok: false, error: "カーソルを図面の上に置くか、角度を入力してください" };
    }
    const readout = cursor === null ? null : readoutAt(cursor, base);
    const degrees = values.angle ?? readout!.angle!;
    const length = readout !== null && readout.length! > 0 ? readout.length! : 1;
    const radians = (degrees * Math.PI) / 180;
    return finite({ x: base.x + length * Math.cos(radians), y: base.y + length * Math.sin(radians) });
  }
  // polar / distance: 基準点からの極座標。distance は、角度をカーソルの向きにする
  if (cursor === null && (values.length === undefined || (mode === "polar" && values.angle === undefined))) {
    return { ok: false, error: "カーソルを図面の上に置くか、長さと角度の両方を入力してください" };
  }
  const cursorReadout = cursor === null ? null : readoutAt(cursor, base);
  const length = values.length ?? cursorReadout!.length!;
  const degrees = mode === "polar" ? (values.angle ?? cursorReadout!.angle!) : (cursorReadout?.angle ?? 0);
  const radians = (degrees * Math.PI) / 180;
  return finite({ x: base.x + length * Math.cos(radians), y: base.y + length * Math.sin(radians) });
}

/**
 * カーソルの点に、打っている値(いま入力中の項目の文字)と、確定した値を当てはめた、実効の点。
 * ゴム紐・クリックでの指示・カーソル付近の表示は、すべてこの点を使う(見えているものと、確定するものを一致させる)。
 * 何も打っていない、読み取れない、点にできないときは、カーソルの点のまま(カーソルが無ければ null)。
 */
export function applyTypedValues(
  mode: DynamicMode | null,
  base: Point2D | null,
  cursor: Point2D | null,
  locked: DynamicValues,
  field: DynamicField,
  typedText: string,
): Point2D | null {
  if (mode === null) return cursor;
  const values: DynamicValues = { ...locked };
  if (typedText.trim() !== "") {
    const parsed = parseFieldText(field, typedText);
    if (parsed.ok) values[field] = parsed.value;
  }
  if (Object.keys(values).length === 0) return cursor;
  const resolved = resolveDynamicPoint(mode, base, cursor, values);
  return resolved.ok ? resolved.point : cursor;
}

function finite(point: Point2D): DynamicResolveResult {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return { ok: false, error: "値が大きすぎて計算できません" };
  return { ok: true, point };
}

/** 表示用の数値(小数1桁。「-0.0」は「0.0」にする)。内部の値は丸めない */
export function formatDynamicValue(field: DynamicField, value: number): string {
  const text = value.toFixed(1);
  const clean = text === "-0.0" ? "0.0" : text;
  return field === "angle" ? `${clean}°` : clean;
}
