import "./Toolbar.css";

type ToolbarProps = {
  isDocumentOpen: boolean;
  isMeasurementMode: boolean;
  onOpenFile: () => void;
  onCloseDocument: () => void;
  onToggleMeasurementMode: () => void;
  onFitDrawing: () => void;
  onToggleFullscreen: () => void;
};

export function Toolbar({
  isDocumentOpen,
  isMeasurementMode,
  onOpenFile,
  onCloseDocument,
  onToggleMeasurementMode,
  onFitDrawing,
  onToggleFullscreen,
}: ToolbarProps) {
  return (
    <div className="toolbar">
      <button type="button" className="toolbar__button" onClick={onOpenFile}>
        DXFを開く
      </button>
      <button type="button" className="toolbar__button" onClick={onCloseDocument} disabled={!isDocumentOpen}>
        図面を閉じる
      </button>
      <div className="toolbar__separator" />
      <button
        type="button"
        className={`toolbar__button${isMeasurementMode ? " toolbar__button--active" : ""}`}
        onClick={onToggleMeasurementMode}
        disabled={!isDocumentOpen}
      >
        測定
      </button>
      <button type="button" className="toolbar__button" onClick={onFitDrawing} disabled={!isDocumentOpen}>
        全体表示
      </button>
      <div className="toolbar__separator" />
      <button type="button" className="toolbar__button" onClick={onToggleFullscreen}>
        全画面
      </button>
    </div>
  );
}
