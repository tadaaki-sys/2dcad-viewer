// app/commands のテスト用の補助(本番のコードからは読み込めない)
import { DEFAULT_DIMENSION_STYLE } from "../../core/dimension/dimensionStyle";
import { DEFAULT_TEXT_STYLE } from "../../core/text/textStyle";
import { NO_EDITING } from "./types";
import type { AppCommandContext } from "./types";

/** テスト用のコンテキスト。図面が開いていて、レイヤー "0"(白)に描ける。IDは n0, n1, ... と払い出す */
export function makeContext(overrides: Partial<AppCommandContext> = {}): AppCommandContext & { allocated: string[] } {
  const allocated: string[] = [];
  let counter = 0;
  return {
    isDocumentOpen: true,
    drawTarget: { ok: true, layer: "0", color: "#ffffff" },
    editing: NO_EDITING,
    textStyle: DEFAULT_TEXT_STYLE,
    dimensionStyle: DEFAULT_DIMENSION_STYLE,
    layerTarget: (name) => (name === "0" ? { ok: true, layer: "0", color: "#ffffff" } : { ok: false, reason: `レイヤー「${name}」がありません` }),
    allocateEntityId: () => {
      const id = `n${counter++}`;
      allocated.push(id);
      return id;
    },
    ...overrides,
    allocated,
  };
}
