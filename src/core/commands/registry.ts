// コマンドの登録簿と、コマンドの進め方(段階)の型。
// 画面にも、ファイル形式にも依存しない。コマンドが外へ頼むこと(全体表示など)は、型の引数 R で呼び出し側が決める。
//
// 図面を変更する「変更の内容」は、コマンドが依頼(R)として返し、アプリの層が Undo の履歴を通して適用する(Phase 3・4)。
import type { Point2D } from "../../types/cad";

export type PointInput = { kind: "point"; point: Point2D };
export type TextInput = { kind: "text"; text: string };
export type DistanceInput = { kind: "distance"; value: number };
/** キーワード(例: "U"=1点戻す、"C"=閉じる)。段階が宣言したものだけ受け取る。大文字にそろえて渡す */
export type KeywordInput = { kind: "keyword"; keyword: string };
/** 空のEnter。段階が acceptsEnter を宣言したときだけ受け取る */
export type EnterInput = { kind: "enter" };

/** コマンドの段階が受け取る入力 */
export type CommandInput = PointInput | TextInput | DistanceInput | KeywordInput | EnterInput;

/** ゴム紐(描いている途中の仮の図形)。形式に依存しない折れ線で表す。図面のデータではなく、重ねて描くだけ */
export type PreviewShape = { kind: "polyline"; points: readonly Point2D[]; closed: boolean };

/** 段階の結果。メッセージ(コマンドラインに表示)と、アプリへの依頼(R)を返せる */
export type CommandOutput<R> = {
  messages?: readonly string[];
  requests?: readonly R[];
};

/** コマンドが待っている入力の種類 */
export type ExpectedInput = "point" | "text" | "distance";

/** 入力を待つ段階の、共通の部分 */
type PromptBase<R> = { type: "prompt" } & CommandOutput<R> & {
    /** 利用者への案内(例: 「点を指示してください」) */
    prompt: string;
    /** この段階の間、相対座標(@)の基準にする点。指定しなければ、直前に指示された点のまま */
    basePoint?: Point2D;
    /**
     * この段階で終了(Enter・Esc)すると、図面の変更として確定される内容を、すでに持っているか(描きかけの線など)。
     * ページを閉じる・再読み込みする前の確認に使う(確定前の内容は、ドキュメントにまだ無いため)
     */
    pending?: boolean;
    /**
     * Esc(または、別のコマンドに置き換えられたとき)に、確定する内容。
     * 指定しなければ、何も確定せずに取り消す。描きかけの図形を、Escで確定したいコマンドが使う
     */
    onCancel?: () => CommandOutput<R>;
  };

/** 点・距離を待つ段階が、追加で受け取れるもの */
type KeywordOptions = {
  /** 受け付けるキーワード(大文字。例: ["U", "C"])。案内(prompt)には、コマンド側で書く */
  keywords?: readonly string[];
  /** 空のEnterを、入力として受け取る(例: 作図の終了)。指定しなければ、空のEnterは何もしない */
  acceptsEnter?: boolean;
};

/** 入力を待つ段階。待っている種類(expect)と、onInput が受け取る入力の型は、必ず対応する(型で保証する) */
export type PromptStep<R> =
  | (PromptBase<R> &
      KeywordOptions & {
        /** 待っている入力。point は図面のクリックでも入力できる */
        expect: "point";
        onInput: (input: PointInput | KeywordInput | EnterInput) => CommandStep<R>;
        /** カーソル位置に応じたゴム紐を返す(図面を変更せず、重ねて描く) */
        preview?: (cursor: Point2D) => readonly PreviewShape[];
      })
  | (PromptBase<R> & {
      expect: "text";
      onInput: (input: TextInput) => CommandStep<R>;
    })
  | (PromptBase<R> &
      KeywordOptions & {
        expect: "distance";
        onInput: (input: DistanceInput | KeywordInput | EnterInput) => CommandStep<R>;
      });

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
