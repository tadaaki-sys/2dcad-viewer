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

/** 履歴の1段階。id は、この変更を記録したときに振る一意の番号(「いまの状態」を識別するのに使う) */
type Entry = { id: number; changeSet: ChangeSet };

export class DocumentHistory {
  private undoStack: Entry[] = [];
  private redoStack: Entry[] = [];
  private readonly limit: number;
  private nextEntryId = 1;
  /** 元に戻す列が空のときの、状態の識別番号。最初は0(開いた直後の状態)。古い段階を捨てたり履歴を破棄したときは、新しい番号になる */
  private baseStateId = 0;

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
    return this.undoStack.length > 0 ? this.undoStack[this.undoStack.length - 1].changeSet.label : null;
  }

  get nextRedoLabel(): string | null {
    return this.redoStack.length > 0 ? this.redoStack[this.redoStack.length - 1].changeSet.label : null;
  }

  /**
   * いまの図面の状態を識別する番号。同じ状態に戻る(Undoで保存した時点へ戻るなど)と、同じ番号になる。
   * 保存した時点の番号と比べて、未保存の変更があるかを判断するのに使う。
   */
  get currentStateId(): number {
    return this.undoStack.length > 0 ? this.undoStack[this.undoStack.length - 1].id : this.baseStateId;
  }

  /** 適用済みの変更を記録する。やり直しの列は、捨てる */
  record(changeSet: ChangeSet): void {
    this.undoStack.push({ id: this.nextEntryId++, changeSet });
    if (this.undoStack.length > this.limit) {
      const dropped = this.undoStack.splice(0, this.undoStack.length - this.limit);
      // 捨てた段階の先にある状態が、元に戻せる最も古い状態になる(開いた直後の状態ではない)
      this.baseStateId = dropped[dropped.length - 1].id;
    }
    this.redoStack = [];
  }

  /** 1つ元に戻す。document は、いまのドキュメント */
  undo(document: CadDocument): HistoryOutcome {
    const entry = this.undoStack[this.undoStack.length - 1];
    if (entry === undefined) return { type: "empty" };
    const result = applyChangeSet(document, invertChangeSet(entry.changeSet));
    if (!result.ok) return this.discard(result.error);
    this.undoStack.pop();
    this.redoStack.push(entry);
    return { type: "done", document: result.document, label: entry.changeSet.label };
  }

  /** 1つやり直す */
  redo(document: CadDocument): HistoryOutcome {
    const entry = this.redoStack[this.redoStack.length - 1];
    if (entry === undefined) return { type: "empty" };
    const result = applyChangeSet(document, entry.changeSet);
    if (!result.ok) return this.discard(result.error);
    this.redoStack.pop();
    this.undoStack.push(entry);
    return { type: "done", document: result.document, label: entry.changeSet.label };
  }

  /** 履歴をすべて捨てる。この後の状態は、どの保存時点とも同じではない扱いになる(新しい識別番号) */
  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.baseStateId = this.nextEntryId++;
  }

  private discard(error: string): HistoryOutcome {
    this.clear();
    return { type: "error", error };
  }
}
