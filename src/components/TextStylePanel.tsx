import { useState } from "react";
import type { KeyboardEvent } from "react";
import {
  addTextStyle,
  currentTextStyle,
  deleteTextStyle,
  FONT_SUGGESTIONS,
  renameTextStyle,
  setCurrentTextStyle,
  STANDARD_STYLE_NAME,
  updateTextStyle,
} from "../core/text/textStyle";
import type { TextStyle, TextStyleResult, TextStyleTable } from "../core/text/textStyle";
import "./TextStylePanel.css";

type TextStylePanelProps = {
  table: TextStyleTable;
  onChange: (table: TextStyleTable) => void;
  onClose: () => void;
};

const HORIZONTAL_LABELS: ReadonlyArray<[TextStyle["horizontalAlign"], string]> = [
  ["left", "左"],
  ["center", "中央"],
  ["right", "右"],
];
const VERTICAL_LABELS: ReadonlyArray<[TextStyle["verticalAlign"], string]> = [
  ["baseline", "基準線"],
  ["bottom", "下"],
  ["middle", "中央"],
  ["top", "上"],
];

/**
 * 文字スタイルの管理パネル(TEXTSTYLE)。現在のスタイルの選択・値の編集・新規作成・名前の変更・削除。
 * 文字は、描いたときのスタイルの値を持つので、ここで値を変えても、すでに描いた文字は変わらない。
 * 値の確認・操作は core/text/textStyle.ts(ここは、表示と入力だけ)。
 */
