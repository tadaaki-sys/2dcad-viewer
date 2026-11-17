import "./Toolbar.css";

/** ツールバーから動かす作図コマンド */
export type DrawCommandName =
  | "LINE"
  | "PLINE"
  | "RECT"
  | "CIRCLE"
  | "ARC"
  | "MOVE"
  | "COPY"
  | "ROTATE"
  | "DELETE"
  | "MIRROR"
  | "SCALE"
  | "STRETCH"
  | "TRIM"
  | "EXTEND";

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
  { name: "CIRCLE", label: "円", title: "円を描く(CIRCLE)" },
  { name: "ARC", label: "円弧", title: "円弧を描く(ARC)" },
];

/** 編集のコマンド。先に図形を選択してあれば、その選択を使う。無ければ、押したあとに選択して Enter */
const EDIT_BUTTONS: ReadonlyArray<{ name: DrawCommandName; label: string; title: string }> = [
  { name: "MOVE", label: "移動", title: "選択した図形を移動する(MOVE)" },
  { name: "COPY", label: "コピー", title: "選択した図形を複写する(COPY)。繰り返せます" },
  { name: "ROTATE", label: "回転", title: "選択した図形を回転する(ROTATE)" },
  { name: "MIRROR", label: "鏡像", title: "選択した図形を鏡像にする(MIRROR)。元の図形を残すか削除するかを選べます" },
  { name: "SCALE", label: "拡大縮小", title: "選択した図形を拡大・縮小する(SCALE)。倍率、または参照の長さで指定します" },
  { name: "STRETCH", label: "ストレッチ", title: "交差窓で囲んだ頂点を動かして、図形の形を変える(STRETCH)" },
  { name: "TRIM", label: "トリム", title: "境界で図形を切り取る(TRIM)。境界を選んで Enter(何も選ばずに Enter = すべて)、切り取る部分をクリック" },
  { name: "EXTEND", label: "延長", title: "境界まで図形を延ばす(EXTEND)。境界を選んで Enter(何も選ばずに Enter = すべて)、延ばす図形の端に近い所をクリック" },
  { name: "DELETE", label: "削除", title: "選択した図形を削除する(DELETE・Delete キー)。Ctrl+Z で戻せます" },
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
      {EDIT_BUTTONS.map((button) => (
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
