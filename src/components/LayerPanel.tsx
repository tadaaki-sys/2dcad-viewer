import type { CadLayer } from "../types/cad";
import "./LayerPanel.css";

type LayerPanelProps = {
  layers: CadLayer[];
  /** 新しい図形を描く先(現在のレイヤー)。無ければ null */
  currentLayerName: string | null;
  onToggleVisibility: (layerName: string) => void;
  onSelectCurrent: (layerName: string) => void;
};

export function LayerPanel({ layers, currentLayerName, onToggleVisibility, onSelectCurrent }: LayerPanelProps) {
  return (
    <div className="layer-panel">
      <div className="layer-panel__title">Layers</div>
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
              <span className="layer-panel__name">{layer.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
