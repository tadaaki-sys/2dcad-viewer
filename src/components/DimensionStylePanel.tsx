import { useState } from "react";
import type { KeyboardEvent } from "react";
import { DIMENSION_UNITS, MAX_DECIMALS } from "../core/dimension/dimensionFormat";
import {
  addDimensionStyle,
  currentDimensionStyle,
  deleteDimensionStyle,
  DIMENSION_LINETYPE_LABELS,
  DIMENSION_LINETYPES,
  renameDimensionStyle,
  setCurrentDimensionStyle,
  STANDARD_DIMENSION_STYLE_NAME,
  updateDimensionStyle,
} from "../core/dimension/dimensionStyle";
import type { DimensionLinetype, DimensionStyle, DimensionStyleResult, DimensionStyleTable } from "../core/dimension/dimensionStyle";
import "./DimensionStylePanel.css";

type DimensionStylePanelProps = {
  table: DimensionStyleTable;
  /** 図面にあるレイヤーの名前(寸法スタイルが、描くレイヤーを指定するときの候補) */
  layerNames: readonly string[];
  onChange: (table: DimensionStyleTable) => void;
  onClose: () => void;
};

const DECIMAL_CHOICES = Array.from({ length: MAX_DECIMALS + 1 }, (_, i) => i);

/**
 * 寸法スタイルの管理パネル(DIMSTYLE)。現在のスタイルの選択・値の編集・新規作成・名前の変更・削除。
 * 寸法は、描いたときのスタイルの値を持つので、ここで値を変えても、すでに描いた寸法は変わらない。
 * 値の確認・操作は core/dimension/dimensionStyle.ts(ここは、表示と入力だけ)。
 */
