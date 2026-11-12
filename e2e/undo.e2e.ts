// 元に戻す・やり直し(Phase 3)のE2Eテスト。
// 図面を編集するコマンドはまだ無いので、開発サーバーだけで使える入口(window.__cadDev、src/devHooks.ts)で図形を変更する。
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { factoryLayoutDxf } from "../src/regression/fixtures";
import { calibrate, hasHueNear, openDrawing, propertyPanel } from "./helpers";
import type { Mapping, Pt } from "./helpers";
// window.__cadDev の型を取り込む(読み込むだけで、実行はしない)
import type {} from "../src/devHooks";

const MAGENTA: [number, number, number] = [255, 0, 255];
const RED: [number, number, number] = [255, 0, 0];

const log = (page: Page) => page.getByTestId("command-line-log");
const input = (page: Page) => page.getByTestId("command-line-input");

/** 図面の準備(元データの読み込み)が終わって、編集できるまで待つ */
async function waitUntilEditable(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__cadDev?.ready() === true, undefined, { timeout: 30_000 });
}

async function openEditable(page: Page): Promise<Mapping> {
  await openDrawing(page, "factory.dxf", factoryLayoutDxf());
  await waitUntilEditable(page);
  return calibrate(page);
}

/** 新しい線(マゼンタ)を追加して、IDを返す。見本図面の何もない場所(y=50)に置く */
async function addLine(page: Page, x1 = 550, x2 = 950, y = 50): Promise<string> {
  return page.evaluate(([a, b, c]) => window.__cadDev!.addLine(a, c, b, c), [x1, x2, y]);
}

const midOf = (mapping: Mapping, x1 = 550, x2 = 950, y = 50): Pt => mapping.toPage({ x: (x1 + x2) / 2, y });

async function expectDrawn(page: Page, at: Pt, color: [number, number, number], drawn: boolean): Promise<void> {
  await expect.poll(() => hasHueNear(page, at, color), { timeout: 5_000 }).toBe(drawn);
}

test.describe("shortcuts with an empty history", () => {
  test("Ctrl+Z and Ctrl+Y say there is nothing to do, and the drawing stays as it is", async ({ page }) => {
    const mapping = await openEditable(page);
    await page.keyboard.press("Control+z");
    await expect(log(page)).toContainText("元に戻す操作がありません");
    await page.keyboard.press("Control+y");
    await expect(log(page)).toContainText("やり直す操作がありません");
    await page.keyboard.press("Control+Shift+z");
    await expect(log(page)).toContainText("やり直す操作がありません");
    await expectDrawn(page, mapping.toPage({ x: 0, y: 300 }), RED, true); // 外枠の左辺
  });

  test("the UNDO and REDO commands say the same", async ({ page }) => {
    await openEditable(page);
    await input(page).focus();
    await input(page).fill("undo");
    await page.keyboard.press("Enter");
    await expect(log(page)).toContainText("元に戻す操作がありません");
    await input(page).fill("redo");
    await page.keyboard.press("Enter");
    await expect(log(page)).toContainText("やり直す操作がありません");
  });
});

test.describe("add, undo and redo", () => {
  test("an added line appears, Ctrl+Z removes it, Ctrl+Y and Ctrl+Shift+Z bring it back", async ({ page }) => {
    const mapping = await openEditable(page);
    const mid = midOf(mapping);
    await expectDrawn(page, mid, MAGENTA, false);

    await addLine(page);
    await expectDrawn(page, mid, MAGENTA, true);

    await page.keyboard.press("Control+z");
    await expect(log(page)).toContainText("元に戻しました: 線を追加");
    await expectDrawn(page, mid, MAGENTA, false);

    await page.keyboard.press("Control+y");
    await expect(log(page)).toContainText("やり直しました: 線を追加");
    await expectDrawn(page, mid, MAGENTA, true);

    await page.keyboard.press("Control+z");
    await expectDrawn(page, mid, MAGENTA, false);
    await page.keyboard.press("Control+Shift+z");
    await expectDrawn(page, mid, MAGENTA, true);
  });

  test("the view does not move or refit on a change, Undo or Redo", async ({ page }) => {
    const mapping = await openEditable(page);
    // 拡大・移動してから編集する(全体表示に戻ってしまわないこと)
    await page.mouse.wheel(0, -500);
    await page.waitForTimeout(150);
    const zoomed = await calibrate(page);
    expect(zoomed.mmPerPx).toBeLessThan(mapping.mmPerPx);
    const probe = { x: 500, y: 300 };
    const before = zoomed.toPage(probe);

    const same = async () => {
      const now = await calibrate(page);
      expect(now.mmPerPx).toBeCloseTo(zoomed.mmPerPx, 3);
      const p = now.toPage(probe);
      expect(Math.abs(p.x - before.x)).toBeLessThan(1);
      expect(Math.abs(p.y - before.y)).toBeLessThan(1);
    };
    await addLine(page);
    await page.waitForTimeout(150);
    await same();
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(150);
    await same();
    await page.keyboard.press("Control+y");
    await page.waitForTimeout(150);
    await same();
  });

  test("UNDO and REDO typed in the command line work like the shortcuts (u is an alias)", async ({ page }) => {
    const mapping = await openEditable(page);
    const mid = midOf(mapping);
    await addLine(page);
    await expectDrawn(page, mid, MAGENTA, true);
    await input(page).focus();
    await input(page).fill("u");
    await page.keyboard.press("Enter");
    await expectDrawn(page, mid, MAGENTA, false);
    await input(page).fill("redo");
    await page.keyboard.press("Enter");
    await expectDrawn(page, mid, MAGENTA, true);
  });

  test("several steps are undone one at a time, newest first", async ({ page }) => {
    const mapping = await openEditable(page);
    await addLine(page, 550, 950, 50);
    await addLine(page, 550, 950, 30);
    const lower = midOf(mapping, 550, 950, 30);
    const upper = midOf(mapping, 550, 950, 50);
    await expectDrawn(page, lower, MAGENTA, true);
    await expectDrawn(page, upper, MAGENTA, true);
    await page.keyboard.press("Control+z");
    await expectDrawn(page, lower, MAGENTA, false);
    await expectDrawn(page, upper, MAGENTA, true);
    await page.keyboard.press("Control+z");
    await expectDrawn(page, upper, MAGENTA, false);
    await page.keyboard.press("Control+z");
    await expect(log(page)).toContainText("元に戻す操作がありません");
  });
});

