import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { EditOutcome } from "../app/document/editing";
import type { LayerPatch } from "../app/document/layering";
import type { LayerPanelTab } from "../app/commands/types";
import { CONTINUOUS, lineTypeKeyOf } from "../core/style/lineTypes";
import { STANDARD_LINE_WEIGHTS, lineWeightLabel, lineWeightToScreenWidthPx } from "../core/style/lineWeight";
import type { CadLayer, CadLineType } from "../types/cad";
import "./LayerManagerPanel.css";

type LayerManagerPanelProps = {
  layers: readonly CadLayer[];
  lineTypes: readonly CadLineType[];
  ltScale: number;
  currentLayerName: string | null;
  /** いま選択している図形の数(「選択図形をこのレイヤーへ」の有効・無効) */
  selectedCount: number;
  tab: LayerPanelTab;
  onTabChange: (tab: LayerPanelTab) => void;
  onCreate: (input: { name: string; color: string }) => EditOutcome;
  onEdit: (name: string, patch: LayerPatch) => EditOutcome;
  onRename: (from: string, to: string) => EditOutcome;
  onDelete: (name: string) => EditOutcome;
  onMoveSelected: (name: string) => EditOutcome;
  onSetLtScale: (value: number) => EditOutcome;
  /** レイヤーのロックの切り替え(Phase 19) */
  onSetLocked: (name: string, locked: boolean) => EditOutcome;
  onClose: () => void;
};

const TABS: ReadonlyArray<[LayerPanelTab, string]> = [
  ["layers", "レイヤー"],
  ["linetypes", "線種"],
  ["lineweights", "線の太さ"],
];

const DEFAULT_NEW_COLOR = "#ffffff";

/**
 * レイヤー・線種・線の太さの管理パネル(LAYER・LINETYPE・LINEWEIGHT)。表示と入力だけ。値の確認と図面への適用は
 * core/layer/layerRules.ts と app/document/layering.ts(Undo は、レイヤーの変更ごとに1段階)。
 */
export function LayerManagerPanel(props: LayerManagerPanelProps) {
  const { tab, onTabChange, onClose } = props;
  const [result, setResult] = useState<EditOutcome | null>(null);

  const run = (outcome: EditOutcome): boolean => {
    setResult(outcome);
    return outcome.ok;
  };

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    // 日本語の入力(IME)の変換中の Esc は、変換の取り消し。パネルは閉じない
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
    }
  }

  return (
    <div className="layer-manager" role="dialog" aria-label="レイヤー管理" data-testid="layer-manager" onKeyDown={handleKeyDown}>
      <div className="layer-manager__tabs" role="tablist">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} data-testid={`layer-tab-${id}`} className={tab === id ? "layer-manager__tab layer-manager__tab--active" : "layer-manager__tab"} onClick={() => onTabChange(id)}>
            {label}
          </button>
        ))}
      </div>
      {tab === "layers" && <LayersTab {...props} run={run} />}
      {tab === "linetypes" && <LineTypesTab {...props} run={run} />}
      {tab === "lineweights" && <LineWeightsTab layers={props.layers} />}
      {result !== null && (
        <div className={result.ok ? "layer-manager__result" : "layer-manager__result layer-manager__result--error"} role={result.ok ? "status" : "alert"} data-testid="layer-manager-result">
          {result.message}
        </div>
      )}
      <div className="layer-manager__actions">
        <button type="button" data-testid="layer-manager-close" onClick={onClose}>
          閉じる
        </button>
      </div>
    </div>
  );
}

type TabProps = LayerManagerPanelProps & { run: (outcome: EditOutcome) => boolean };

