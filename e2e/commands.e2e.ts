// コマンドの仕組み(Phase 2)のE2Eテスト。コマンドライン、図面のクリックでの点の指示、ショートカットとの両立を確認する。
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { factoryLayoutDxf } from "../src/regression/fixtures";
import { calibrate, openDrawing, propertyPanel } from "./helpers";

const input = (page: Page) => page.getByTestId("command-line-input");
const log = (page: Page) => page.getByTestId("command-line-log");
const label = (page: Page) => page.getByTestId("command-line-label");
const measureButton = (page: Page) => page.getByRole("button", { name: "測定" });

/** 入力欄にフォーカスして、文字を入力しEnterで実行する */
async function runInCommandLine(page: Page, text: string): Promise<void> {
  await input(page).focus();
  await input(page).fill(text);
  await page.keyboard.press("Enter");
}

test.describe("command line", () => {
  test("is shown under the drawing, and the Enter key moves the focus into it", async ({ page }) => {
    await openDrawing(page, "factory.dxf", factoryLayoutDxf());
    await expect(page.getByTestId("command-line")).toBeVisible();
    await expect(input(page)).not.toBeFocused();
    await page.keyboard.press("Enter");
    await expect(input(page)).toBeFocused();
  });

  test("FIT in the command line does the same as the toolbar button", async ({ page }) => {
    await openDrawing(page, "factory.dxf", factoryLayoutDxf());
    const initial = await calibrate(page);
    await page.mouse.wheel(0, -600);
    await page.waitForTimeout(120);
    expect((await calibrate(page)).mmPerPx).toBeLessThan(initial.mmPerPx);

    await page.keyboard.press("Enter");
    await page.keyboard.type("fit");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(120);
    expect((await calibrate(page)).mmPerPx).toBeCloseTo(initial.mmPerPx, 2);
    // 入力した文字が、履歴として表示に残る
    await expect(log(page)).toContainText("> fit");
  });

  test("MEASURE toggles the measurement mode, like the button and the M key", async ({ page }) => {
    await openDrawing(page, "factory.dxf", factoryLayoutDxf());
    await runInCommandLine(page, "measure");
    await expect(measureButton(page)).toHaveClass(/toolbar__button--active/);
    await runInCommandLine(page, "m");
    await expect(measureButton(page)).not.toHaveClass(/toolbar__button--active/);
    await runInCommandLine(page, "di");
    await expect(measureButton(page)).toHaveClass(/toolbar__button--active/);
  });

  test("reports an unknown command", async ({ page }) => {
    await openDrawing(page, "factory.dxf", factoryLayoutDxf());
    await runInCommandLine(page, "zzz");
    await expect(log(page)).toContainText("不明なコマンドです: zzz");
  });

  test("walks back through the history with the up and down keys", async ({ page }) => {
    await openDrawing(page, "factory.dxf", factoryLayoutDxf());
    await runInCommandLine(page, "zzz");
    await runInCommandLine(page, "yyy");
    await input(page).fill("draft");
    await page.keyboard.press("ArrowUp");
    await expect(input(page)).toHaveValue("yyy");
    await page.keyboard.press("ArrowUp");
    await expect(input(page)).toHaveValue("zzz");
    await page.keyboard.press("ArrowDown");
    await expect(input(page)).toHaveValue("yyy");
    await page.keyboard.press("ArrowDown");
    await expect(input(page)).toHaveValue("draft");
  });
});

