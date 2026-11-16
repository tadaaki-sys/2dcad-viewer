import { useState } from "react";
import type { KeyboardEvent } from "react";
import { DEFAULT_SNAP_SETTINGS, parseGridSpacing } from "../core/snap/snapSettings";
import type { ObjectSnapType, SnapSettings } from "../core/snap/snapSettings";
import { OBJECT_SNAP_TYPES, SNAP_TYPE_LABELS } from "../core/snap/snapTypes";
import { DEFAULT_TRACKING_SETTINGS, parseDistanceIncrement, POLAR_ANGLE_INCREMENTS } from "../core/tracking/trackingSettings";
import type { TrackingSettings } from "../core/tracking/trackingSettings";
import "./SnapSettingsPanel.css";

type SnapSettingsPanelProps = {
  settings: SnapSettings;
  onChange: (settings: SnapSettings) => void;
  /** トラッキングの設定(角度の刻み、間隔) */
  tracking: TrackingSettings;
  onChangeTracking: (settings: TrackingSettings) => void;
  onClose: () => void;
};

/**
 * Snap・トラッキングの詳細設定: Snap の種類ごとのオン・オフ、グリッドの間隔、極トラッキングの角度の刻み、トラッキング間隔
 * (OSNAP・SNAP・GRID・ORTHO・POLAR・OTRACK のオン・オフは、ステータスバーのボタン)
 */
export function SnapSettingsPanel({ settings, onChange, tracking, onChangeTracking, onClose }: SnapSettingsPanelProps) {
  const [spacingText, setSpacingText] = useState(String(settings.gridSpacing));
  const [spacingError, setSpacingError] = useState<string | null>(null);
  const [distanceText, setDistanceText] = useState(String(tracking.distanceIncrement));
  const [distanceError, setDistanceError] = useState<string | null>(null);

  function commitDistance(): void {
    const parsed = parseDistanceIncrement(distanceText);
    if (!parsed.ok) {
      setDistanceError(parsed.error);
      return;
    }
    setDistanceError(null);
    if (parsed.value !== tracking.distanceIncrement) onChangeTracking({ ...tracking, distanceIncrement: parsed.value });
  }

  function commitSpacing(): void {
    const parsed = parseGridSpacing(spacingText);
    if (!parsed.ok) {
      setSpacingError(parsed.error);
      return;
    }
    setSpacingError(null);
    if (parsed.value !== settings.gridSpacing) onChange({ ...settings, gridSpacing: parsed.value });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
    }
  }

  return (
    <div className="snap-settings" role="dialog" aria-label="Snap設定" data-testid="snap-settings-panel" onKeyDown={handleKeyDown}>
      <div className="snap-settings__title">Snap設定</div>
      <div className="snap-settings__group">
        {(OBJECT_SNAP_TYPES as readonly ObjectSnapType[]).map((type) => (
          <label key={type} className="snap-settings__row">
            <input
              type="checkbox"
              data-testid={`snap-type-${type}`}
              checked={settings.types[type]}
              onChange={(event) => onChange({ ...settings, types: { ...settings.types, [type]: event.target.checked } })}
            />
            <span>{SNAP_TYPE_LABELS[type]}</span>
          </label>
        ))}
      </div>
      <div className="snap-settings__title">グリッド</div>
      <label className="snap-settings__row snap-settings__row--spacing">
        <span>間隔(mm)</span>
        <input
          type="text"
          inputMode="decimal"
          className="snap-settings__input"
          data-testid="snap-grid-spacing"
          value={spacingText}
          onChange={(event) => setSpacingText(event.target.value)}
          onBlur={commitSpacing}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitSpacing();
            }
          }}
        />
      </label>
      {spacingError !== null && (
        <div className="snap-settings__error" data-testid="snap-grid-spacing-error" role="alert">
          {spacingError}
        </div>
      )}
      <div className="snap-settings__title">トラッキング</div>
      <label className="snap-settings__row snap-settings__row--spacing">
        <span>角度の刻み(度)</span>
        <select
          className="snap-settings__input"
          data-testid="tracking-angle-increment"
          value={tracking.polarAngleIncrement}
          onChange={(event) => onChangeTracking({ ...tracking, polarAngleIncrement: Number(event.target.value) })}
        >
          {POLAR_ANGLE_INCREMENTS.map((angle) => (
            <option key={angle} value={angle}>
              {angle}
            </option>
          ))}
        </select>
      </label>
      <label className="snap-settings__row snap-settings__row--spacing">
        <span>間隔(mm、0=なし)</span>
        <input
          type="text"
          inputMode="decimal"
          className="snap-settings__input"
          data-testid="tracking-distance-increment"
          value={distanceText}
          onChange={(event) => setDistanceText(event.target.value)}
          onBlur={commitDistance}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitDistance();
            }
          }}
        />
      </label>
      {distanceError !== null && (
        <div className="snap-settings__error" data-testid="tracking-distance-error" role="alert">
          {distanceError}
        </div>
      )}
      <div className="snap-settings__actions">
        <button
          type="button"
          onClick={() => {
            onChange({ ...DEFAULT_SNAP_SETTINGS, types: { ...DEFAULT_SNAP_SETTINGS.types } });
            setSpacingText(String(DEFAULT_SNAP_SETTINGS.gridSpacing));
            setSpacingError(null);
            // トラッキングは、オン・オフを変えずに、刻みと間隔だけ初期値に戻す
            onChangeTracking({
              ...tracking,
              polarAngleIncrement: DEFAULT_TRACKING_SETTINGS.polarAngleIncrement,
              distanceIncrement: DEFAULT_TRACKING_SETTINGS.distanceIncrement,
            });
            setDistanceText(String(DEFAULT_TRACKING_SETTINGS.distanceIncrement));
            setDistanceError(null);
          }}
        >
          初期値に戻す
        </button>
        <button type="button" onClick={onClose}>
          閉じる
        </button>
      </div>
    </div>
  );
}
