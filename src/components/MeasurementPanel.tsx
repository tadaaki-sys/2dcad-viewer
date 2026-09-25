import type { Measurement } from "../types/cad";
import { computeMeasurementDistances } from "../cad-view/measurement/Measurement";
import { formatMm } from "../utils/format";
import "./MeasurementPanel.css";

type MeasurementPanelProps = {
  measurements: Measurement[];
  selectedMeasurementId: string | null;
  onSelectMeasurement: (measurementId: string) => void;
  onDeleteMeasurement: (measurementId: string) => void;
  onDeleteAllMeasurements: () => void;
};

export function MeasurementPanel({
  measurements,
  selectedMeasurementId,
  onSelectMeasurement,
  onDeleteMeasurement,
  onDeleteAllMeasurements,
}: MeasurementPanelProps) {
  return (
    <div className="measurement-panel">
      <div className="measurement-panel__header">
        <div className="measurement-panel__title">Measurements</div>
        {measurements.length > 0 && (
          <button type="button" className="measurement-panel__delete-all-button" onClick={onDeleteAllMeasurements}>
            すべて削除
          </button>
        )}
      </div>
      {measurements.length === 0 ? (
        <div className="measurement-panel__empty">測定結果なし</div>
      ) : (
        <div className="measurement-panel__list">
          {measurements.map((measurement, index) => {
            const distances = computeMeasurementDistances(measurement.pointA, measurement.pointB);
            const isSelected = measurement.id === selectedMeasurementId;
            return (
              <div
                key={measurement.id}
                className={`measurement-panel__item${isSelected ? " measurement-panel__item--selected" : ""}`}
                onClick={() => onSelectMeasurement(measurement.id)}
              >
                <div className="measurement-panel__item-values">
                  <span>#{index + 1} H: {formatMm(distances.horizontal)}</span>
                  <span>V: {formatMm(distances.vertical)}</span>
                  <span>D: {formatMm(distances.direct)}</span>
                </div>
                <button
                  type="button"
                  className="measurement-panel__item-delete"
                  title="この測定結果を削除"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDeleteMeasurement(measurement.id);
                  }}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