test.describe("shortcuts and typing", () => {
  test("keys typed in the command line are not treated as shortcuts (f, m)", async ({ page }) => {
    await openDrawing(page, "factory.dxf", factoryLayoutDxf());
    const initial = await calibrate(page);
    await page.mouse.wheel(0, -600);
    await page.waitForTimeout(120);
    const zoomed = (await calibrate(page)).mmPerPx;
    expect(zoomed).toBeLessThan(initial.mmPerPx);

    await input(page).focus();
    await page.keyboard.type("fm");
    await expect(input(page)).toHaveValue("fm");
    await page.waitForTimeout(120);
    expect((await calibrate(page)).mmPerPx).toBeCloseTo(zoomed, 2); // 全体表示されていない
    await expect(measureButton(page)).not.toHaveClass(/toolbar__button--active/); // 測定にもなっていない
  });

  test("Backspace typed in the command line does not delete a selected measurement", async ({ page }) => {
    await openDrawing(page, "factory.dxf", factoryLayoutDxf());
    const mapping = await calibrate(page);
    await page.keyboard.press("m");
    const a = mapping.toPage({ x: 4, y: 4 });
    const b = mapping.toPage({ x: 996, y: 596 });
    await page.mouse.click(a.x, a.y);
    await page.mouse.click(b.x, b.y);
    await expect(page.locator(".measurement-panel")).toContainText("D: 1166.2 mm");
    await page.getByRole("button", { name: "測定" }).click(); // 測定モードを終える
    // 測定線の上をクリックして選択
    const mid = mapping.toPage({ x: 500, y: 300 });
    await page.mouse.click(mid.x, mid.y);
    await input(page).focus();
    await page.keyboard.type("ab");
    await page.keyboard.press("Backspace");
    await expect(input(page)).toHaveValue("a");
    await expect(page.locator(".measurement-panel")).toContainText("D: 1166.2 mm");
  });

  test("the toolbar, F and M shortcuts still work as before", async ({ page }) => {
    await openDrawing(page, "factory.dxf", factoryLayoutDxf());
    await page.keyboard.press("m");
    await expect(measureButton(page)).toHaveClass(/toolbar__button--active/);
    await page.keyboard.press("m");
    await expect(measureButton(page)).not.toHaveClass(/toolbar__button--active/);
    await measureButton(page).click();
    await expect(measureButton(page)).toHaveClass(/toolbar__button--active/);
    await page.keyboard.press("Escape");
    await expect(measureButton(page)).not.toHaveClass(/toolbar__button--active/);
  });
});

test.describe("point input (ID command)", () => {
  test("takes a clicked point, snapped like the measurement, and shows its coordinates", async ({ page }) => {
    await openDrawing(page, "factory.dxf", factoryLayoutDxf());
    const mapping = await calibrate(page);
    await runInCommandLine(page, "id");
    await expect(label(page)).toHaveText("ID:");
    await expect(log(page)).toContainText("ID 点を指示してください");

    // 外枠の右上角(1000,600)の近くをクリック → 端点に吸い付く
    const nearCorner = mapping.toPage({ x: 996, y: 596 });
    await page.mouse.click(nearCorner.x, nearCorner.y);
    await expect(log(page)).toContainText("X = 1000.000, Y = 600.000");
    await expect(label(page)).toHaveText("コマンド:");
    // 終わったら入力欄から外れ、ショートカットが使える
    await expect(input(page)).not.toBeFocused();
    // クリックした点は、図形の選択にはならない
    await expect(propertyPanel(page)).toContainText("選択なし");
  });

  test("takes typed absolute, relative and polar coordinates", async ({ page }) => {
    await openDrawing(page, "factory.dxf", factoryLayoutDxf());
    await runInCommandLine(page, "id");
    await runInCommandLine(page, "1000,500");
    await expect(log(page)).toContainText("X = 1000.000, Y = 500.000");
    await runInCommandLine(page, "id");
    await runInCommandLine(page, "@500,0");
    await expect(log(page)).toContainText("X = 1500.000, Y = 500.000");
    await runInCommandLine(page, "id");
    await runInCommandLine(page, "＠１００＜９０"); // 全角でも入力できる
    await expect(log(page)).toContainText("X = 1500.000, Y = 600.000");
  });

  test("explains an invalid coordinate and keeps waiting", async ({ page }) => {
    await openDrawing(page, "factory.dxf", factoryLayoutDxf());
    await runInCommandLine(page, "id");
    await runInCommandLine(page, "1,2,3");
    await expect(log(page)).toContainText("座標は「X,Y」の形で入力してください");
    await expect(label(page)).toHaveText("ID:");
    await runInCommandLine(page, "10,20");
    await expect(log(page)).toContainText("X = 10.000, Y = 20.000");
  });

  test("a click is not taken by a command that is not waiting for a point (selection works)", async ({ page }) => {
    await openDrawing(page, "factory.dxf", factoryLayoutDxf());
    const mapping = await calibrate(page);
    const circle = mapping.toPage({ x: 400, y: 300 });
    await page.mouse.click(circle.x, circle.y);
    await expect(propertyPanel(page)).toContainText("CIRCLE");
  });

  test("while waiting for a point, a click does not select and does not start a measurement", async ({ page }) => {
    await openDrawing(page, "factory.dxf", factoryLayoutDxf());
    const mapping = await calibrate(page);
    await page.keyboard.press("m"); // 測定モードのまま
    await runInCommandLine(page, "id");
    const circle = mapping.toPage({ x: 400, y: 300 });
    await page.mouse.click(circle.x, circle.y);
    await expect(log(page)).toContainText("X = ");
    await expect(page.locator(".measurement-panel")).toContainText("測定結果なし");
    // コマンドが終わったら、測定が続く
    const a = mapping.toPage({ x: 4, y: 4 });
    const b = mapping.toPage({ x: 996, y: 596 });
    await page.mouse.click(a.x, a.y);
    await page.mouse.click(b.x, b.y);
    await expect(page.locator(".measurement-panel")).toContainText("D: 1166.2 mm");
  });
});

