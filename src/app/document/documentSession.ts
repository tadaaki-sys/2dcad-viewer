// 開いている図面(ドキュメント)と、その変更の履歴を持つ。React・画面には依存しない。
// 図面の変更は、必ず apply(変更の内容)・undo・redo を通す。通すことで、履歴に記録され、購読している画面に知らされる。
import { allocateEntityId } from "../../core/model";
import type { CadDocument, EntityId } from "../../core/model";
import { applyChangeSet, DocumentHistory } from "../../core/history";
import type { ChangeSet, HistoryOutcome } from "../../core/history";

/** 画面が、ボタンの有効・無効や、未保存の表示に使う状態 */
export type DocumentSessionState = {
  canUndo: boolean;
  canRedo: boolean;
  /** 保存した(または、開いた)時点から、図面が変わっているか */
  isDirty: boolean;
};

/** 図面が変わったことの知らせ */
export type DocumentChange = {
  kind: "apply" | "undo" | "redo";
  /** 変更の名前(例: 「線を追加」) */
  label: string;
  /** 変更後のドキュメント */
  document: CadDocument;
  /** 変更後の状態 */
  state: DocumentSessionState;
};

export type DocumentChangeListener = (change: DocumentChange) => void;

export type ApplyOutcome = { ok: true } | { ok: false; error: string };

export class DocumentSession {
  private current: CadDocument;
  private readonly history: DocumentHistory;
  private readonly listeners = new Set<DocumentChangeListener>();
  /** 保存した(または、開いた)時点の、履歴の状態番号 */
  private savedStateId: number;

  constructor(document: CadDocument, undoLimit?: number) {
    this.current = document;
    this.history = new DocumentHistory(undoLimit);
    this.savedStateId = this.history.currentStateId;
  }

  /** 保存した(または、開いた)時点から、図面が変わっているか。Undoで同じ状態に戻れば、false に戻る */
  get isDirty(): boolean {
    return this.history.currentStateId !== this.savedStateId;
  }

  /** いまの図面を「保存済み」として覚える(保存の Phase で、保存に成功したときに呼ぶ) */
  markSaved(): void {
    this.savedStateId = this.history.currentStateId;
  }

  get state(): DocumentSessionState {
    return { canUndo: this.history.canUndo, canRedo: this.history.canRedo, isDirty: this.isDirty };
  }

  get document(): CadDocument {
    return this.current;
  }

  get canUndo(): boolean {
    return this.history.canUndo;
  }

  get canRedo(): boolean {
    return this.history.canRedo;
  }

  get nextUndoLabel(): string | null {
    return this.history.nextUndoLabel;
  }

  get nextRedoLabel(): string | null {
    return this.history.nextRedoLabel;
  }

  /** 変更を適用して、履歴に記録する。失敗したら何も変えず、理由を返す */
  apply(changeSet: ChangeSet): ApplyOutcome {
    const result = applyChangeSet(this.current, changeSet);
    if (!result.ok) return { ok: false, error: result.error };
    this.current = result.document;
    this.history.record(changeSet);
    this.notify({ kind: "apply", label: changeSet.label, document: this.current, state: this.state });
    return { ok: true };
  }

  undo(): HistoryOutcome {
    return this.step("undo", this.history.undo(this.current));
  }

  redo(): HistoryOutcome {
    return this.step("redo", this.history.redo(this.current));
  }

  /**
   * 新しい図形のIDを払い出す。払い出し番号が進むだけで、図面の内容は変わらないので、履歴には記録せず、知らせも出さない。
   * (Undoしても番号は戻らないので、同じIDを別の図形に使い回さない)
   */
  allocateEntityId(): EntityId {
    const allocated = allocateEntityId(this.current);
    this.current = allocated.document;
    return allocated.id;
  }

  /** 図面の変更を購読する。戻り値の関数で、購読をやめる */
  subscribe(listener: DocumentChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private step(kind: "undo" | "redo", outcome: HistoryOutcome): HistoryOutcome {
    if (outcome.type === "done") {
      this.current = outcome.document;
      this.notify({ kind, label: outcome.label, document: this.current, state: this.state });
    }
    return outcome;
  }

  private notify(change: DocumentChange): void {
    // 状態は更新済み。購読する側の失敗が、ほかの購読者への知らせを止めないようにする
    const errors: unknown[] = [];
    for (const listener of [...this.listeners]) {
      try {
        listener(change);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) throw errors[0];
  }
}

/** 元に戻す・やり直しの結果を、利用者に見せる文にする */
export function describeHistoryOutcome(kind: "undo" | "redo", outcome: HistoryOutcome): string {
  const verb = kind === "undo" ? "元に戻しました" : "やり直しました";
  switch (outcome.type) {
    case "done":
      return `${verb}: ${outcome.label}`;
    case "empty":
      return kind === "undo" ? "元に戻す操作がありません" : "やり直す操作がありません";
    case "error":
      return `${kind === "undo" ? "元に戻せません" : "やり直せません"}でした(図面と履歴が一致しないため、履歴を破棄しました): ${outcome.error}`;
  }
}

export const DOCUMENT_NOT_READY_MESSAGE = "図面の準備中です。少し待ってからお試しください";
