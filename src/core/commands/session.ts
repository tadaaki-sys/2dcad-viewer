// コマンドの実行の状態(いま、どのコマンドが、何の入力を待っているか)を持つ。
// コマンドラインの文字、図面のクリック、ツールバーのボタンは、どれもこの1つの入口から入る。
import type { Point2D } from "../../types/cad";
import { parseCoordinateInput } from "./coordinateInput";
import { normalizeCommandName } from "./registry";
import type { CommandRegistry, CommandStep, ExpectedInput, PreviewShape, PromptStep } from "./registry";

/** 実行中のコマンドの状態(画面の表示用) */
export type ActiveCommand = {
  name: string;
  prompt: string;
  expect: ExpectedInput;
  /** 受け付けるキーワード(大文字)。無ければ空 */
  keywords: readonly string[];
  /** 空のEnterを入力として受け取るか(作図の終了など) */
  acceptsEnter: boolean;
  /** ゴム紐(プレビュー)を出すか */
  hasPreview: boolean;
  /** 終了すると図面の変更として確定される、描きかけの内容を持っているか */
  hasPendingChanges: boolean;
};

export type SessionResult<R> = {
  /** コマンドラインに追加するメッセージ(入力の行は含まない) */
  messages: string[];
  /** アプリへの依頼 */
  requests: R[];
  /** 処理した後の状態。実行中でなければ null */
  active: ActiveCommand | null;
};

type Running<R> = { name: string; step: PromptStep<R> };

export class CommandSession<R, C> {
  private running: Running<R> | null = null;
  private lastPoint: Point2D | null = null;
  private readonly registry: CommandRegistry<R, C>;
  private readonly getContext: () => C;

  constructor(registry: CommandRegistry<R, C>, getContext: () => C) {
    this.registry = registry;
    this.getContext = getContext;
  }

  /** 実行中のコマンドの状態。実行中でなければ null */
  get active(): ActiveCommand | null {
    return this.snapshot();
  }

  /** 直前に指示された点(相対座標の基準)。まだ無ければ null */
  get lastPointValue(): Point2D | null {
    return this.lastPoint;
  }

  /** コマンドラインに打ち込まれた文字を処理する(コマンドの名前、または、実行中のコマンドへの入力) */
  submitText(text: string): SessionResult<R> {
    if (this.running === null) return this.startByName(text);
    return this.feedText(this.running, text);
  }

  /** 図面のクリックなどで、点が指示された。点を待っていないときは、何もしない */
  submitPoint(point: Point2D): SessionResult<R> {
    const running = this.running;
    if (running === null) return this.empty();
    const step = running.step;
    if (step.expect !== "point") return this.empty();
    this.lastPoint = point;
    return this.advance(running.name, step.onInput({ kind: "point", point }));
  }

  /** キーワード(ショートカットからの "U" など)を渡す。実行中の段階が、そのキーワードを宣言していなければ、何もしない */
  submitKeyword(keyword: string): SessionResult<R> {
    const running = this.running;
    if (running === null || running.step.expect === "text") return this.empty();
    const normalized = normalizeCommandName(keyword);
    if (!running.step.keywords?.includes(normalized)) return this.empty();
    return this.advance(running.name, running.step.onInput({ kind: "keyword", keyword: normalized }));
  }

  /**
   * ゴム紐(描いている途中の仮の図形)。点を待っていて、プレビューを持つ段階のときだけ返す。
   * 図面のデータは変えない(呼ぶだけで、状態は変わらない)
   */
  previewAt(cursor: Point2D): readonly PreviewShape[] {
    const step = this.running?.step;
    if (step === undefined || step.expect !== "point" || step.preview === undefined) return [];
    return step.preview(cursor);
  }

  /**
   * 実行中のコマンドを終える(Esc)。実行中でなければ何もしない。
   * 段階が onCancel を持っていれば、その内容(描きかけの図形の確定など)を返す。無ければ、何も確定せずに取り消す
   */
  cancel(): SessionResult<R> {
    if (this.running === null) return this.empty();
    const { name, step } = this.running;
    this.running = null;
    if (step.onCancel !== undefined) {
      const output = step.onCancel();
      return { messages: [...(output.messages ?? [])], requests: [...(output.requests ?? [])], active: null };
    }
    return { messages: [`${name} を取り消しました`], requests: [], active: null };
  }