export function DimensionStylePanel({ table, layerNames, onChange, onClose }: DimensionStylePanelProps) {
  const style = currentDimensionStyle(table);
  const [error, setError] = useState<string | null>(null);

  function apply(result: DimensionStyleResult): boolean {
    if (!result.ok) {
      setError(result.message);
      return false;
    }
    setError(null);
    onChange(result.table);
    return true;
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    // 日本語の入力(IME)の変換中の Esc は、変換の取り消し。パネルは閉じない
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
    }
  }

  return (
    <div className="dimension-style-panel" role="dialog" aria-label="寸法スタイル" data-testid="dimension-style-panel" onKeyDown={handleKeyDown}>
      <div className="dimension-style-panel__title">寸法スタイル</div>
      <label className="dimension-style-panel__row">
        <span>現在のスタイル</span>
        <select data-testid="dimension-style-select" value={style.name} onChange={(event) => apply(setCurrentDimensionStyle(table, event.target.value))}>
          {table.styles.map((s) => (
            <option key={s.name} value={s.name}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      {/* スタイルを切り替えたとき・値が変わったときは、入力欄を作り直す(古い値を残さない) */}
      <StyleFields key={JSON.stringify(style)} table={table} style={style} layerNames={layerNames} apply={apply} setError={setError} />
      <StyleManagement key={`${table.current}|${table.styles.length}`} table={table} style={style} apply={apply} />
      {error !== null && (
        <div className="dimension-style-panel__error" role="alert" data-testid="dimension-style-error">
          {error}
        </div>
      )}
      <div className="dimension-style-panel__note">描いた寸法は、描いたときの値を持ちます。スタイルを変えても、すでに描いた寸法は変わりません。</div>
      <div className="dimension-style-panel__actions">
        <button type="button" data-testid="dimension-style-close" onClick={onClose}>
          閉じる
        </button>
      </div>
    </div>
  );
}

type FieldsProps = {
  table: DimensionStyleTable;
  style: DimensionStyle;
  layerNames: readonly string[];
  apply: (result: DimensionStyleResult) => boolean;
  setError: (message: string | null) => void;
};

type NumberKey = "textHeight" | "arrowSize" | "extensionOffset";

/** 現在のスタイルの値の編集(数値は、Enter か、欄を離れたときに確定。選択肢・チェックは、すぐ反映) */
function StyleFields({ table, style, layerNames, apply, setError }: FieldsProps) {
  const [textHeight, setTextHeight] = useState(String(style.textHeight));
  const [arrowSize, setArrowSize] = useState(String(style.arrowSize));
  const [extensionOffset, setExtensionOffset] = useState(String(style.extensionOffset));

  function commitNumber(text: string, key: NumberKey, label: string): void {
    const value = Number(text);
    if (text.trim() === "" || !Number.isFinite(value)) {
      setError(`${label}は、数値で入力してください`);
      return;
    }
    if (value !== style[key]) apply(updateDimensionStyle(table, style.name, { [key]: value }));
  }

  const enterToBlur = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter" && !event.nativeEvent.isComposing && event.keyCode !== 229) event.currentTarget.blur();
  };

  const numberRow = (label: string, testId: string, value: string, set: (text: string) => void, key: NumberKey, name: string) => (
    <label className="dimension-style-panel__row">
      <span>{label}</span>
      <input
        type="text"
        inputMode="decimal"
        className="dimension-style-panel__input"
        data-testid={testId}
        value={value}
        onChange={(event) => set(event.target.value)}
        onBlur={() => commitNumber(value, key, name)}
        onKeyDown={enterToBlur}
      />
    </label>
  );

  // スタイルが指定しているレイヤーが、図面に無いときも、選択肢に残す(指定が消えたことが分かるように)
  const layerChoices = style.layer !== null && !layerNames.includes(style.layer) ? [...layerNames, style.layer] : layerNames;

  return (
    <>
      {numberRow("文字の高さ(mm)", "dimension-style-text-height", textHeight, setTextHeight, "textHeight", "文字の高さ")}
      {numberRow("矢印の大きさ(mm)", "dimension-style-arrow-size", arrowSize, setArrowSize, "arrowSize", "矢印の大きさ")}
      {numberRow("補助線の間隔(mm)", "dimension-style-extension-offset", extensionOffset, setExtensionOffset, "extensionOffset", "補助線の間隔")}
      <label className="dimension-style-panel__row">
        <span>小数桁(長さ)</span>
        <select data-testid="dimension-style-decimals" value={style.decimals} onChange={(event) => apply(updateDimensionStyle(table, style.name, { decimals: Number(event.target.value) }))}>
          {DECIMAL_CHOICES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <label className="dimension-style-panel__row">
        <span>小数桁(角度)</span>
        <select data-testid="dimension-style-angle-decimals" value={style.angleDecimals} onChange={(event) => apply(updateDimensionStyle(table, style.name, { angleDecimals: Number(event.target.value) }))}>
          {DECIMAL_CHOICES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <label className="dimension-style-panel__row">
        <span>単位</span>
        <select data-testid="dimension-style-unit" value={style.unit} onChange={(event) => apply(updateDimensionStyle(table, style.name, { unit: event.target.value as DimensionStyle["unit"] }))}>
          {DIMENSION_UNITS.map((unit) => (
            <option key={unit} value={unit}>
              {unit}
            </option>
          ))}
        </select>
      </label>
      <label className="dimension-style-panel__row">
        <span>数値に単位を付ける</span>
        <input type="checkbox" data-testid="dimension-style-show-unit" checked={style.showUnit} onChange={(event) => apply(updateDimensionStyle(table, style.name, { showUnit: event.target.checked }))} />
      </label>
      <label className="dimension-style-panel__row">
        <span>色はレイヤーに合わせる</span>
        <input
          type="checkbox"
          data-testid="dimension-style-color-auto"
          checked={style.color === null}
          onChange={(event) => apply(updateDimensionStyle(table, style.name, { color: event.target.checked ? null : "#ffffff" }))}
        />
      </label>
      <label className="dimension-style-panel__row">
        <span>色</span>
        <input
          type="color"
          data-testid="dimension-style-color"
          disabled={style.color === null}
          value={style.color ?? "#ffffff"}
          onChange={(event) => apply(updateDimensionStyle(table, style.name, { color: event.target.value }))}
        />
      </label>
      <label className="dimension-style-panel__row">
        <span>レイヤー</span>
        <select
          data-testid="dimension-style-layer"
          value={style.layer ?? ""}
          onChange={(event) => apply(updateDimensionStyle(table, style.name, { layer: event.target.value === "" ? null : event.target.value }))}
        >
          <option value="">現在のレイヤー</option>
          {layerChoices.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label className="dimension-style-panel__row">
        <span>線種</span>
        <select
          data-testid="dimension-style-linetype"
          value={style.linetype}
          onChange={(event) => apply(updateDimensionStyle(table, style.name, { linetype: event.target.value as DimensionLinetype }))}
        >
          {DIMENSION_LINETYPES.map((linetype) => (
            <option key={linetype} value={linetype}>
              {DIMENSION_LINETYPE_LABELS[linetype]}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

/** スタイルの新規作成(現在の値から)・名前の変更・削除 */
function StyleManagement({ table, style, apply }: { table: DimensionStyleTable; style: DimensionStyle; apply: (result: DimensionStyleResult) => boolean }) {
  const [name, setName] = useState("");
  const isStandard = style.name === STANDARD_DIMENSION_STYLE_NAME;
  return (
    <div className="dimension-style-panel__manage">
      <input
        type="text"
        className="dimension-style-panel__input dimension-style-panel__input--wide"
        data-testid="dimension-style-name"
        placeholder="スタイルの名前"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <div className="dimension-style-panel__buttons">
        <button type="button" data-testid="dimension-style-new" onClick={() => apply(addDimensionStyle(table, { ...style, name: name.trim() }))}>
          新規(現在の値から)
        </button>
        <button type="button" data-testid="dimension-style-rename" disabled={isStandard} onClick={() => apply(renameDimensionStyle(table, style.name, name.trim()))}>
          名前を変更
        </button>
        <button type="button" data-testid="dimension-style-delete" disabled={isStandard} onClick={() => apply(deleteDimensionStyle(table, style.name))}>
          削除
        </button>
      </div>
    </div>
  );
}
