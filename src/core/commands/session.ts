// コマンドの実行の状態(いま、どのコマンドが、何の入力を待っているか)を持つ。
// コマンドラインの文字、図面のクリック、ツールバーのボタンは、どれもこの1つの入口から入る。
import type { Point2D } from "../../types/cad";
import { parseCoordinateInput } from "./coordinateInput";
import { normalizeCommandName } from "./registry";
import type { CommandRegistry, CommandStep, ExpectedInput, PromptStep } from "./registry";

/** 実行中のコマンドの状態(画面の表示用) */
export type ActiveCommand = {
  name: string;
  prompt: string;
  expect: ExpectedInput;
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
    if (running === null || running.step.expect !== "point") return this.empty();
    this.lastPoint = point;
    return this.advance(running.name, running.step.onInput({ kind: "point", point }));
  }

  /** 実行中のコマンドを取り消す(Esc)。実行中でなければ何もしない */
  cancel(): SessionResult<R> {
    if (this.running === null) return this.empty();
    const name = this.running.name;
    this.running = null;
    return { messages: [`${name} を取り消しました`], requests: [], active: null };
  }

  /** 名前を指定して、コマンドを始める(ツールバーやショートカット用)。実行中のコマンドは、取り消して置き換える */
  run(name: string): SessionResult<R> {
    const cancelMessages = this.running !== null ? this.cancel().messages : [];
    const result = this.startByName(name);
    return { ...result, messages: [...cancelMessages, ...result.messages] };
  }

  /** 図面を閉じた・開き直したときなどに、実行中のコマンドと直前の点を捨てる(メッセージは出さない) */
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
    const { expect, onInput } = running.step;
    if (expect === "text") return this.advance(running.name, onInput({ kind: "text", text }));

    // 点・距離を待っているときの、空のEnterは何もしない
    if (text.trim() === "") return this.empty();

    const parsed = parseCoordinateInput(text, this.lastPoint);
    if (!parsed.ok) return this.reprompt(running, parsed.error);
    if (expect === "point") {
      if (parsed.kind !== "point") {
        return this.reprompt(running, "点の座標を入力するか、図面をクリックしてください(例: 1000,500)");
      }
      this.lastPoint = parsed.point;
      return this.advance(running.name, onInput({ kind: "point", point: parsed.point }));
    }
    // expect === "distance": 数値だけの入力を受け取る
    if (parsed.kind !== "distance") return this.reprompt(running, "長さを数値で入力してください(例: 500)");
    return this.advance(running.name, onInput({ kind: "distance", value: parsed.value }));
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
    messages.push(`${name} ${step.prompt}`);
    return { messages, requests, active: this.snapshot() };
  }

  private snapshot(): ActiveCommand | null {
    return this.running === null
      ? null
      : { name: this.running.name, prompt: this.running.step.prompt, expect: this.running.step.expect };
  }

  private empty(): SessionResult<R> {
    return { messages: [], requests: [], active: this.snapshot() };
  }
}