  /** 名前を指定して、コマンドを始める(ツールバーやショートカット用)。実行中のコマンドは、終えて置き換える */
  run(name: string): SessionResult<R> {
    const ended = this.running !== null ? this.cancel() : null;
    const result = this.startByName(name);
    if (ended === null) return result;
    return {
      messages: [...ended.messages, ...result.messages],
      requests: [...ended.requests, ...result.requests],
      active: result.active,
    };
  }

  /** 図面を閉じた・開き直したときなどに、実行中のコマンドと直前の点を捨てる(メッセージも、確定する内容も出さない) */
  reset(): void {
    this.running = null;
    this.lastPoint = null;
  }

  private startByName(text: string): SessionResult<R> {
    if (normalizeCommandName(text) === "") return this.empty();
    const definition = this.registry.find(text);
    if (definition === null) {
      return { messages: [`不明なコマンドです: ${text.trim()}`], requests: [], active: null };
    }
    return this.advance(definition.name, definition.start(this.getContext()));
  }

  private feedText(running: Running<R>, text: string): SessionResult<R> {
    const step = running.step;
    if (step.expect === "text") return this.advance(running.name, step.onInput({ kind: "text", text }));

    // 点・距離を待っているとき。空のEnterは、段階が宣言していれば入力として渡し、なければ何もしない
    if (text.trim() === "") {
      return step.acceptsEnter === true ? this.advance(running.name, step.onInput({ kind: "enter" })) : this.empty();
    }
    const keyword = normalizeCommandName(text);
    if (step.keywords?.includes(keyword)) {
      return this.advance(running.name, step.onInput({ kind: "keyword", keyword }));
    }

    const parsed = parseCoordinateInput(text, this.lastPoint);
    if (!parsed.ok) return this.reprompt(running, parsed.error);
    if (step.expect === "point") {
      if (parsed.kind !== "point") {
        return this.reprompt(running, "点の座標を入力するか、図面をクリックしてください(例: 1000,500)");
      }
      this.lastPoint = parsed.point;
      return this.advance(running.name, step.onInput({ kind: "point", point: parsed.point }));
    }
    // step.expect === "distance": 数値だけの入力を受け取る
    if (parsed.kind !== "distance") return this.reprompt(running, "長さを数値で入力してください(例: 500)");
    return this.advance(running.name, step.onInput({ kind: "distance", value: parsed.value }));
  }

  /** 入力が正しくなかったとき。理由を表示して、同じ段階のまま待つ */
  private reprompt(running: Running<R>, error: string): SessionResult<R> {
    return {
      messages: [error, `${running.name} ${running.step.prompt}`],
      requests: [],
      active: this.snapshot(),
    };
  }

  /** 段階の結果を反映する。次の入力を待つなら状態を保ち、終わったなら実行中を外す */
  private advance(name: string, step: CommandStep<R>): SessionResult<R> {
    const messages = [...(step.messages ?? [])];
    const requests = [...(step.requests ?? [])];
    if (step.type === "done") {
      this.running = null;
      return { messages, requests, active: null };
    }
    this.running = { name, step };
    // 段階が相対座標(@)の基準点を決めているとき(例: 「1点戻す」で、直前の点が変わった)は、それに合わせる
    if (step.basePoint !== undefined) this.lastPoint = step.basePoint;
    messages.push(`${name} ${step.prompt}`);
    return { messages, requests, active: this.snapshot() };
  }

  private snapshot(): ActiveCommand | null {
    if (this.running === null) return null;
    const { name, step } = this.running;
    return {
      name,
      prompt: step.prompt,
      expect: step.expect,
      keywords: step.expect === "text" ? [] : (step.keywords ?? []),
      acceptsEnter: step.expect === "text" ? false : step.acceptsEnter === true,
      hasPreview: step.expect === "point" && step.preview !== undefined,
      hasPendingChanges: step.pending === true,
    };
  }

  private empty(): SessionResult<R> {
    return { messages: [], requests: [], active: this.snapshot() };
  }
}
