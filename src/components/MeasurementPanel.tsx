import type { Measurement } from "../types/cad";
import { computeMeasurementDistances } from "../cad-view/measurement/Measurement";
import { formatMm } from "../utils/format";
import "./MeasurementPanel.css";

type MeasurementPanelProps = {
  measurement: Measurement | null;
};

export function MeasurementPanel({ measurement }: MeasurementPanelProps) {
  const distances = measurement ? computeMeasurementDistances(measurement.pointA, measurement.pointB) : null;

  return (
    <div className="measurement-panel">
      <div className="measurement-panel__title">Measurements</div>
      {distances === null ? (
        <div className="measurement-panel__empty">測定結果なし</div>
      ) : (
        <div className="measurement-panel__rows">
          <div className="measurement-panel__row">
            <span className="measurement-panel__row-label">Horizontal</span>
            <span className="measurement-panel__row-value">{formatMm(distances.horizontal)}</span>
          </div>
          <div className="measurement-panel__row">
            <span className="measurement-panel__row-label">Vertical</span>
            <span className="measurement-panel__row-value">{formatMm(distances.vertical)}</span>
          </div>
          <div className="measurement-panel__row">
            <span className="measurement-panel__row-label">Direct</span>
            <span className="measurement-panel__row-value">{formatMm(distances.direct)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
