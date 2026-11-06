// 回帰テストをまとめて実行する: 型チェック → 単体・回帰(実図面と性能を含む) → E2E。
// 1つでも失敗したら止まる。実図面は regression-local/manifest.json に登録したものだけを使う(git管理外)。
import { spawnSync } from "node:child_process";

function run(label, command, args, env = {}) {
  console.log(`\n=== ${label} ===`);
  const result = spawnSync(command, args, { stdio: "inherit", shell: true, env: { ...process.env, ...env } });
  if (result.status !== 0) {
    console.error(`\n[regression] 失敗: ${label}`);
    process.exit(result.status ?? 1);
  }
}

run("型チェック(アプリ)", "npx", ["tsc", "-b"]);
run("型チェック(E2E)", "npx", ["tsc", "-p", "tsconfig.e2e.json"]);
run("単体・回帰テスト(実図面と性能を含む)", "npx", ["vitest", "run"], { CAD_REGRESSION_REAL: "1" });
run("E2E(ブラウザ操作)", "npx", ["playwright", "test"]);
console.log("\n[regression] すべて成功");
