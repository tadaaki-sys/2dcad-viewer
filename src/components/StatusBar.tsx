import { useState } from "react";
import type { CadModelStats, DocumentInfo, Point2D } from "../types/cad";
import { formatFileSize, formatMm } from "../utils/format";
import "./StatusBar.css";

type StatusBarProps = {
  fileInfo: DocumentInfo | null;
  cursorWorld: Point2D | null;
  stats: CadModelStats | null;
};

export function StatusBar({ fileInfo, cursorWorld, stats }: StatusBarProps) {
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const hasUnsupported = (stats?.unsupportedEntityCount ?? 0) > 0;

  return (
    <div className="status-bar">
      <div className="status-bar__left">
        <span>{fileInfo ? `${fileInfo.fileName} (${formatFileSize(fileInfo.fileSizeBytes)})` : ""}</span>
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
      <span className="status-bar__coords">
        {cursorWorld ? `X: ${formatMm(cursorWorld.x)}  Y: ${formatMm(cursorWorld.y)}` : "X: -  Y: -"}
      </span>
    </div>
  );
}
