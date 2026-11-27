import type { CadLayer } from "../types/cad";
import "./LayerPanel.css";

type LayerPanelProps = {
  layers: CadLayer[];
  /** 新しい図形を描く先(現在のレイヤー)。無ければ null */
  currentLayerName: string | null;
  onToggleVisibility: (layerName: string) => void;
  onSelectCurrent: (layerName: string) => void;
  /** レイヤー管理パネルを開く(図面が編集できる状態のときだけ渡す。無ければ、ボタンを出さない) */
  onManage?: () => void;
  /** レイヤーのロックを切り替える(Phase 19。図面が編集できる状態のときだけ渡す。無ければ、鍵を出さない) */
  onToggleLock?: (layerName: string) => void;
};

export function LayerPanel({ layers, currentLayerName, onToggleVisibility, onSelectCurrent, onManage, onToggleLock }: LayerPanelProps) {
  return (
    <div className="layer-panel">
      <div className="layer-panel__title">
        Layers
        {onManage !== undefined && (
          <button type="button" className="layer-panel__manage" data-testid="layer-manage" title="レイヤーの作成・色・線種・線の太さ・名前・削除(LAYER)" onClick={onManage}>
            管理…
          </button>
        )}
      </div>
      {layers.length === 0 ? (
        <div className="layer-panel__empty">レイヤーがありません</div>
      ) : (
        <ul className="layer-panel__list">
          {layers.map((layer) => (
            <li key={layer.name} className="layer-panel__item">
              <input
                type="checkbox"
                checked={layer.visible}
                title="表示・非表示"
                onChange={() => onToggleVisibility(layer.name)}
              />
              <input
                type="radio"
                name="current-layer"
                className="layer-panel__current"
                checked={layer.name === currentLayerName}
                title="現在のレイヤー(新しい図形を描く先)にする"
                aria-label={`${layer.name} を現在のレイヤーにする`}
                onChange={() => onSelectCurrent(layer.name)}
              />
              <span className="layer-panel__color-chip" style={{ backgroundColor: layer.color }} />
              <span className={layer.locked === true ? "layer-panel__name layer-panel__name--locked" : "layer-panel__name"}>{layer.name}</span>
              {onToggleLock !== undefined && (
                <button
                  type="button"
                  className={layer.locked === true ? "layer-panel__lock layer-panel__lock--on" : "layer-panel__lock"}
                  data-testid={`layer-lock-toggle-${layer.name}`}
                  aria-pressed={layer.locked === true}
                  aria-label={`${layer.name} を${layer.locked === true ? "ロック解除" : "ロック"}する`}
                  title={layer.locked === true ? "ロック中(クリックで解除)。図形は選べず、編集できません" : "ロックする(図形を選べなく、編集できなくする)"}
                  onClick={() => onToggleLock(layer.name)}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