test.describe("Escape", () => {
  test("in the command line, cancels only the running command and leaves the measurement mode", async ({ page }) => {
    await openDrawing(page, "factory.dxf", factoryLayoutDxf());
    await page.keyboard.press("m");
    await runInCommandLine(page, "id");
    await page.keyboard.press("Escape");
    await expect(log(page)).toContainText("ID を取り消しました");
    await expect(label(page)).toHaveText("コマンド:");
    await expect(measureButton(page)).toHaveClass(/toolbar__button--active/);
    await expect(input(page)).not.toBeFocused();
    // 次のEsc(入力欄の外)で、今までどおり測定を抜ける
    await page.keyboard.press("Escape");
    await expect(measureButton(page)).not.toHaveClass(/toolbar__button--active/);
  });

  test("outside the command line, cancels the running command first, then behaves as before", async ({ page }) => {
    await openDrawing(page, "factory.dxf", factoryLayoutDxf());
    await page.keyboard.press("m");
    await runInCommandLine(page, "id");
    await page.locator(".status-bar").click(); // 入力欄の外へ
    await expect(input(page)).not.toBeFocused();
    await page.keyboard.press("Escape");
    await expect(log(page)).toContainText("ID を取り消しました");
    await expect(measureButton(page)).toHaveClass(/toolbar__button--active/);
    await page.keyboard.press("Escape");
    await expect(measureButton(page)).not.toHaveClass(/toolbar__button--active/);
  });

  test("a toolbar command replaces a running command", async ({ page }) => {
    await openDrawing(page, "factory.dxf", factoryLayoutDxf());
    await runInCommandLine(page, "id");
    await page.getByRole("button", { name: "全体表示" }).click();
    await expect(log(page)).toContainText("ID を取り消しました");
    await expect(label(page)).toHaveText("コマンド:");
  });
});

test.describe("closing and reopening", () => {
  test("a command left running is dropped when the drawing is closed", async ({ page }) => {
    await openDrawing(page, "factory.dxf", factoryLayoutDxf());
    await runInCommandLine(page, "id");
    await runInCommandLine(page, "close"); // 実行中なので、入力として扱われる(エラーで待ち続ける)
    await expect(label(page)).toHaveText("ID:");
    await page.getByRole("button", { name: "図面を閉じる" }).click();
    await expect(page.locator(".start-screen")).toBeVisible();
    await page.locator('input[type="file"]').setInputFiles({ name: "again.dxf", mimeType: "application/dxf", buffer: Buffer.from(factoryLayoutDxf(), "utf8") });
    await expect(page.locator(".status-bar")).toContainText("again.dxf", { timeout: 30_000 });
    await expect(label(page)).toHaveText("コマンド:");
  });

  test("CLOSE in the command line closes the drawing", async ({ page }) => {
    await openDrawing(page, "factory.dxf", factoryLayoutDxf());
    await runInCommandLine(page, "close");
    await expect(page.locator(".start-screen")).toBeVisible();
  });
});
