import { FIELD_LABELS, formatDynamicValue, inputFieldsOf, readoutAt } from "../core/commands";
import type { DynamicField, DynamicMode, DynamicValues } from "../core/commands";
import type { Point2D } from "../types/cad";
import "./DynamicInput.css";

type DynamicInputProps = {
  mode: DynamicMode;
  /** いまのカーソルの位置(図面上。吸着後)。図面の外にあるときは null */
  cursor: Point2D | null;
  /** カーソルの、キャンバスの左上からのピクセル位置 */
  screen: Point2D | null;
  /** 長さ・角度の基準の点。無ければ null(1点目) */
  base: Point2D | null;
  /** Tab で確定した値 */
  locked: DynamicValues;
  /** いま入力している項目 */
  field: DynamicField;
  /** コマンドラインに打っている途中の文字(いま入力している項目の値) */
  typedText: string;
  /** カーソルの値を、そのまま表示してよいか(数値だけを待つ段階では、カーソルの位置は答えにならないので、表示しない) */
  showCursorValues: boolean;
  /** 表示できる範囲の大きさ(はみ出さないよう、カーソルの近くから寄せる) */
  area: { width: number; height: number } | null;
};

const ROW_ORDER: readonly DynamicField[] = ["x", "y", "length", "angle"];
const OFFSET_PX = 18;
const WIDTH_PX = 150;
const ROW_HEIGHT_PX = 20;

/**
 * カーソル付近の、X・Y・長さ・角度の表示。入力はコマンドラインで受け、打っている途中の値をここに映す
 * (入力できる項目は枠で示す)。マウス操作は邪魔しない。
 */
export function DynamicInput({ mode, cursor, screen, base, locked, field, typedText, showCursorValues, area }: DynamicInputProps) {
  const editable = inputFieldsOf(mode);
  const typed = typedText.trim();
  // 入力も確定した値も無く、カーソルが図面の外にあるときは、出さない(隅に居座らないように)
  if (screen === null && typed === "" && Object.keys(locked).length === 0) return null;

  const readout = cursor !== null && showCursorValues ? readoutAt(cursor, base) : null;
  const rows = mode === "distance" ? (["length"] as const) : ROW_ORDER;

  const height = rows.length * ROW_HEIGHT_PX + 10;
  const anchor = screen ?? { x: 0, y: 0 };
  const left = Math.max(0, Math.min(anchor.x + OFFSET_PX, (area?.width ?? Infinity) - WIDTH_PX));
  const top = Math.max(0, Math.min(anchor.y + OFFSET_PX, (area?.height ?? Infinity) - height));

  return (
    <div className="dynamic-input" data-testid="dynamic-input" style={{ left, top, width: WIDTH_PX }}>
      {rows.map((name) => {
        const isEditable = editable.includes(name);
        const isActive = isEditable && name === field;
        let value: string;
        let state: "typing" | "locked" | "live";
        if (isActive && typed !== "") {
          value = typed;
          state = "typing";
        } else if (locked[name] !== undefined) {
          value = formatDynamicValue(name, locked[name]);
          state = "locked";
        } else {
          const live = readout === null ? null : readout[name];
          value = live === null ? "-" : formatDynamicValue(name, live);
          state = "live";
        }
        const className = [
          "dynamic-input__row",
          isEditable ? "dynamic-input__row--editable" : "dynamic-input__row--readonly",
          isActive ? "dynamic-input__row--active" : "",
          `dynamic-input__row--${state}`,
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <div key={name} className={className} data-testid={`dynamic-input-${name}`} data-state={state}>
            <span className="dynamic-input__label">{FIELD_LABELS[name]}</span>
            <span className="dynamic-input__value">{value}</span>
          </div>
        );
      })}
    </div>
  );
}
