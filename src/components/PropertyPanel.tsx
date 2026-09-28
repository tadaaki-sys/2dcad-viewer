import type { CadEntity } from "../types/cad";
import { polylineLength, distance, normalizeArcSpan } from "../utils/geometry";
import { formatMm } from "../utils/format";
import "./PropertyPanel.css";

type PropertyPanelProps = {
  entities: CadEntity[];
};

type Row = { label: string; value: string };

function radiansToDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

function entityLength(entity: CadEntity): number {
  if (entity.type === "LINE") return distance(entity.start, entity.end);
  if (entity.type === "CIRCLE") return 2 * Math.PI * entity.radius;
  if (entity.type === "ARC") return entity.radius * normalizeArcSpan(entity.startAngle, entity.endAngle);
  if (entity.type === "TEXT") return 0;
  return polylineLength(entity.vertices, entity.closed);
}

function buildSingleEntityRows(entity: CadEntity): Row[] {
  const rows: Row[] = [
    { label: "Entity Type", value: entity.type },
    { label: "Layer", value: entity.layer },
  ];

  if (entity.type === "LINE") {
    rows.push(
      { label: "Start X/Y", value: `${formatMm(entity.start.x)}, ${formatMm(entity.start.y)}` },
      { label: "End X/Y", value: `${formatMm(entity.end.x)}, ${formatMm(entity.end.y)}` },
      { label: "Length", value: formatMm(entityLength(entity)) },
    );
  } else if (entity.type === "CIRCLE") {
    rows.push(
      { label: "Center X/Y", value: `${formatMm(entity.center.x)}, ${formatMm(entity.center.y)}` },
      { label: "Radius", value: formatMm(entity.radius) },
      { label: "Circumference", value: formatMm(entityLength(entity)) },
    );
  } else if (entity.type === "ARC") {
    rows.push(
      { label: "Center X/Y", value: `${formatMm(entity.center.x)}, ${formatMm(entity.center.y)}` },
      { label: "Radius", value: formatMm(entity.radius) },
      { label: "Start/End Angle", value: `${radiansToDegrees(entity.startAngle).toFixed(1)}°, ${radiansToDegrees(entity.endAngle).toFixed(1)}°` },
      { label: "Arc Length", value: formatMm(entityLength(entity)) },
    );
  } else if (entity.type === "TEXT") {
    rows.push(
      { label: "Position X/Y", value: `${formatMm(entity.position.x)}, ${formatMm(entity.position.y)}` },
      { label: "Text Height", value: formatMm(entity.height) },
      { label: "Content", value: entity.text.replace(/\n/g, " / ") },
    );
  } else {
    rows.push(
      { label: "Vertex Count", value: String(entity.vertices.length) },
      { label: "Total Length", value: formatMm(entityLength(entity)) },
    );
  }

  return rows;
}

function buildLayerBreakdown(entities: CadEntity[]): Row[] {
  const counts = new Map<string, number>();
  for (const entity of entities) {
    counts.set(entity.layer, (counts.get(entity.layer) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([layer, count]) => ({ label: layer, value: String(count) }));
}

function Rows({ rows }: { rows: Row[] }) {
  return (
    <div className="property-panel__rows">
      {rows.map((row) => (
        <div key={row.label} className="property-panel__row">
          <span className="property-panel__row-label">{row.label}</span>
          <span className="property-panel__row-value">{row.value}</span>
        </div>
      ))}
    </div>
  );
}

export function PropertyPanel({ entities }: PropertyPanelProps) {
  return (
    <div className="property-panel">
      <div className="property-panel__title">Properties</div>
      {entities.length === 0 && <div className="property-panel__empty">選択なし</div>}
      {entities.length === 1 && <Rows rows={buildSingleEntityRows(entities[0])} />}
      {entities.length > 1 && (
        <>
          <div className="property-panel__summary-count">{entities.length} entities selected</div>
          <Rows
            rows={[
              { label: "Total Length", value: formatMm(entities.reduce((sum, e) => sum + entityLength(e), 0)) },
            ]}
          />
          <div className="property-panel__section-title">Layers</div>
          <Rows rows={buildLayerBreakdown(entities)} />
        </>
      )}
    </div>
  );
}
