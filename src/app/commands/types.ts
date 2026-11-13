// アプリのコマンドの型(コマンドの定義と、依頼を実行する画面の側とで共有する)。React にも画面にも依存しない。
import type { CommandDefinition, CommandSession } from "../../core/commands";
import type { EntityId } from "../../core/model";
import type { CadEntity } from "../../types/cad";

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
  | { type: "reorder"; direction: "front" | "back" };

/** 新しい図形を描く先(現在のレイヤー)。描けないときは、理由を持つ */
export type DrawTarget = { ok: true; layer: string; color: string } | { ok: false; reason: string };

/** コマンドを始める時点のアプリの状態 */
export type AppCommandContext = {
  isDocumentOpen: boolean;
  drawTarget: DrawTarget;
  /** 新しい図形のIDを払い出す。図面の準備ができていないときは、drawTarget が「描けない」になっていて、呼ばれない */
  allocateEntityId: () => EntityId;
};

export type AppCommandDefinition = CommandDefinition<AppRequest, AppCommandContext>;
export type AppCommandSession = CommandSession<AppRequest, AppCommandContext>;

export const NO_DOCUMENT_MESSAGE = "図面が開かれていません";