export function TextStylePanel({ table, onChange, onClose }: TextStylePanelProps) {
  const style = currentTextStyle(table);
  const [error, setError] = useState<string | null>(null);

  function apply(result: TextStyleResult): boolean {
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
    <div className="text-style-panel" role="dialog" aria-label="文字スタイル" data-testid="text-style-panel" onKeyDown={handleKeyDown}>
      <div className="text-style-panel__title">文字スタイル</div>
      <label className="text-style-panel__row">
        <span>現在のスタイル</span>
        <select data-testid="text-style-select" value={style.name} onChange={(event) => apply(setCurrentTextStyle(table, event.target.value))}>
          {table.styles.map((s) => (
            <option key={s.name} value={s.name}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      {/* スタイルを切り替えたとき・値が変わったときは、入力欄を作り直す(古い文字を残さない) */}
      <StyleFields key={JSON.stringify(style)} table={table} style={style} apply={apply} setError={setError} />
      <StyleManagement key={`${table.current}|${table.styles.length}`} table={table} style={style} apply={apply} />
      {error !== null && (
        <div className="text-style-panel__error" role="alert" data-testid="text-style-error">
          {error}
        </div>
      )}
      <div className="text-style-panel__note">描いた文字は、描いたときの値を持ちます。スタイルを変えても、すでに描いた文字は変わりません。</div>
      <div className="text-style-panel__actions">
        <button type="button" data-testid="text-style-close" onClick={onClose}>
          閉じる
        </button>
      </div>
    </div>
  );
}

type FieldsProps = {
  table: TextStyleTable;
  style: TextStyle;
  apply: (result: TextStyleResult) => boolean;
  setError: (message: string | null) => void;
};

/** 現在のスタイルの値の編集(フォント・高さ・幅係数は、Enter か、欄を離れたときに確定。斜体・配置は、すぐ反映) */
function StyleFields({ table, style, apply, setError }: FieldsProps) {
  const [font, setFont] = useState(style.fontFamily);
  const [height, setHeight] = useState(String(style.height));
  const [widthFactor, setWidthFactor] = useState(String(style.widthFactor));

  function commitNumber(text: string, key: "height" | "widthFactor", label: string): void {
    const value = Number(text);
    if (text.trim() === "" || !Number.isFinite(value)) {
      setError(`${label}は、数値で入力してください`);
      return;
    }
    if (value !== style[key]) apply(updateTextStyle(table, style.name, { [key]: value }));
  }

  function commitFont(): void {
    const value = font.trim();
    if (value !== style.fontFamily) apply(updateTextStyle(table, style.name, { fontFamily: value }));
  }

  const enterToBlur = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter" && !event.nativeEvent.isComposing && event.keyCode !== 229) event.currentTarget.blur();
  };

  return (
    <>
      <label className="text-style-panel__row">
        <span>フォント</span>
        <input
          type="text"
          list="text-style-fonts"
          className="text-style-panel__input text-style-panel__input--wide"
          data-testid="text-style-font"
          value={font}
          spellCheck={false}
          onChange={(event) => setFont(event.target.value)}
          onBlur={commitFont}
          onKeyDown={enterToBlur}
        />
        <datalist id="text-style-fonts">
          {FONT_SUGGESTIONS.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      </label>
      <label className="text-style-panel__row">
        <span>高さ(mm)</span>
        <input
          type="text"
          inputMode="decimal"
          className="text-style-panel__input"
          data-testid="text-style-height"
          value={height}
          onChange={(event) => setHeight(event.target.value)}
          onBlur={() => commitNumber(height, "height", "高さ")}
          onKeyDown={enterToBlur}
        />
      </label>
      <label className="text-style-panel__row">
        <span>幅係数</span>
        <input
          type="text"
          inputMode="decimal"
          className="text-style-panel__input"
          data-testid="text-style-width-factor"
          value={widthFactor}
          onChange={(event) => setWidthFactor(event.target.value)}
          onBlur={() => commitNumber(widthFactor, "widthFactor", "幅係数")}
          onKeyDown={enterToBlur}
        />
      </label>
      <label className="text-style-panel__row">
        <span>斜体</span>
        <input type="checkbox" data-testid="text-style-italic" checked={style.italic} onChange={(event) => apply(updateTextStyle(table, style.name, { italic: event.target.checked }))} />
      </label>
      <label className="text-style-panel__row">
        <span>水平の配置</span>
        <select data-testid="text-style-halign" value={style.horizontalAlign} onChange={(event) => apply(updateTextStyle(table, style.name, { horizontalAlign: event.target.value as TextStyle["horizontalAlign"] }))}>
          {HORIZONTAL_LABELS.map(([value, text]) => (
            <option key={value} value={value}>
              {text}
            </option>
          ))}
        </select>
      </label>
      <label className="text-style-panel__row">
        <span>垂直の配置</span>
        <select data-testid="text-style-valign" value={style.verticalAlign} onChange={(event) => apply(updateTextStyle(table, style.name, { verticalAlign: event.target.value as TextStyle["verticalAlign"] }))}>
          {VERTICAL_LABELS.map(([value, text]) => (
            <option key={value} value={value}>
              {text}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

/** スタイルの新規作成(現在の値から)・名前の変更・削除 */
function StyleManagement({ table, style, apply }: { table: TextStyleTable; style: TextStyle; apply: (result: TextStyleResult) => boolean }) {
  const [name, setName] = useState("");
  const isStandard = style.name === STANDARD_STYLE_NAME;
  return (
    <div className="text-style-panel__manage">
      <input
        type="text"
        className="text-style-panel__input text-style-panel__input--wide"
        data-testid="text-style-name"
        placeholder="スタイルの名前"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <div className="text-style-panel__buttons">
        <button type="button" data-testid="text-style-new" onClick={() => apply(addTextStyle(table, { ...style, name: name.trim() }))}>
          新規(現在の値から)
        </button>
        <button type="button" data-testid="text-style-rename" disabled={isStandard} onClick={() => apply(renameTextStyle(table, style.name, name.trim()))}>
          名前を変更
        </button>
        <button type="button" data-testid="text-style-delete" disabled={isStandard} onClick={() => apply(deleteTextStyle(table, style.name))}>
          削除
        </button>
      </div>
    </div>
  );
}