/** 色の入力。選び終わったとき(ブラウザの change)に1回だけ反映する(選んでいる途中の色ごとに、Undo の段階を作らない) */
function ColorCell({ color, testId, label, onCommit }: { color: string; testId: string; label: string; onCommit: (color: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const commit = useRef(onCommit);
  // 最新の反映先を、描画のあとに覚える(change のたびに、リスナーを付け直さずに済む)
  useEffect(() => {
    commit.current = onCommit;
  });
  useEffect(() => {
    const input = ref.current;
    if (input === null) return;
    const handler = () => commit.current(input.value);
    input.addEventListener("change", handler);
    return () => input.removeEventListener("change", handler);
    // key={color} で、色が変わるたびに、input が作り直される。新しい要素にも、リスナーを付け直す
  }, [color]);
  // key で、反映後の色に作り直す(選んだ色が拒否されたとき、元の色に戻す)
  return <input key={color} ref={ref} type="color" className="layer-manager__color" data-testid={testId} aria-label={label} defaultValue={color} />;
}

function LayersTab({ layers, lineTypes, currentLayerName, selectedCount, onCreate, onEdit, onRename, onDelete, onMoveSelected, onSetLocked, run }: TabProps) {
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<{ from: string; text: string } | null>(null);
  const enterToSubmit = (action: () => void) => (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && !event.nativeEvent.isComposing && event.keyCode !== 229) action();
  };
  const create = () => {
    if (run(onCreate({ name: newName, color: DEFAULT_NEW_COLOR }))) setNewName("");
  };

  return (
    <div>
      <div className="layer-manager__new">
        <input type="text" className="layer-manager__input" data-testid="layer-new-name" placeholder="新しいレイヤー名" value={newName} onChange={(event) => setNewName(event.target.value)} onKeyDown={enterToSubmit(create)} />
        <button type="button" data-testid="layer-new" onClick={create}>
          新規
        </button>
      </div>
      <div className="layer-manager__list">
        {layers.map((layer) => (
          <div key={layer.name} className="layer-manager__row" data-testid={`layer-row-${layer.name}`}>
            <ColorCell color={layer.color} testId={`layer-color-${layer.name}`} label={`${layer.name} の色`} onCommit={(color) => run(onEdit(layer.name, { color }))} />
            {renaming?.from === layer.name ? (
              <input
                type="text"
                autoFocus
                className="layer-manager__input layer-manager__name"
                data-testid={`layer-rename-input-${layer.name}`}
                value={renaming.text}
                onChange={(event) => setRenaming({ from: layer.name, text: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.stopPropagation();
                    setRenaming(null);
                  } else enterToSubmit(() => run(onRename(layer.name, renaming.text)) && setRenaming(null))(event);
                }}
              />
            ) : (
              <span className="layer-manager__name" title={layer.name}>
                {layer.name}
                {layer.name === currentLayerName ? " ★" : ""}
              </span>
            )}
            <select aria-label={`${layer.name} の線種`} data-testid={`layer-linetype-${layer.name}`} value={layer.lineType === undefined ? CONTINUOUS : (lineTypes.find((t) => lineTypeKeyOf(t.name) === lineTypeKeyOf(layer.lineType!))?.name ?? layer.lineType)} onChange={(event) => run(onEdit(layer.name, { lineType: event.target.value }))}>
              {lineTypes.map((lineType) => (
                <option key={lineType.name} value={lineType.name}>
                  {lineType.name}
                </option>
              ))}
              {layer.lineType !== undefined && !lineTypes.some((t) => lineTypeKeyOf(t.name) === lineTypeKeyOf(layer.lineType!)) && <option value={layer.lineType}>{layer.lineType}(未定義)</option>}
            </select>
            <select aria-label={`${layer.name} の線の太さ`} data-testid={`layer-weight-${layer.name}`} value={layer.lineWeight === undefined ? "" : String(layer.lineWeight)} onChange={(event) => run(onEdit(layer.name, { lineWeight: event.target.value === "" ? null : Number(event.target.value) }))}>
              <option value="">既定</option>
              {STANDARD_LINE_WEIGHTS.map((weight) => (
                <option key={weight} value={weight}>
                  {lineWeightLabel(weight)}
                </option>
              ))}
              {layer.lineWeight !== undefined && !STANDARD_LINE_WEIGHTS.includes(layer.lineWeight) && <option value={layer.lineWeight}>{lineWeightLabel(layer.lineWeight)}(標準外)</option>}
            </select>
            <label className="layer-manager__lock" title="ロック(図形を選べず、編集できない。薄く表示し、スナップはできる)">
              <input type="checkbox" data-testid={`layer-lock-${layer.name}`} checked={layer.locked === true} onChange={(event) => run(onSetLocked(layer.name, event.target.checked))} />
              鍵
            </label>
            <button type="button" title="名前を変える" data-testid={`layer-rename-${layer.name}`} onClick={() => setRenaming(renaming?.from === layer.name ? null : { from: layer.name, text: layer.name })}>
              名前
            </button>
            <button type="button" title="選択中の図形を、このレイヤーへ移す" data-testid={`layer-move-${layer.name}`} disabled={selectedCount === 0} onClick={() => run(onMoveSelected(layer.name))}>
              移動
            </button>
            <button type="button" title="このレイヤーを削除する" data-testid={`layer-delete-${layer.name}`} onClick={() => run(onDelete(layer.name))}>
              削除
            </button>
          </div>
        ))}
      </div>
      <div className="layer-manager__note">★ は現在のレイヤー(左の一覧で切り替えます)。色・線種・線の太さを変えると、そのレイヤーに従う図形(ByLayer)も同時に変わります。「移動」は、選択中の図形({selectedCount} 個)をそのレイヤーへ移します。</div>
    </div>
  );
}

/** 線種の見本の、破線の並び(模様を、見やすい長さ[48]に縮める。DXF の要素は、正=線・負=空き・0=点) */
function previewDashArray(elements: readonly number[]): string | undefined {
  const period = elements.reduce((sum, value) => sum + Math.abs(value), 0);
  if (!(period > 0)) return undefined;
  const pattern: number[] = [];
  for (const value of elements) {
    const length = ((value === 0 ? 0.01 : Math.abs(value)) / period) * 48;
    const wantsDash = pattern.length % 2 === 0;
    if ((value >= 0) === wantsDash) pattern.push(length);
    else if (pattern.length > 0) pattern[pattern.length - 1] += length;
    else pattern.push(0, length);
  }
  if (pattern.length % 2 === 1) pattern.push(0);
  return pattern.map((value) => value.toFixed(2)).join(" ");
}

function LineTypePreview({ elements }: { elements: readonly number[] }) {
  return (
    <svg width="120" height="8" aria-hidden="true" className="layer-manager__preview">
      <line x1="2" y1="4" x2="118" y2="4" stroke="currentColor" strokeWidth="2" strokeDasharray={previewDashArray(elements)} />
    </svg>
  );
}
function LineTypesTab({ layers, lineTypes, ltScale, onSetLtScale, run }: TabProps) {
  const [text, setText] = useState(String(ltScale));
  const commit = () => {
    const value = Number(text);
    if (text.trim() === "" || !Number.isFinite(value)) {
      run({ ok: false, message: "線種尺度は、数値で入力してください" });
      return;
    }
    if (value !== ltScale) run(onSetLtScale(value));
  };
  return (
    <div>
      <label className="layer-manager__scale">
        <span>全体の線種尺度(LTSCALE)</span>
        <input
          type="text"
          className="layer-manager__input layer-manager__input--short"
          data-testid="ltscale-input"
          // 反映後(Undo を含む)の値に作り直す
          key={ltScale}
          defaultValue={String(ltScale)}
          onChange={(event) => setText(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing && event.keyCode !== 229) commit();
          }}
        />
      </label>
      <div className="layer-manager__list">
        {lineTypes.map((lineType) => {
          const users = layers.filter((layer) => (layer.lineType === undefined ? CONTINUOUS : lineTypeKeyOf(layer.lineType)) === lineTypeKeyOf(lineType.name)).length;
          return (
            <div key={lineType.name} className="layer-manager__row" data-testid={`linetype-row-${lineType.name}`}>
              <span className="layer-manager__name">{lineType.name}</span>
              <LineTypePreview elements={lineType.elements} />
              <span className="layer-manager__count">{users > 0 ? `${users} レイヤー` : ""}</span>
            </div>
          );
        })}
      </div>
      <div className="layer-manager__note">破線の長さは、線種の定義 × 全体の線種尺度です。図面の大きさに合わせて尺度を変えてください(変えると、すべての破線の長さが変わります)。</div>
    </div>
  );
}

function LineWeightsTab({ layers }: { layers: readonly CadLayer[] }) {
  return (
    <div>
      <div className="layer-manager__list">
        {STANDARD_LINE_WEIGHTS.map((weight) => {
          const users = layers.filter((layer) => layer.lineWeight === weight).map((layer) => layer.name);
          return (
            <div key={weight} className="layer-manager__row" data-testid={`lineweight-row-${weight}`}>
              <span className="layer-manager__name">{lineWeightLabel(weight)}</span>
              <span className="layer-manager__weight" style={{ height: `${lineWeightToScreenWidthPx(weight)}px` }} />
              <span className="layer-manager__count">{users.join("・")}</span>
            </div>
          );
        })}
      </div>
      <div className="layer-manager__note">線の太さは、画面では拡大率に関係なく一定の幅(0.27mm 以下は細線)で表示します。レイヤーごとに、「レイヤー」の欄で選びます。</div>
    </div>
  );
}
