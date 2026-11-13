// アプリに最初から入っているコマンド。React にも画面にも依存しない(依頼を返すだけ)。
// 依頼(AppRequest)を実際に実行するのは画面の側(App.tsx)。
import { CommandRegistry, CommandSession } from "../../core/commands";
import { DRAW_COMMANDS } from "./drawCommands";
import { formatCoordinate } from "./format";
import { NO_DOCUMENT_MESSAGE } from "./types";
import type { AppCommandContext, AppCommandDefinition, AppCommandSession, AppRequest } from "./types";

// 画面の側や、テストが、ここから型と座標の表示を使えるようにする
export { formatCoordinate } from "./format";
export type {
  AppCommandContext,
  AppCommandDefinition,
  AppCommandSession,
  AppRequest,
  DrawTarget,
} from "./types";

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

export const BUILTIN_COMMANDS: readonly AppCommandDefinition[] = [
  { name: "OPEN", description: "図面を開く", start: () => ({ type: "done", requests: [{ type: "openFile" }] }) },
  documentCommand("CLOSE", [], "図面を閉じる", { type: "closeDocument" }),
  documentCommand("FIT", ["F"], "全体表示", { type: "fitDrawing" }),
  documentCommand("MEASURE", ["M", "DI"], "測定の開始・終了", { type: "toggleMeasurement" }),
  { name: "FULLSCREEN", description: "全画面表示の切り替え", start: () => ({ type: "done", requests: [{ type: "toggleFullscreen" }] }) },
  documentCommand("UNDO", ["U"], "元に戻す", { type: "undo" }),
  documentCommand("REDO", [], "やり直し", { type: "redo" }),
  ...DRAW_COMMANDS,
  documentCommand("TOFRONT", [], "選択中の新しい図形を最前面へ", { type: "reorder", direction: "front" }),
  documentCommand("TOBACK", [], "選択中の新しい図形を最背面へ", { type: "reorder", direction: "back" }),
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

export type AppCommands = {
  session: AppCommandSession;
  /** アプリの状態が変わったときに知らせる(次にコマンドを始めるときから反映される) */
  setContext: (context: AppCommandContext) => void;
};

/** 画面の側が使う入口。アプリの状態は setContext で更新する */
export function createAppCommands(initialContext: AppCommandContext): AppCommands {
  let context = initialContext;
  return {
    session: createAppCommandSession(() => context),
    setContext: (next) => {
      context = next;
    },
  };
}