test.describe("remove and move (imported drawing entities)", () => {
  test("removing an imported entity hides it, and Undo restores it in place", async ({ page }) => {
    const mapping = await openEditable(page);
    const wallLeft = mapping.toPage({ x: 0, y: 300 }); // 外枠(WALL・赤)の左辺
    await expectDrawn(page, wallLeft, RED, true);
    const count = await page.evaluate(() => window.__cadDev!.entityCount());

    await page.evaluate(() => window.__cadDev!.removeEntity("e0")); // 見本図面の最初の図形 = 外枠
    await expectDrawn(page, wallLeft, RED, false);
    expect(await page.evaluate(() => window.__cadDev!.entityCount())).toBe(count - 1);

    await page.keyboard.press("Control+z");
    await expectDrawn(page, wallLeft, RED, true);
    expect(await page.evaluate(() => window.__cadDev!.entityCount())).toBe(count);
  });

  test("moving a line (replace) shows it at the new place, and Undo puts it back", async ({ page }) => {
    const mapping = await openEditable(page);
    const id = await addLine(page, 550, 950, 50);
    const oldMid = midOf(mapping, 550, 950, 50);
    const newMid = midOf(mapping, 550, 950, 30);
    await page.evaluate((lineId) => window.__cadDev!.moveLine(lineId, 550, 30, 950, 30), id);
    await expectDrawn(page, newMid, MAGENTA, true);
    await expectDrawn(page, oldMid, MAGENTA, false);

    await page.keyboard.press("Control+z");
    await expect(log(page)).toContainText("元に戻しました: 線を移動");
    await expectDrawn(page, oldMid, MAGENTA, true);
    await expectDrawn(page, newMid, MAGENTA, false);
  });
});

test.describe("selection", () => {
  test("an entity that disappears through Undo is dropped from the selection", async ({ page }) => {
    const mapping = await openEditable(page);
    await addLine(page);
    const mid = midOf(mapping);
    await expectDrawn(page, mid, MAGENTA, true);
    await page.mouse.click(mid.x, mid.y);
    await expect(propertyPanel(page)).toContainText("LINE");
    await page.keyboard.press("Control+z");
    await expect(propertyPanel(page)).toContainText("選択なし");
    // 戻した図形が、やり直しで再び現れても、選択には戻らない(消えたときに選択から外れている)
    await page.keyboard.press("Control+y");
    await expectDrawn(page, mid, MAGENTA, true);
    await expect(propertyPanel(page)).toContainText("選択なし");
  });

  test("an unrelated selection is kept through Undo", async ({ page }) => {
    const mapping = await openEditable(page);
    const circle = mapping.toPage({ x: 400, y: 300 });
    await page.mouse.click(circle.x, circle.y);
    await expect(propertyPanel(page)).toContainText("CIRCLE");
    await addLine(page);
    await page.keyboard.press("Control+z");
    await expect(log(page)).toContainText("元に戻しました");
    await expect(propertyPanel(page)).toContainText("CIRCLE");
  });
});

test.describe("keys while typing, and while a command waits", () => {
  test("Ctrl+Z inside the command line does not undo the drawing", async ({ page }) => {
    const mapping = await openEditable(page);
    const mid = midOf(mapping);
    await addLine(page);
    await expectDrawn(page, mid, MAGENTA, true);
    await input(page).focus();
    await page.keyboard.type("abc");
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(150);
    await expectDrawn(page, mid, MAGENTA, true);
    expect(await page.evaluate(() => window.__cadDev!.history().canUndo)).toBe(true);
  });

  test("Ctrl+Z is ignored while a command waits for a point, and works after Esc", async ({ page }) => {
    const mapping = await openEditable(page);
    const mid = midOf(mapping);
    await addLine(page);
    await input(page).focus();
    await input(page).fill("id");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("command-line-label")).toHaveText("ID:");
    await page.locator(".status-bar").click(); // 入力欄の外へ
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(150);
    await expectDrawn(page, mid, MAGENTA, true);
    await expect(page.getByTestId("command-line-label")).toHaveText("ID:");

    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+z");
    await expectDrawn(page, mid, MAGENTA, false);
  });
});

test.describe("closing and reopening", () => {
  test("the history is dropped when another drawing is opened", async ({ page }) => {
    await openEditable(page);
    await addLine(page);
    expect(await page.evaluate(() => window.__cadDev!.history().canUndo)).toBe(true);

    await page.getByRole("button", { name: "図面を閉じる" }).click();
    await expect(page.locator(".start-screen")).toBeVisible();
    await page.locator('input[type="file"]').setInputFiles({ name: "again.dxf", mimeType: "application/dxf", buffer: Buffer.from(factoryLayoutDxf(), "utf8") });
    await expect(page.locator(".status-bar")).toContainText("again.dxf", { timeout: 30_000 });
    await waitUntilEditable(page);

    expect(await page.evaluate(() => window.__cadDev!.history().canUndo)).toBe(false);
    await page.keyboard.press("Control+z");
    await expect(log(page)).toContainText("元に戻す操作がありません");
  });
});
