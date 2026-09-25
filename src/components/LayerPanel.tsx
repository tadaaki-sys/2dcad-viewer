import type { CadLayer } from "../types/cad";
import "./LayerPanel.css";

type LayerPanelProps = {
  layers: CadLayer[];
  onToggleVisibility: (layerName: string) => void;
};

export function LayerPanel({ layers, onToggleVisibility }: LayerPanelProps) {
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
                onChange={() => onToggleVisibility(layer.name)}
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
