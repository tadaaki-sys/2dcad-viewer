import { useState } from "react";
import type { KeyboardEvent } from "react";
import { DEFAULT_SNAP_SETTINGS, parseGridSpacing } from "../core/snap/snapSettings";
import type { ObjectSnapType, SnapSettings } from "../core/snap/snapSettings";
import { OBJECT_SNAP_TYPES, SNAP_TYPE_LABELS } from "../core/snap/snapTypes";
import "./SnapSettingsPanel.css";

type SnapSettingsPanelProps = {
  settings: SnapSettings;
  onChange: (settings: SnapSettings) => void;
  onClose: () => void;
};

/** Snap の詳細設定: 種類ごとのオン・オフと、グリッドの間隔(OSNAP・SNAP・GRID のオン・オフは、ステータスバーのボタン) */
export function SnapSettingsPanel({ settings, onChange, onClose }: SnapSettingsPanelProps) {
  const [spacingText, setSpacingText] = useState(String(settings.gridSpacing));
  const [spacingError, setSpacingError] = useState<string | null>(null);

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
      <div className="snap-settings__actions">
        <button
          type="button"
          onClick={() => {
            onChange({ ...DEFAULT_SNAP_SETTINGS, types: { ...DEFAULT_SNAP_SETTINGS.types } });
            setSpacingText(String(DEFAULT_SNAP_SETTINGS.gridSpacing));
            setSpacingError(null);
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
