import { defineConfig } from "@playwright/test";

// E2E(ブラウザ操作)テストの設定。新しいブラウザはダウンロードせず、インストール済みのGoogle Chromeを使う。
// 開発サーバーは本番ビルドと別のポート(5174)で自動起動する(すでに起動していればそれを使う)。
export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.e2e.ts",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5174",
    channel: "chrome",
    headless: true,
    // このPCのChrome 156では、Playwright 1.64.1が標準で付ける起動オプションのどれかが原因で、
    // Chromeが起動直後に異常終了する(終了コード0xC0000005)。標準のオプションを使わず、必要なものだけを渡す。
    launchOptions: {
      ignoreDefaultArgs: true,
      args: [
        "--headless=new",
        "--remote-debugging-pipe",
        "--no-sandbox",
        "--disable-gpu",
        "--force-color-profile=srgb",
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
        "--disable-backgrounding-occluded-windows",
        "--hide-scrollbars",
        "--mute-audio",
        "--no-first-run",
        "--no-default-browser-check",
      ],
    },
    // 縦が短いほうが全体表示の倍率が縦で決まるため、表示範囲の確認がしやすい
    viewport: { width: 1600, height: 700 },
    trace: "off",
  },
  webServer: {
    command: "npm run dev -- --port 5174 --strictPort",
    url: "http://localhost:5174",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
