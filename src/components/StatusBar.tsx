import type { DocumentInfo } from "../types/cad";
import type { Point2D } from "../types/cad";
import { formatFileSize, formatMm } from "../utils/format";
import "./StatusBar.css";

type StatusBarProps = {
  fileInfo: DocumentInfo | null;
  cursorWorld: Point2D | null;
};

export function StatusBar({ fileInfo, cursorWorld }: StatusBarProps) {
  return (
    <div className="status-bar">
      <span>{fileInfo ? `${fileInfo.fileName} (${formatFileSize(fileInfo.fileSizeBytes)})` : ""}</span>
      <span className="status-bar__coords">
        {cursorWorld ? `X: ${formatMm(cursorWorld.x)}  Y: ${formatMm(cursorWorld.y)}` : "X: -  Y: -"}
      </span>
    </div>
  );
}
