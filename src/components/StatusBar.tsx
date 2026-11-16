import { useState } from "react";
import type { CadModelStats, DocumentInfo, Point2D } from "../types/cad";
import { formatFileSize, formatMm } from "../utils/format";
import type { SnapSettings } from "../core/snap/snapSettings";
import { SnapSettingsPanel } from "./SnapSettingsPanel";
import "./StatusBar.css";

type StatusBarProps = {
  fileInfo: DocumentInfo | null;
  cursorWorld: Point2D | null;
  stats: CadModelStats | null;
  /** 保存した(または、開いた)時点から、図面が変わっているか */
  isDirty: boolean;
  /** 新しい図形を描く先(現在のレイヤー)。無ければ null */
  currentLayerName: string | null;
  /** Snap の設定(GRID・SNAP・OSNAP のボタンの状態と、詳細設定) */
  snapSettings: SnapSettings;
  /** GRID・SNAP・OSNAP のオン・オフ(実行中のコマンドは、終わらせない) */
  onToggleSnap: (setting: SnapToggle) => void;
  onChangeSnapSettings: (settings: SnapSettings) => void;
};

/** ステータスバーのボタンで切り替えられる Snap の設定 */
export type SnapToggle = "objectSnap" | "gridSnap" | "gridDisplay";

const SNAP_TOGGLE_BUTTONS: ReadonlyArray<{ setting: SnapToggle; label: string; title: string; testId: string }> = [
  { setting: "gridDisplay", label: "GRID", title: "格子点の表示(F7)", testId: "status-toggle-grid" },
  { setting: "gridSnap", label: "SNAP", title: "格子点への吸着(F9)", testId: "status-toggle-snap" },
  { setting: "objectSnap", label: "OSNAP", title: "図形への吸着(端点・中点など)(F3)", testId: "status-toggle-osnap" },
];

export function StatusBar({
  fileInfo,
  cursorWorld,
  stats,
  isDirty,
  currentLayerName,
  snapSettings,
  onToggleSnap,
  onChangeSnapSettings,
}: StatusBarProps) {
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [isSnapSettingsOpen, setIsSnapSettingsOpen] = useState(false);
  const hasUnsupported = (stats?.unsupportedEntityCount ?? 0) > 0;

  return (
    <div className="status-bar">
      <div className="status-bar__left">
        <span>{fileInfo ? `${fileInfo.fileName} (${formatFileSize(fileInfo.fileSizeBytes)})` : ""}</span>
        {isDirty && (
          <span className="status-bar__dirty" data-testid="unsaved-indicator" title="保存の機能は、まだありません。図面を閉じると、変更は失われます">
            ● 未保存の変更あり
          </span>
        )}
        {currentLayerName !== null && (
          <span className="status-bar__layer" data-testid="current-layer-indicator">
            現在のレイヤー: {currentLayerName}
          </span>
        )}
        {stats && hasUnsupported && (
          <button
            type="button"
            className="status-bar__unsupported-button"
            onClick={() => setIsPopoverOpen((prev) => !prev)}
          >
            未対応Entity: {stats.unsupportedEntityCount}件
          </button>
        )}
        {isPopoverOpen && stats && (
          <div className="status-bar__unsupported-popover">
            <div className="status-bar__unsupported-popover-title">Entity集計</div>
            <div className="status-bar__unsupported-popover-row">
              <span>総Entity数</span>
              <span>{stats.totalEntityCount}</span>
            </div>
            <div className="status-bar__unsupported-popover-row">
              <span>表示可能</span>
              <span>{stats.supportedEntityCount}</span>
            </div>
            <div className="status-bar__unsupported-popover-row">
              <span>未対応</span>
              <span>{stats.unsupportedEntityCount}</span>
            </div>
            <div className="status-bar__unsupported-popover-title">未対応内訳</div>
            {Object.entries(stats.unsupportedBreakdown)
              .sort(([, a], [, b]) => b - a)
              .map(([type, count]) => (
                <div key={type} className="status-bar__unsupported-popover-row">
                  <span>{type}</span>
                  <span>{count}</span>
                </div>
              ))}
          </div>
        )}
      </div>
      <span className="status-bar__hint">Space+ドラッグ or ホイールクリックで移動</span>
      {/* マウスで押したとき、ボタンにフォーカスを残さない(作図中のコマンドラインの入力を妨げない) */}
      <div className="status-bar__toggles" onMouseDown={(event) => event.preventDefault()}>
        {SNAP_TOGGLE_BUTTONS.map((button) => (
          <button
            key={button.setting}
            type="button"
            className={`status-bar__toggle${snapSettings[button.setting] ? " status-bar__toggle--on" : ""}`}
            aria-pressed={snapSettings[button.setting]}
            title={button.title}
            data-testid={button.testId}
            onClick={() => onToggleSnap(button.setting)}
          >
            {button.label}
          </button>
        ))}
        <button
          type="button"
          className={`status-bar__toggle${isSnapSettingsOpen ? " status-bar__toggle--on" : ""}`}
          title="Snapの詳細設定"
          aria-expanded={isSnapSettingsOpen}
          data-testid="snap-settings-button"
          onClick={() => setIsSnapSettingsOpen((open) => !open)}
        >
          設定
        </button>
      </div>
      {isSnapSettingsOpen && (
        <SnapSettingsPanel settings={snapSettings} onChange={onChangeSnapSettings} onClose={() => setIsSnapSettingsOpen(false)} />
      )}
      <span className="status-bar__coords">
        {cursorWorld ? `X: ${formatMm(cursorWorld.x)}  Y: ${formatMm(cursorWorld.y)}` : "X: -  Y: -"}
      </span>
    </div>
  );
}
