// アプリに最初から入っているコマンド。React にも画面にも依存しない(依頼を返すだけ)。
// 依頼(AppRequest)を実際に実行するのは画面の側(App.tsx)。
import { CommandRegistry, CommandSession } from "../../core/commands";
import type { CommandDefinition } from "../../core/commands";

/** コマンドが、アプリに頼むこと */
export type AppRequest =
  | { type: "openFile" }
  | { type: "closeDocument" }
  | { type: "fitDrawing" }
  | { type: "toggleMeasurement" }
  | { type: "toggleFullscreen" };

/** コマンドを始める時点のアプリの状態 */
export type AppCommandContext = {
  isDocumentOpen: boolean;
};

export type AppCommandDefinition = CommandDefinition<AppRequest, AppCommandContext>;
export type AppCommandSession = CommandSession<AppRequest, AppCommandContext>;

const NO_DOCUMENT_MESSAGE = "図面が開かれていません";

/** 図面が開いているときだけ、依頼を返すコマンドを作る */
function documentCommand(
  name: string,
  aliases: readonly string[],
  description: string,
  request: AppRequest,
): AppCommandDefinition {
  return {
    name,
    aliases,
    description,
    start: (context) =>
      context.isDocumentOpen
        ? { type: "done", requests: [request] }
        : { type: "done", messages: [NO_DOCUMENT_MESSAGE] },
  };
}

/** 座標の表示(小数点以下3桁。-0 は 0 と表示する) */
export function formatCoordinate(value: number): string {
  const text = value.toFixed(3);
  return text === "-0.000" ? "0.000" : text;
}

export const BUILTIN_COMMANDS: readonly AppCommandDefinition[] = [
  { name: "OPEN", description: "図面を開く", start: () => ({ type: "done", requests: [{ type: "openFile" }] }) },
  documentCommand("CLOSE", [], "図面を閉じる", { type: "closeDocument" }),
  documentCommand("FIT", ["F"], "全体表示", { type: "fitDrawing" }),
  documentCommand("MEASURE", ["M", "DI"], "測定の開始・終了", { type: "toggleMeasurement" }),
  { name: "FULLSCREEN", description: "全画面表示の切り替え", start: () => ({ type: "done", requests: [{ type: "toggleFullscreen" }] }) },
  {
    // 点の指示(図面のクリックと座標の入力)の動作確認用のコマンド。図面は変更しない
    name: "ID",
    description: "点の座標を表示",
    start: (context) =>
      context.isDocumentOpen
        ? {
            type: "prompt",
            prompt: "点を指示してください",
            expect: "point",
            onInput: (input) =>
              input.kind === "point"
                ? { type: "done", messages: [`X = ${formatCoordinate(input.point.x)}, Y = ${formatCoordinate(input.point.y)}`] }
                : { type: "done" },
          }
        : { type: "done", messages: [NO_DOCUMENT_MESSAGE] },
  },
];

export function createAppCommandRegistry(): CommandRegistry<AppRequest, AppCommandContext> {
  const registry = new CommandRegistry<AppRequest, AppCommandContext>();
  for (const definition of BUILTIN_COMMANDS) registry.register(definition);
  return registry;
}

/** コマンドの実行の状態を作る。getContext は、コマンドを始めるたびに、そのときのアプリの状態を返す */
export function createAppCommandSession(getContext: () => AppCommandContext): AppCommandSession {
  return new CommandSession(createAppCommandRegistry(), getContext);
}
