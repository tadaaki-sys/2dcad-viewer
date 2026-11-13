// app/commands のテスト用の補助(本番のコードからは読み込めない)
import type { AppCommandContext } from "./types";

/** テスト用のコンテキスト。図面が開いていて、レイヤー "0"(白)に描ける。IDは n0, n1, ... と払い出す */
export function makeContext(overrides: Partial<AppCommandContext> = {}): AppCommandContext & { allocated: string[] } {
  const allocated: string[] = [];
  let counter = 0;
  return {
    isDocumentOpen: true,
    drawTarget: { ok: true, layer: "0", color: "#ffffff" },
    allocateEntityId: () => {
      const id = `n${counter++}`;
      allocated.push(id);
      return id;
    },
    ...overrides,
    allocated,
  };
}
