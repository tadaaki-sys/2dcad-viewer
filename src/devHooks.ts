// 開発サーバーのときだけ使う、E2Eテスト用の入口(window.__cadDev)。
// 図面を編集するコマンドがまだ無い間(Phase 4で作図ができるまで)、「変更 → 表示 → Undo → Redo」をブラウザで確かめるためのもの。
// App.tsx が `import.meta.env.DEV` のときだけ、動的に読み込む。本番ビルドには含まれない
// (含まれないことは、ビルドの成果物を検索して確認する: docs/regression-checklist.md)。
import type { DocumentSession } from "./app/document/documentSession";
import { addEntitiesChangeSet, removeEntitiesChangeSet, replaceEntitiesChangeSet } from "./core/history";
import type { CadLine } from "./types/cad";

export type CadDevHooks = {
  /** 図面の準備(元データの読み込み)が終わっていて、編集できるか */
  ready: () => boolean;
  entityCount: () => number;
  /** 描画順での図形IDの一覧(先頭が最背面) */
  entityOrder: () => string[];
  /** 線を1本、描画順の末尾に追加する(Undoできる変更)。追加した図形のIDを返す */
  addLine: (x1: number, y1: number, x2: number, y2: number, color?: string) => string;
  /** 図形を削除する(Undoできる変更) */
  removeEntity: (id: string) => void;
  /** 線の位置を置き換える(Undoできる変更。IDは変わらない) */
  moveLine: (id: string, x1: number, y1: number, x2: number, y2: number) => void;
  history: () => { canUndo: boolean; canRedo: boolean; nextUndoLabel: string | null; nextRedoLabel: string | null };
};

declare global {
  interface Window {
    __cadDev?: CadDevHooks;
  }
}

export function installDevHooks(options: { getSession: () => DocumentSession | null }): () => void {
  const session = (): DocumentSession => {
    const current = options.getSession();
    if (current === null) throw new Error("図面の準備ができていません");
    return current;
  };
  const must = (outcome: { ok: true } | { ok: false; error: string }) => {
    if (!outcome.ok) throw new Error(outcome.error);
  };

  const hooks: CadDevHooks = {
    ready: () => options.getSession() !== null,
    entityCount: () => session().document.entities.length,
    entityOrder: () => session().document.entities.map((e) => e.id),
    addLine: (x1, y1, x2, y2, color = "#ff00ff") => {
      const s = session();
      const id = s.allocateEntityId();
      const line: CadLine = { id, type: "LINE", layer: "0", color, start: { x: x1, y: y1 }, end: { x: x2, y: y2 } };
      must(s.apply(addEntitiesChangeSet(s.document, [line], "線を追加")));
      return id;
    },
    removeEntity: (id) => {
      const s = session();
      must(s.apply(removeEntitiesChangeSet(s.document, [id], "図形を削除")));
    },
    moveLine: (id, x1, y1, x2, y2) => {
      const s = session();
      const current = s.document.entities.find((e) => e.id === id);
      if (current === undefined || current.type !== "LINE") throw new Error(`線が見つかりません: ${id}`);
      const moved: CadLine = { ...current, start: { x: x1, y: y1 }, end: { x: x2, y: y2 } };
      must(s.apply(replaceEntitiesChangeSet(s.document, [moved], "線を移動")));
    },
    history: () => {
      const s = session();
      return { canUndo: s.canUndo, canRedo: s.canRedo, nextUndoLabel: s.nextUndoLabel, nextRedoLabel: s.nextRedoLabel };
    },
  };

  window.__cadDev = hooks;
  return () => {
    if (window.__cadDev === hooks) delete window.__cadDev;
  };
}
