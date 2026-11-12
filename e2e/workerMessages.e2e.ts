// ワーカーから届くメッセージの順番を、テストから決めて確かめるE2Eテスト(Phase 1b、Codex指摘7)。
// 本物のワーカーでは、遅れて届くメッセージのタイミングを再現できないため、ページ内のWorkerを操作できる偽物に差し替える。
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

type FakeWorkerState = { terminated: boolean; requests: number };

declare global {
  interface Window {
    __fakeWorkers: Array<{
      state: FakeWorkerState;
      emit: (message: unknown) => void;
      emitError: () => void;
    }>;
  }
}

/** ページ内のWorkerを、メッセージをテストから送れる偽物に差し替える */
async function installFakeWorker(page: Page) {
  await page.addInitScript(() => {
    window.__fakeWorkers = [];
    class FakeWorker {
      onmessage: ((event: { data: unknown }) => void) | null = null;
      onerror: ((event: { message: string }) => void) | null = null;
      private readonly state = { terminated: false, requests: 0 };
      constructor() {
        window.__fakeWorkers.push({
          state: this.state,
          emit: (message: unknown) => this.onmessage?.({ data: message }),
          emitError: () => this.onerror?.({ message: "fake crash" }),
        });
      }
      postMessage() {
        this.state.requests++;
      }
      terminate() {
        this.state.terminated = true;
      }
    }
    (window as unknown as { Worker: unknown }).Worker = FakeWorker;
  });
}

/** 図面のデータ(success)。layerNameで、どの図面のものかを見分ける */
async function emitSuccess(page: Page, workerIndex: number, layerName: string) {
  await page.evaluate(
    ([i, name]) => {
      window.__fakeWorkers[i as number].emit({
        type: "success",
        elapsedMs: 1,
        cadModel: {
          entities: [],
          entityBounds: new Float64Array(0),
          layers: [{ name, color: "#ffffff", visible: true }],
          pointStyle: { mode: 0, size: 0 },
          bounds: null,
          stats: { totalEntityCount: 0, supportedEntityCount: 0, unsupportedEntityCount: 0, unsupportedBreakdown: {} },
        },
      });
    },
    [workerIndex, layerName] as const,
  );
}

/** 元データ(source)。recordCountで、どの図面のものかを見分ける */
async function emitSource(page: Page, workerIndex: number, recordCount: number) {
  await page.evaluate(
    ([i, count]) => {
      window.__fakeWorkers[i as number].emit({
        type: "source",
        source: {
          bytes: new Uint8Array(10),
          index: { recordCount: count },
          recordOfParserEntity: new Int32Array(0),
          origin: { parserIndex: new Int32Array(0), nested: new Uint8Array(0) },
          classification: { editable: count, readOnly: 0, unsupported: 0, unsupportedByType: {} },
        },
      });
    },
    [workerIndex, recordCount] as const,
  );
}

const workerState = (page: Page, i: number) => page.evaluate((index) => window.__fakeWorkers[index].state, i);
const overlay = (page: Page) => page.locator(".performance-overlay");

async function chooseFile(page: Page, name: string) {
  await page.locator('input[type="file"]').setInputFiles({ name, mimeType: "application/dxf", buffer: Buffer.from("0\nEOF\n", "utf8") });
}

test.describe("messages from the DXF worker (controlled order)", () => {
  test.beforeEach(async ({ page }) => {
    await installFakeWorker(page);
    await page.goto("/");
  });

  test("ignores late messages from a worker that was replaced by opening another drawing", async ({ page }) => {
    await chooseFile(page, "first.dxf");
    await expect.poll(() => page.evaluate(() => window.__fakeWorkers.length)).toBe(1);
    await chooseFile(page, "second.dxf"); // 1つ目の読み込みの途中で、2つ目を選ぶ
    await expect.poll(() => page.evaluate(() => window.__fakeWorkers.length)).toBe(2);
    expect((await workerState(page, 0)).terminated).toBe(true);

    // 1つ目のワーカーから、遅れて図面のデータが届いても、画面には出ない
    await emitSuccess(page, 0, "FIRST_LAYER");
    await page.waitForTimeout(100);
    await expect(page.locator(".start-screen")).toBeVisible();

    // 2つ目の図面のデータが届く
    await emitSuccess(page, 1, "SECOND_LAYER");
    await expect(page.locator(".status-bar")).toContainText("second.dxf");
    await expect(page.locator(".layer-panel")).toContainText("SECOND_LAYER");

    // 1つ目のワーカーから、遅れて元データが届いても、受け付けない。2つ目のワーカーも止めない
    await emitSource(page, 0, 111);
    await page.waitForTimeout(100);
    await expect(overlay(page)).toContainText("Source: -");
    expect((await workerState(page, 1)).terminated).toBe(false);

    // 2つ目の元データが届くと、2つ目の図面の元データとして保持し、2つ目のワーカーを止める
    await emitSource(page, 1, 222);
    await expect(overlay(page)).toContainText("222 rec");
    expect((await workerState(page, 1)).terminated).toBe(true);
  });

  test("ignores a late source after the drawing was closed", async ({ page }) => {
    await chooseFile(page, "first.dxf");
    await expect.poll(() => page.evaluate(() => window.__fakeWorkers.length)).toBe(1);
    await emitSuccess(page, 0, "FIRST_LAYER");
    await expect(page.locator(".status-bar")).toContainText("first.dxf");

    await page.getByRole("button", { name: "図面を閉じる" }).click();
    await expect(page.locator(".start-screen")).toBeVisible();
    expect((await workerState(page, 0)).terminated).toBe(true);

    // 閉じた後に届いた元データは捨てる。次に開いた図面に混ざらない
    await emitSource(page, 0, 111);
    await chooseFile(page, "second.dxf");
    await expect.poll(() => page.evaluate(() => window.__fakeWorkers.length)).toBe(2);
    await emitSuccess(page, 1, "SECOND_LAYER");
    await expect(page.locator(".status-bar")).toContainText("second.dxf");
    await expect(overlay(page)).toContainText("Source: -");
    await emitSource(page, 1, 222);
    await expect(overlay(page)).toContainText("222 rec");
  });

  test("keeps showing the drawing when the worker fails after sending it (while building the source)", async ({ page }) => {
    await chooseFile(page, "first.dxf");
    await expect.poll(() => page.evaluate(() => window.__fakeWorkers.length)).toBe(1);
    await emitSuccess(page, 0, "FIRST_LAYER");
    await expect(page.locator(".status-bar")).toContainText("first.dxf");

    await page.evaluate(() => window.__fakeWorkers[0].emitError());
    await page.waitForTimeout(100);
    // 図面は表示されたまま。元データは無い(=編集不可)
    await expect(page.locator(".status-bar")).toContainText("first.dxf");
    await expect(page.locator(".start-screen")).toHaveCount(0);
    await expect(overlay(page)).toContainText("Source: -");
    expect((await workerState(page, 0)).terminated).toBe(true);
  });

  test("treats a missing source (null) as read only and still shows the drawing", async ({ page }) => {
    await chooseFile(page, "first.dxf");
    await expect.poll(() => page.evaluate(() => window.__fakeWorkers.length)).toBe(1);
    await emitSuccess(page, 0, "FIRST_LAYER");
    await page.evaluate(() => window.__fakeWorkers[0].emit({ type: "source", source: null }));
    await expect(page.locator(".status-bar")).toContainText("first.dxf");
    await expect(overlay(page)).toContainText("Source: -");
    expect((await workerState(page, 0)).terminated).toBe(true);
  });
});
