import "./Toolbar.css";

/** ツールバーから動かす作図コマンド */
export type DrawCommandName = "LINE" | "PLINE" | "RECT";

type ToolbarProps = {
  isDocumentOpen: boolean;
  isMeasurementMode: boolean;
  /** 図面の準備(元データの読み込み)が終わっていて、描けるか */
  isEditable: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** 実行中のコマンドの名前。作図ボタンの「押されている」表示に使う */
  activeCommandName: string | null;
  onOpenFile: () => void;
  onCloseDocument: () => void;
  onToggleMeasurementMode: () => void;
  onFitDrawing: () => void;
  onToggleFullscreen: () => void;
  onDraw: (name: DrawCommandName) => void;
  onUndo: () => void;
  onRedo: () => void;
};

const DRAW_BUTTONS: ReadonlyArray<{ name: DrawCommandName; label: string; title: string }> = [
  { name: "LINE", label: "線", title: "線を描く(LINE)" },
  { name: "PLINE", label: "ポリライン", title: "ポリラインを描く(PLINE)" },
  { name: "RECT", label: "長方形", title: "長方形を描く(RECT)" },
];

export function Toolbar({
  isDocumentOpen,
  isMeasurementMode,
  isEditable,
  canUndo,
  canRedo,
  activeCommandName,
  onOpenFile,
  onCloseDocument,
  onToggleMeasurementMode,
  onFitDrawing,
  onToggleFullscreen,
  onDraw,
  onUndo,
  onRedo,
}: ToolbarProps) {
  return (
    // マウスでボタンを押したとき、ボタンにフォーカスを残さない(残ると、次のEnterキーが同じボタンの再実行になり、
    // コマンドラインへ移れない)。キーボード(Tab)での操作は、今までどおり。
    <div className="toolbar" onMouseDown={(event) => event.preventDefault()}>
      <button type="button" className="toolbar__button" onClick={onOpenFile}>
        図面を開く
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
      {DRAW_BUTTONS.map((button) => (
        <button
          key={button.name}
          type="button"
          className={`toolbar__button${activeCommandName === button.name ? " toolbar__button--active" : ""}`}
          title={button.title}
          onClick={() => onDraw(button.name)}
          disabled={!isEditable}
        >
          {button.label}
        </button>
      ))}
      <div className="toolbar__separator" />
      <button type="button" className="toolbar__button" title="元に戻す(Ctrl+Z)" onClick={onUndo} disabled={!canUndo}>
        元に戻す
      </button>
      <button type="button" className="toolbar__button" title="やり直し(Ctrl+Y)" onClick={onRedo} disabled={!canRedo}>
        やり直し
      </button>
      <div className="toolbar__separator" />
      <button type="button" className="toolbar__button" onClick={onToggleFullscreen}>
        全画面
      </button>
    </div>
  );
}
