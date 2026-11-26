import { useEffect, useRef, useState } from "react";
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
  | "EXTEND"
  | "OFFSET"
  | "BREAK"
  | "FILLET"
  | "CHAMFER"
  | "TEXT"
  | "MTEXT"
  | "TEXTEDIT"
  | "TEXTSTYLE"
  | "DIMHORIZONTAL"
  | "DIMVERTICAL"
  | "DIMALIGNED"
  | "DIMRADIUS"
  | "DIMDIAMETER"
  | "DIMANGULAR"
  | "DIMREASSOC"
  | "DIMSTYLE";

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
  { name: "OFFSET", label: "オフセット", title: "図形を、距離だけ平行に複写する(OFFSET)。距離を入力(T=通過点)、図形をクリック、写す側をクリック。繰り返せます" },
  { name: "BREAK", label: "切断", title: "図形を、2点の間で切断する(BREAK)。図形をクリック(その位置が第1点)、第2点をクリック。F で第1点を指定し直せます" },
  { name: "FILLET", label: "フィレット", title: "2本の線(または折れ線の隣り合う線分)の角を、円弧で丸める(FILLET)。半径を入力(Enter=前回の値)、1つ目・2つ目の線をクリック。繰り返せます" },
  { name: "TEXT", label: "文字", title: "文字を描く(TEXT)。挿入点をクリック、回転角(Enter = 0度)、文字を入力パネルに入力" },
  { name: "MTEXT", label: "複数行文字", title: "複数行の文字を描く(MTEXT)。枠の2つの角をクリックして、入力パネルに入力(Ctrl+Enter で確定)。枠の幅で折り返します" },
  { name: "TEXTEDIT", label: "文字編集", title: "文字の内容を直す(TEXTEDIT)。文字をクリックして、入力パネルで直す。位置・スタイルは変わりません" },
  { name: "TEXTSTYLE", label: "文字スタイル", title: "文字スタイル(フォント・高さ・幅係数・斜体・配置)の管理パネルを開く(TEXTSTYLE)" },
  { name: "CHAMFER", label: "面取り", title: "2本の線(または折れ線の隣り合う線分)の角を、斜めの線で面取りする(CHAMFER)。距離1・距離2を入力(Enter=前回の値)、1つ目・2つ目の線をクリック。繰り返せます" },
  { name: "DELETE", label: "削除", title: "選択した図形を削除する(DELETE・Delete キー)。Ctrl+Z で戻せます" },
];

/** 寸法のコマンド(「寸法」メニューに並べる。ボタンを増やさず、ツールバーを窮屈にしない) */
const DIMENSION_MENU: ReadonlyArray<{ name: DrawCommandName; label: string; title: string }> = [
  { name: "DIMHORIZONTAL", label: "水平寸法", title: "水平寸法を描く(DIMHORIZONTAL・DH)。2点と、寸法線の位置をクリック" },
  { name: "DIMVERTICAL", label: "垂直寸法", title: "垂直寸法を描く(DIMVERTICAL・DV)。2点と、寸法線の位置をクリック" },
  { name: "DIMALIGNED", label: "平行寸法", title: "2点を結ぶ向きの寸法を描く(DIMALIGNED・DAL)。2点と、寸法線の位置をクリック" },
  { name: "DIMRADIUS", label: "半径寸法", title: "半径寸法を描く(DIMRADIUS・DRA)。円・円弧をクリックして、文字の側の点をクリック" },
  { name: "DIMDIAMETER", label: "直径寸法", title: "直径寸法を描く(DIMDIAMETER・DDI)。円・円弧をクリックして、向きを決める点をクリック" },
  { name: "DIMANGULAR", label: "角度寸法", title: "角度寸法を描く(DIMANGULAR・DAN)。2本の線をクリックして、弧が通る点をクリック(Enter = 3点指定)" },
  { name: "DIMREASSOC", label: "関連付け", title: "寸法を、図形に関連付けし直す(DIMREASSOC・DRE)。測る点を図形の端点などに付ける。参照が切れた寸法や、Phase 15 までの寸法を、連動にできる" },
  { name: "DIMSTYLE", label: "寸法スタイル", title: "寸法スタイル(文字の高さ・矢印・小数桁・単位・色・レイヤー・線種)の管理パネルを開く(DIMSTYLE・DST)" },
];

/** 「寸法」ボタンと、その下に開くメニュー */
function DimensionMenu({ isEditable, activeCommandName, onDraw }: { isEditable: boolean; activeCommandName: string | null; onDraw: (name: DrawCommandName) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    // メニューの外をクリックしたとき・Esc を押したときに閉じる
    const close = (event: MouseEvent | KeyboardEvent): void => {
      if (event instanceof KeyboardEvent) {
        if (event.key === "Escape") setOpen(false);
        return;
      }
      if (rootRef.current !== null && event.target instanceof Node && !rootRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  const isActive = activeCommandName !== null && DIMENSION_MENU.some((item) => item.name === activeCommandName);
  return (
    <div className="toolbar__menu" ref={rootRef}>
      <button
        type="button"
        className={`toolbar__button${isActive ? " toolbar__button--active" : ""}`}
        title="寸法を描く・寸法スタイルを開く"
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="toolbar-dimension"
        onClick={() => setOpen((value) => !value)}
        disabled={!isEditable}
      >
        寸法▾
      </button>
      {open && (
        <div className="toolbar__menu-list" role="menu" data-testid="toolbar-dimension-menu">
          {DIMENSION_MENU.map((item) => (
            <button
              key={item.name}
              type="button"
              role="menuitem"
              className="toolbar__menu-item"
              title={item.title}
              data-testid={`toolbar-${item.name.toLowerCase()}`}
              onClick={() => {
                setOpen(false);
                onDraw(item.name);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

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
      <DimensionMenu isEditable={isEditable} activeCommandName={activeCommandName} onDraw={onDraw} />
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
