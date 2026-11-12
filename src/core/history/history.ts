// 元に戻す・やり直しの履歴。ドキュメントの複製は持たず、変更の内容(ChangeSet)だけを持つ。
import type { CadDocument } from "../model/document";
import { applyChangeSet } from "./apply";
import { invertChangeSet } from "./changeSet";
import type { ChangeSet } from "./changeSet";

/** 元に戻せる段階の上限。超えたら、古いものから捨てる */
export const DEFAULT_UNDO_LIMIT = 200;

export type HistoryOutcome =
  /** 戻す(やり直す)ものが無い */
  | { type: "empty" }
  /** 成功。document が新しいドキュメント、label は戻した(やり直した)変更の名前 */
  | { type: "done"; document: CadDocument; label: string }
  /**
   * 失敗。図面と履歴が食い違っていて、変更を適用できなかった(通常は起きない)。
   * 図面は変えない。これ以上の食い違いを広げないよう、履歴は捨てる。
   */
  | { type: "error"; error: string };

export class DocumentHistory {
  private undoStack: ChangeSet[] = [];
  private redoStack: ChangeSet[] = [];
  private readonly limit: number;

  constructor(limit: number = DEFAULT_UNDO_LIMIT) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error(`履歴の上限が正しくありません: ${limit}`);
    this.limit = limit;
  }

  get undoCount(): number {
    return this.undoStack.length;
  }

  get redoCount(): number {
    return this.redoStack.length;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** 次に元に戻す変更の名前。無ければ null */
  get nextUndoLabel(): string | null {
    return this.undoStack.length > 0 ? this.undoStack[this.undoStack.length - 1].label : null;
  }

  get nextRedoLabel(): string | null {
    return this.redoStack.length > 0 ? this.redoStack[this.redoStack.length - 1].label : null;
  }

  /** 適用済みの変更を記録する。やり直しの列は、捨てる */
  record(changeSet: ChangeSet): void {
    this.undoStack.push(changeSet);
    if (this.undoStack.length > this.limit) this.undoStack.splice(0, this.undoStack.length - this.limit);
    this.redoStack = [];
  }

  /** 1つ元に戻す。document は、いまのドキュメント */
  undo(document: CadDocument): HistoryOutcome {
    const changeSet = this.undoStack[this.undoStack.length - 1];
    if (changeSet === undefined) return { type: "empty" };
    const result = applyChangeSet(document, invertChangeSet(changeSet));
    if (!result.ok) return this.discard(result.error);
    this.undoStack.pop();
    this.redoStack.push(changeSet);
    return { type: "done", document: result.document, label: changeSet.label };
  }

  /** 1つやり直す */
  redo(document: CadDocument): HistoryOutcome {
    const changeSet = this.redoStack[this.redoStack.length - 1];
    if (changeSet === undefined) return { type: "empty" };
    const result = applyChangeSet(document, changeSet);
    if (!result.ok) return this.discard(result.error);
    this.redoStack.pop();
    this.undoStack.push(changeSet);
    return { type: "done", document: result.document, label: changeSet.label };
  }

  /** 履歴をすべて捨てる(図面を開き直したときなど) */
  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  private discard(error: string): HistoryOutcome {
    this.clear();
    return { type: "error", error };
  }
}
