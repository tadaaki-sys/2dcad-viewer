// アプリのコマンドの型(コマンドの定義と、依頼を実行する画面の側とで共有する)。React にも画面にも依存しない。
import type { CommandDefinition, CommandSession, PreviewShape } from "../../core/commands";
import type { EntityId } from "../../core/model";
import type { StretchWindow } from "../../core/geometry/stretch";
import type { Affine2D, CadEntity } from "../../types/cad";

/** コマンドが、アプリに頼むこと */
export type AppRequest =
  | { type: "openFile" }
  | { type: "closeDocument" }
  | { type: "fitDrawing" }
  | { type: "toggleMeasurement" }
  | { type: "toggleFullscreen" }
  | { type: "undo" }
  | { type: "redo" }
  /** 図形を、描画順の末尾(最前面)へ追加する。1つの依頼が、Undoの1段階になる */
  | { type: "addEntities"; entities: readonly CadEntity[]; label: string }
  /** 選択中の図形(新しく描いたもの)の描画順を変える */
  | { type: "reorder"; direction: "front" | "back" }
  /** Snap の設定のオン・オフ(OSNAP=図形への吸着、SNAP=格子点への吸着、GRID=格子点の表示) */
  | { type: "toggleSnapSetting"; setting: SnapToggleSetting }
  /** トラッキングのオン・オフ(ORTHO=直交、POLAR=極トラッキング、OTRACK=オブジェクトスナップトラッキング)。ORTHO と POLAR は同時にオンにならない */
  | { type: "toggleTrackingSetting"; setting: TrackingToggleSetting }
  /** 図形を、移動・回転(matrix)で動かす。1つの依頼が、Undoの1段階。noun は操作の名前(「移動」「回転」) */
  | { type: "transformEntities"; ids: readonly EntityId[]; matrix: Affine2D; label: string; noun: string }
  /** 図形を複写する。matrices の1つごとに、全図形の複写を作る。1つの依頼が、Undoの1段階 */
  | { type: "copyEntities"; ids: readonly EntityId[]; matrices: readonly Affine2D[]; label: string }
  /** 図形を削除する。1つの依頼が、Undoの1段階 */
  | { type: "deleteEntities"; ids: readonly EntityId[]; label: string }
  /** 交差窓の中の頂点・端点を動かして、図形の形を変える(STRETCH)。ids は、窓にかかる図形の候補。1つの依頼が、Undoの1段階 */
  | { type: "stretchEntities"; ids: readonly EntityId[]; window: StretchWindow; dx: number; dy: number; label: string };

/** オン・オフを切り替えられるトラッキングの設定 */
export type TrackingToggleSetting = "ortho" | "polar" | "objectTracking";

/** オン・オフを切り替えられる Snap の設定 */
export type SnapToggleSetting = "objectSnap" | "gridSnap" | "gridDisplay";

/** 新しい図形を描く先(現在のレイヤー)。描けないときは、理由を持つ */
export type DrawTarget = { ok: true; layer: string; color: string } | { ok: false; reason: string };

/** 選択から、編集できる図形だけを取り出した結果 */
export type EditTargetsInfo = { editable: readonly EntityId[]; skipped: number; reason: string | null };

/** 編集コマンド(MOVE・COPY・ROTATE・DELETE・MIRROR・SCALE・STRETCH)が使う、図面の編集に関する情報。画面の側が、いまの図面と選択から作る */
export type AppEditing = {
  /** 図面の準備ができていて(読み込み中でなく)、編集できるか */
  ready: boolean;
  /** いまの選択(図形のID) */
  getSelection: () => readonly EntityId[];
  /** IDの一覧から、編集できる図形だけを取り出す(ブロックの中身・寸法などは、除く) */
  resolveTargets: (ids: readonly EntityId[]) => EditTargetsInfo;
  /** 選んだ図形の仮表示を作る関数を返す(変換の一覧を渡すと、動かした形を返す) */
  createPreview: (ids: readonly EntityId[]) => (matrices: readonly Affine2D[]) => readonly PreviewShape[];
  /** 窓(交差窓)にかかる、編集できる図形の候補(ID)。除いた数と理由も返す(STRETCH 用) */
  findInWindow: (window: StretchWindow) => EditTargetsInfo;
  /** ストレッチの仮表示を作る関数を返す(移動量を渡すと、窓の中の頂点を動かした形を返す) */
  createStretchPreview: (ids: readonly EntityId[], window: StretchWindow) => (dx: number, dy: number) => readonly PreviewShape[];
};

/** 編集できない状態(図面が無い・準備中)。初期値と、テストで使う */
export const NO_EDITING: AppEditing = {
  ready: false,
  getSelection: () => [],
  resolveTargets: () => ({ editable: [], skipped: 0, reason: null }),
  createPreview: () => () => [],
  findInWindow: () => ({ editable: [], skipped: 0, reason: null }),
  createStretchPreview: () => () => [],
};

/** コマンドを始める時点のアプリの状態 */
export type AppCommandContext = {
  isDocumentOpen: boolean;
  drawTarget: DrawTarget;
  /** 図面の編集に関する情報(編集コマンド用) */
  editing: AppEditing;
  /** 新しい図形のIDを払い出す。図面の準備ができていないときは、drawTarget が「描けない」になっていて、呼ばれない */
  allocateEntityId: () => EntityId;
};

export type AppCommandDefinition = CommandDefinition<AppRequest, AppCommandContext>;
export type AppCommandSession = CommandSession<AppRequest, AppCommandContext>;

export const NO_DOCUMENT_MESSAGE = "図面が開かれていません";
