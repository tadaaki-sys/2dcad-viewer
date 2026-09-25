import type { CadEntity } from "../types/cad";
import { polylineLength, distance } from "../utils/geometry";
import { formatMm } from "../utils/format";
import "./PropertyPanel.css";

type PropertyPanelProps = {
  entity: CadEntity | null;
};

type Row = { label: string; value: string };

function buildRows(entity: CadEntity): Row[] {
  const rows: Row[] = [
    { label: "Entity Type", value: entity.type },
    { label: "Layer", value: entity.layer },
  ];

  if (entity.type === "LINE") {
    rows.push(
      { label: "Start X/Y", value: `${formatMm(entity.start.x)}, ${formatMm(entity.start.y)}` },
      { label: "End X/Y", value: `${formatMm(entity.end.x)}, ${formatMm(entity.end.y)}` },
      { label: "Length", value: formatMm(distance(entity.start, entity.end)) },
    );
  } else {
    rows.push(
      { label: "Vertex Count", value: String(entity.vertices.length) },
      { label: "Total Length", value: formatMm(polylineLength(entity.vertices, entity.closed)) },
    );
  }

  return rows;
}

export function PropertyPanel({ entity }: PropertyPanelProps) {
  return (
    <div className="property-panel">
      <div className="property-panel__title">Properties</div>
      {entity === null ? (
        <div className="property-panel__empty">選択なし</div>
      ) : (
        <div className="property-panel__rows">
          {buildRows(entity).map((row) => (
            <div key={row.label} className="property-panel__row">
              <span className="property-panel__row-label">{row.label}</span>
              <span className="property-panel__row-value">{row.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
