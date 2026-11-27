// 開いている図面(ドキュメント)と、その変更の履歴を持つ。React・画面には依存しない。
// 図面の変更は、必ず apply(変更の内容)・undo・redo を通す。通すことで、履歴に記録され、購読している画面に知らされる。
import { allocateEntityId } from "../../core/model";
import type { CadDocument, EntityId } from "../../core/model";
import { applyChangeSet, DocumentHistory } from "../../core/history";
import { planAssociation } from "./associativity";
import { planGroupMaintenance } from "./grouping";
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
  /**
   * apply / undo / redo: 図面が変わった。
   * reset: 履歴と図面が食い違って履歴を破棄した(図面は変わらない。ボタンと未保存の状態だけが変わる)。
   * saved: 保存済みとして覚えた(図面は変わらない。未保存の状態が変わる)。
   * view: レイヤーの表示・非表示を切り替えた(図面の図形は変わらない。履歴・未保存の状態にも入らない表示設定)。
   */
  kind: "apply" | "undo" | "redo" | "reset" | "saved" | "view";
  /** 変更の名前(例: 「線を追加」) */
  label: string;
  /** 変更後のドキュメント */
  document: CadDocument;
  /** 変更後の状態 */
  state: DocumentSessionState;
};

export type DocumentChangeListener = (change: DocumentChange) => void;

/** 変更の結果。notice は、連動寸法の追従で知らせること(参照が切れた・関連付けを解除した)。無ければ付かない */
export type ApplyOutcome = { ok: true; notice?: string } | { ok: false; error: string };

export class DocumentSession {
  private current: CadDocument;
  private readonly history: DocumentHistory;
  private readonly listeners = new Set<DocumentChangeListener>();
  private pendingNotice: string | null = null;
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

  /**
   * いまの図面の状態の識別番号。保存を始める時点で控えておき、保存に成功したら markSaved に渡す。
   * (保存している間に編集が進んでも、保存できた状態だけを「保存済み」にするため)
   */
  get saveToken(): number {
    return this.history.currentStateId;
  }

  /**
   * 保存済みとして覚える(保存の Phase で、保存に成功したときに呼ぶ)。
   * token は、保存を始めたときの saveToken。省略すると、いまの状態を保存済みにする。購読者に、未保存の状態の変化を知らせる
   */
  markSaved(token: number = this.history.currentStateId): void {
    this.savedStateId = token;
    this.notify({ kind: "saved", label: "保存", document: this.current, state: this.state });
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

  /**
   * 変更を適用して、履歴に記録する。失敗したら何も変えず、理由を返す。
   * 参照している連動寸法の追従は、変更に足して、1つの変更として適用・記録する(Undo は1回で、追従ごと戻る)。
   */
  apply(changeSet: ChangeSet): ApplyOutcome {
    this.pendingNotice = null;
    let planned;
    try {
      planned = planAssociation(this.current, changeSet);
    } catch (error) {
      // 追従を計算できないときは、中途半端に適用しない(寸法が、図形と食い違ったままにならないように)
      return { ok: false, error: `連動寸法の追従を計算できませんでした: ${error instanceof Error ? error.message : String(error)}` };
    }
    // 図形の削除に伴う、グループの整理(Phase 19)。削除された図形を、グループから外す
    const grouped = planGroupMaintenance(this.current, planned.changeSet);
    const notice = [planned.notice, grouped.notice].filter((n): n is string => n !== null).join("。") || null;
    const result = applyChangeSet(this.current, grouped.changeSet);
    if (!result.ok) return { ok: false, error: result.error };
    this.current = result.document;
    this.history.record(grouped.changeSet);
    this.pendingNotice = notice;
    this.notify({ kind: "apply", label: changeSet.label, document: this.current, state: this.state });
    return notice === null ? { ok: true } : { ok: true, notice };
  }

  /** 直前の apply が、知らせること(参照が切れた、など)を取り出す。取り出すと、空になる */
  takeNotice(): string | null {
    const notice = this.pendingNotice;
    this.pendingNotice = null;
    return notice;
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

  /**
   * レイヤーの表示・非表示を切り替える。表示設定なので、履歴には記録せず、未保存の状態も変えない(購読者には知らせる)。
   * 戻り値は、そのレイヤーがあったか。
   */
  setLayerVisible(name: string, visible: boolean): boolean {
    const index = this.current.layerIndexByName.get(name);
    if (index === undefined) return false;
    const layer = this.current.layers[index];
    if (layer.visible === visible) return true;
    const layers = this.current.layers.slice();
    layers[index] = { ...layer, visible };
    this.current = { ...this.current, layers };
    this.notify({ kind: "view", label: "レイヤーの表示", document: this.current, state: this.state });
    return true;
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
    } else if (outcome.type === "error") {
      // 履歴が破棄された。図面は変わらないが、元に戻す・やり直しの可否と、未保存の状態が変わるので知らせる
      this.notify({ kind: "reset", label: "履歴を破棄", document: this.current, state: this.state });
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
