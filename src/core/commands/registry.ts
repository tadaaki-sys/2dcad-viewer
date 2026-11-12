// コマンドの登録簿と、コマンドの進め方(段階)の型。
// 画面にも、ファイル形式にも依存しない。コマンドが外へ頼むこと(全体表示など)は、型の引数 R で呼び出し側が決める。
//
// 図面を変更する「変更の内容」は、Undo(Phase 3)と作図(Phase 4)で、この仕組みに追加する。
import type { Point2D } from "../../types/cad";

/** コマンドの段階が受け取る入力 */
export type CommandInput =
  | { kind: "point"; point: Point2D }
  | { kind: "text"; text: string }
  | { kind: "distance"; value: number };

/** 段階の結果。メッセージ(コマンドラインに表示)と、アプリへの依頼(R)を返せる */
export type CommandOutput<R> = {
  messages?: readonly string[];
  requests?: readonly R[];
};

/** コマンドが待っている入力の種類 */
export type ExpectedInput = "point" | "text" | "distance";

export type PromptStep<R> = { type: "prompt" } & CommandOutput<R> & {
    /** 利用者への案内(例: 「点を指示してください」) */
    prompt: string;
    /** 待っている入力。point は図面のクリックでも入力できる */
    expect: ExpectedInput;
    /** 入力を受け取って、次の段階を返す */
    onInput: (input: CommandInput) => CommandStep<R>;
  };

export type DoneStep<R> = { type: "done" } & CommandOutput<R>;

export type CommandStep<R> = DoneStep<R> | PromptStep<R>;

export type CommandDefinition<R, C> = {
  /** 登録名。大文字で書く(例: "FIT") */
  name: string;
  /** 別名(例: "F")。大文字で書く */
  aliases?: readonly string[];
  /** 一覧に出す短い説明 */
  description: string;
  /** コマンドを始める。context は、図面が開いているかなど、始める時点の状態 */
  start: (context: C) => CommandStep<R>;
};

/** コマンド名の比較用にそろえる(全角→半角、前後の空白を取り除く、大文字にする) */
export function normalizeCommandName(text: string): string {
  return text.normalize("NFKC").trim().toUpperCase();
}

export class CommandRegistry<R, C> {
  private readonly byName = new Map<string, CommandDefinition<R, C>>();
  private readonly definitions: CommandDefinition<R, C>[] = [];

  /** 登録する。名前や別名が、すでに登録されたものと重なるときはエラー */
  register(definition: CommandDefinition<R, C>): void {
    const names = [definition.name, ...(definition.aliases ?? [])].map(normalizeCommandName);
    for (const name of names) {
      if (name === "") throw new Error("コマンド名が空です");
      if (this.byName.has(name)) throw new Error(`コマンド名が重複しています: ${name}`);
    }
    if (new Set(names).size !== names.length) throw new Error(`コマンド名が重複しています: ${definition.name}`);
    for (const name of names) this.byName.set(name, definition);
    this.definitions.push(definition);
  }

  /** 名前または別名で探す(大文字・小文字、全角・半角は区別しない) */
  find(nameOrAlias: string): CommandDefinition<R, C> | null {
    return this.byName.get(normalizeCommandName(nameOrAlias)) ?? null;
  }

  /** 登録順の一覧 */
  list(): readonly CommandDefinition<R, C>[] {
    return this.definitions;
  }
}
