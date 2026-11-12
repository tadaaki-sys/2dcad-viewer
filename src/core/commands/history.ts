// コマンドラインの入力の履歴(↑↓で前の入力を呼び出す)。
export const DEFAULT_HISTORY_LIMIT = 50;

export class CommandHistory {
  private entries: string[] = [];
  /** 呼び出し中の位置。null は「履歴をたどっていない(いま入力中の文字)」 */
  private cursor: number | null = null;
  private draft = "";
  private readonly limit: number;

  constructor(limit: number = DEFAULT_HISTORY_LIMIT) {
    this.limit = limit;
  }

  get size(): number {
    return this.entries.length;
  }

  /** 実行した入力を記録する。空の入力と、直前と同じ入力は記録しない */
  push(text: string): void {
    this.cursor = null;
    const entry = text.trim();
    if (entry === "") return;
    if (this.entries[this.entries.length - 1] === entry) return;
    this.entries.push(entry);
    if (this.entries.length > this.limit) this.entries.splice(0, this.entries.length - this.limit);
  }

  /** ↑: 1つ前の入力。いま入力中の文字(currentText)は、↓で戻れるように覚えておく。これ以上前が無ければ、いまの入力のまま */
  previous(currentText: string): string {
    if (this.entries.length === 0) return currentText;
    if (this.cursor === null) {
      this.draft = currentText;
      this.cursor = this.entries.length - 1;
    } else if (this.cursor > 0) {
      this.cursor -= 1;
    }
    return this.entries[this.cursor];
  }

  /** ↓: 1つ後の入力。いちばん新しいところを過ぎたら、入力中だった文字に戻る */
  next(currentText: string): string {
    if (this.cursor === null) return currentText;
    if (this.cursor < this.entries.length - 1) {
      this.cursor += 1;
      return this.entries[this.cursor];
    }
    this.cursor = null;
    return this.draft;
  }

  /** 履歴をたどる位置を戻す(文字を直接編集したときなど) */
  resetCursor(): void {
    this.cursor = null;
  }
}
