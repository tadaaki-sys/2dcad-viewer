// 作図(LINE・PLINE・RECT)、ゴム紐、描画順、現在のレイヤー、未保存の保護(Phase 4)のE2Eテスト。
// 描いた図形のIDは n0, n1, ... の順(開発用の入口 window.__cadDev で一覧を読む)。
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { factoryLayoutDxf } from "../src/regression/fixtures";
import { calibrate, hasHueNear, openDrawing, propertyPanel } from "./helpers";
import type { Mapping, Pt } from "./helpers";
// window.__cadDev の型を取り込む(読み込むだけで、実行はしない)
import type {} from "../src/devHooks";

const GREEN: [number, number, number] = [0, 255, 0];
const WHITE: [number, number, number] = [255, 255, 255];

const log = (page: Page) => page.getByTestId("command-line-log");
const input = (page: Page) => page.getByTestId("command-line-input");
const label = (page: Page) => page.getByTestId("command-line-label");
const toolbarButton = (page: Page, name: string) => page.locator(".toolbar").getByRole("button", { name, exact: true });
const entityCount = (page: Page) => page.evaluate(() => window.__cadDev!.entityCount());
const entityOrder = (page: Page) => page.evaluate(() => window.__cadDev!.entityOrder());

async function openEditable(page: Page): Promise<Mapping> {
  await openDrawing(page, "factory.dxf", factoryLayoutDxf());
  await page.waitForFunction(() => window.__cadDev?.ready() === true, undefined, { timeout: 30_000 });
  return calibrate(page);
}

/** 現在のレイヤーを、レイヤー欄のラジオボタンで選ぶ */
async function selectCurrentLayer(page: Page, name: string): Promise<void> {
  await page.locator(".layer-panel__item", { hasText: name }).locator('input[type="radio"]').check();
  await expect(page.getByTestId("current-layer-indicator")).toContainText(name);
}

/** コマンドラインに打ち込んで、Enterで実行する */
async function typeCommand(page: Page, text: string): Promise<void> {
  await input(page).focus();
  await input(page).fill(text);
  await page.keyboard.press("Enter");
}

const at = (mapping: Mapping, x: number, y: number): Pt => mapping.toPage({ x, y });

async function click(page: Page, p: Pt): Promise<void> {
  await page.mouse.click(p.x, p.y);
}

async function expectHue(page: Page, p: Pt, color: [number, number, number], present: boolean): Promise<void> {
  await expect.poll(() => hasHueNear(page, p, color, 5), { timeout: 5_000 }).toBe(present);
}

test.describe("LINE", () => {
  test("draws lines by clicks on the current layer (color of the layer), Enter ends, one Undo takes back all", async ({ page }) => {
    const mapping = await openEditable(page);
    await selectCurrentLayer(page, "MACHINE");
    const before = await entityCount(page);

    await typeCommand(page, "line");
    await expect(label(page)).toHaveText("LINE:");
    await click(page, at(mapping, 550, 50));
    await click(page, at(mapping, 750, 50));
    await click(page, at(mapping, 750, 30));
    await page.keyboard.press("Enter"); // 入力欄にフォーカスがあるので、空のEnterとして終了になる
    await expect(log(page)).toContainText("2本の線を追加しました");
    await expect(label(page)).toHaveText("コマンド:");
    expect(await entityCount(page)).toBe(before + 2);

    // MACHINE レイヤーの緑色で描かれている
    await expectHue(page, at(mapping, 650, 50), GREEN, true);
    await expectHue(page, at(mapping, 750, 40), GREEN, true);

    // 選ぶと、LINE・MACHINE と表示される
    await click(page, at(mapping, 650, 50));
    await expect(propertyPanel(page)).toContainText("LINE");
    await expect(propertyPanel(page)).toContainText("MACHINE");

    // 1回のUndoで、2本とも消える
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+z");
    await expect(log(page)).toContainText("元に戻しました: 線を追加(2本)");
    expect(await entityCount(page)).toBe(before);
    await expectHue(page, at(mapping, 650, 50), GREEN, false);
    await page.keyboard.press("Control+y");
    expect(await entityCount(page)).toBe(before + 2);
  });

  test("shows a rubber band (white dashed) while waiting for the next point, and it disappears when the command ends", async ({ page }) => {
    const mapping = await openEditable(page);
    await selectCurrentLayer(page, "MACHINE");
    await typeCommand(page, "line");
    await click(page, at(mapping, 550, 50));
    const mid = at(mapping, 650, 50);
    await expectHue(page, mid, WHITE, false); // まだカーソルは動いていない
    const target = at(mapping, 750, 50);
    await page.mouse.move(target.x, target.y);
    await expectHue(page, mid, WHITE, true); // 始点とカーソルを結ぶ破線

    await click(page, target); // 確定すると、ゴム紐は「次の点まで」に変わる
    await page.keyboard.press("Enter");
    await expect(log(page)).toContainText("1本の線を追加しました");
    await page.mouse.move(at(mapping, 600, 300).x, at(mapping, 600, 300).y);
    // 終わったので、ゴム紐は無い。描かれた線は緑
    await expectHue(page, mid, WHITE, false);
    await expectHue(page, mid, GREEN, true);
  });

  test("types points (absolute, relative) and ends with an empty Enter", async ({ page }) => {
    await openEditable(page);
    const before = await entityCount(page);
    await typeCommand(page, "l");
    await typeCommand(page, "550,50");
    await typeCommand(page, "@200,0");
    await typeCommand(page, "@0,-20");
    await typeCommand(page, "");
    await expect(log(page)).toContainText("2本の線を追加しました");
    expect(await entityCount(page)).toBe(before + 2);
  });

  test("U takes back the last point, and Ctrl+Z does the same while drawing (even in the command line)", async ({ page }) => {
    const mapping = await openEditable(page);
    await typeCommand(page, "line");
    await click(page, at(mapping, 550, 50));
    await click(page, at(mapping, 650, 50));
    await click(page, at(mapping, 650, 30));
    await typeCommand(page, "u"); // (650,30) を取り消す
    await page.keyboard.press("Control+z"); // 入力欄でも、作図中は「1点戻す」(650,50 を取り消す)
    await typeCommand(page, "@100,0"); // 基準点は (550,50) に戻っている
    await page.keyboard.press("Escape"); // Escで終了。描いた分は残る
    await expect(log(page)).toContainText("1本の線を追加しました");
    const before = await entityCount(page);
    expect(before).toBeGreaterThan(0);
    await expectHue(page, at(mapping, 600, 50), [255, 255, 255], true); // 現在のレイヤー(0)の色(白)で、(550,50)-(650,50)
  });

  test("Esc keeps what was drawn; drawing nothing says so", async ({ page }) => {
    const mapping = await openEditable(page);
    const before = await entityCount(page);
    await typeCommand(page, "line");
    await click(page, at(mapping, 550, 50));
    await click(page, at(mapping, 650, 50));
    await page.keyboard.press("Escape");
    expect(await entityCount(page)).toBe(before + 1);

    await typeCommand(page, "line");
    await click(page, at(mapping, 550, 80));
    await page.keyboard.press("Escape");
    await expect(log(page)).toContainText("線は描かれませんでした");
    expect(await entityCount(page)).toBe(before + 1);
  });

  test("a toolbar command replacing a drawing in progress keeps the drawn part", async ({ page }) => {
    const mapping = await openEditable(page);
    const before = await entityCount(page);
    await toolbarButton(page, "線").click();
    await expect(label(page)).toHaveText("LINE:");
    await expect(toolbarButton(page, "線")).toHaveClass(/toolbar__button--active/);
    await click(page, at(mapping, 550, 50));
    await click(page, at(mapping, 650, 50));
    await toolbarButton(page, "長方形").click();
    expect(await entityCount(page)).toBe(before + 1);
    await expect(label(page)).toHaveText("RECT:");
    await expect(toolbarButton(page, "長方形")).toHaveClass(/toolbar__button--active/);
    await page.keyboard.press("Escape");
  });
});

test.describe("PLINE and RECT", () => {
  test("PLINE draws one polyline; C closes it", async ({ page }) => {
    const mapping = await openEditable(page);
    await selectCurrentLayer(page, "MACHINE");
    const before = await entityCount(page);
    await typeCommand(page, "pl");
    await click(page, at(mapping, 550, 30));
    await click(page, at(mapping, 750, 30));
    await click(page, at(mapping, 750, 70));
    await typeCommand(page, "c");
    await expect(log(page)).toContainText("ポリラインを追加しました(3点、閉じる)");
    expect(await entityCount(page)).toBe(before + 1);
    // 閉じているので、3辺目(750,70)→(550,30)の途中にも線がある
    await expectHue(page, at(mapping, 650, 50), GREEN, true);
    await click(page, at(mapping, 650, 30));
    await expect(propertyPanel(page)).toContainText("LWPOLYLINE");
  });

  test("RECT draws a closed rectangle from two corners, and typed relative input works", async ({ page }) => {
    const mapping = await openEditable(page);
    await selectCurrentLayer(page, "MACHINE");
    const before = await entityCount(page);
    await typeCommand(page, "rect");
    await expect(log(page)).toContainText("1つ目の角を指示してください");
    await click(page, at(mapping, 550, 30));
    await expect(log(page)).toContainText("対角の点を指示してください");
    const corner = at(mapping, 750, 70);
    await page.mouse.move(corner.x, corner.y);
    await expectHue(page, at(mapping, 650, 30), WHITE, true); // ゴム紐(長方形)の下辺
    await click(page, corner);
    // クリックは画素単位なので、寸法は 200 × 40 の近く(座標を入力すれば、厳密な値になる。下で確認)
    await expect(log(page)).toContainText(/長方形を追加しました\((19\d|20\d)\.\d{3} × (3\d|4\d)\.\d{3}\)/);
    expect(await entityCount(page)).toBe(before + 1);
    await expectHue(page, at(mapping, 650, 70), GREEN, true); // 上辺

    await typeCommand(page, "rec");
    await typeCommand(page, "800,30");
    await typeCommand(page, "@100,40");
    await expect(log(page)).toContainText("長方形を追加しました(100.000 × 40.000)");
    expect(await entityCount(page)).toBe(before + 2);
  });

  test("RECT refuses a zero width and keeps waiting", async ({ page }) => {
    await openEditable(page);
    const before = await entityCount(page);
    await typeCommand(page, "rect");
    await typeCommand(page, "550,50");
    await typeCommand(page, "@100,0");
    await expect(log(page)).toContainText("0の長方形");
    await expect(label(page)).toHaveText("RECT:");
    expect(await entityCount(page)).toBe(before);
    await typeCommand(page, "@100,40");
    expect(await entityCount(page)).toBe(before + 1);
  });
});

test.describe("current layer", () => {
  test("is shown in the status bar, and a new drawing starts again from layer 0", async ({ page }) => {
    await openEditable(page);
    await expect(page.getByTestId("current-layer-indicator")).toContainText("0");
    await selectCurrentLayer(page, "MACHINE");
    await expect(page.locator(".layer-panel__item", { hasText: "MACHINE" }).locator('input[type="radio"]')).toBeChecked();
    await page.getByRole("button", { name: "図面を閉じる" }).click(); // 変更なし: 確認は出ない
    await expect(page.locator(".start-screen")).toBeVisible();
    await page.locator('input[type="file"]').setInputFiles({ name: "again.dxf", mimeType: "application/dxf", buffer: Buffer.from(factoryLayoutDxf(), "utf8") });
    await expect(page.locator(".status-bar")).toContainText("again.dxf", { timeout: 30_000 });
    await expect(page.getByTestId("current-layer-indicator")).toContainText("現在のレイヤー: 0");
  });

  test("refuses to draw on a hidden layer, with the reason", async ({ page }) => {
    await openEditable(page);
    await page.locator(".layer-panel__item", { hasText: /^0$/ }).locator('input[type="checkbox"]').uncheck();
    const before = await entityCount(page);
    await typeCommand(page, "line");
    await expect(log(page)).toContainText("非表示です");
    await expect(label(page)).toHaveText("コマンド:");
    await typeCommand(page, "rect");
    await expect(log(page)).toContainText("非表示です");
    expect(await entityCount(page)).toBe(before);
    // 表示に戻せば描ける
    await page.locator(".layer-panel__item", { hasText: /^0$/ }).locator('input[type="checkbox"]').check();
    await typeCommand(page, "line");
    await expect(label(page)).toHaveText("LINE:");
    await page.keyboard.press("Escape");
  });
});

test.describe("undo and redo buttons", () => {
  test("are disabled without history, follow the history, and work", async ({ page }) => {
    const mapping = await openEditable(page);
    await expect(toolbarButton(page, "元に戻す")).toBeDisabled();
    await expect(toolbarButton(page, "やり直し")).toBeDisabled();
    await typeCommand(page, "rect");
    await click(page, at(mapping, 550, 30));
    await click(page, at(mapping, 750, 70));
    await expect(toolbarButton(page, "元に戻す")).toBeEnabled();
    await expect(toolbarButton(page, "やり直し")).toBeDisabled();
    const before = await entityCount(page);
    await toolbarButton(page, "元に戻す").click();
    await expect(log(page)).toContainText("元に戻しました: 長方形を追加");
    expect(await entityCount(page)).toBe(before - 1);
    await expect(toolbarButton(page, "元に戻す")).toBeDisabled();
    await expect(toolbarButton(page, "やり直し")).toBeEnabled();
    await toolbarButton(page, "やり直し").click();
    expect(await entityCount(page)).toBe(before);
  });

  test("the draw buttons are enabled only when the drawing can be edited", async ({ page }) => {
    await openEditable(page);
    for (const name of ["線", "ポリライン", "長方形"]) await expect(toolbarButton(page, name)).toBeEnabled();
  });
});

test.describe("draw order (new entities only)", () => {
  test("TOFRONT and TOBACK move the selected new entity, and Undo restores the order", async ({ page }) => {
    const mapping = await openEditable(page);
    const before = await entityOrder(page);
    for (const y of [30, 60]) {
      await typeCommand(page, "line");
      await click(page, at(mapping, 550, y));
      await click(page, at(mapping, 750, y));
      await page.keyboard.press("Escape");
    }
    const withNew = await entityOrder(page);
    expect(withNew).toEqual([...before, "n0", "n1"]);

    // n0(y=30)を選んで、最前面へ
    await click(page, at(mapping, 650, 30));
    await expect(propertyPanel(page)).toContainText("LINE");
    await typeCommand(page, "tofront");
    await expect(log(page)).toContainText("1個の図形を最前面へ移動しました");
    expect(await entityOrder(page)).toEqual([...before, "n1", "n0"]);

    await typeCommand(page, "toback");
    await expect(log(page)).toContainText("1個の図形を最背面へ移動しました");
    expect(await entityOrder(page)).toEqual(["n0", ...before, "n1"]);

    await page.keyboard.press("Escape"); // 選択を解除しない(入力欄から出るだけ)
    await page.keyboard.press("Control+z");
    expect(await entityOrder(page)).toEqual([...before, "n1", "n0"]);
    await page.keyboard.press("Control+z");
    expect(await entityOrder(page)).toEqual(withNew);
  });

  test("an imported entity is not reordered (said clearly), and nothing is selected is said too", async ({ page }) => {
    const mapping = await openEditable(page);
    const before = await entityOrder(page);
    const circle = at(mapping, 400, 300);
    await click(page, circle);
    await expect(propertyPanel(page)).toContainText("CIRCLE");
    await typeCommand(page, "tofront");
    await expect(log(page)).toContainText("新しく描いた図形が選択されていません");
    expect(await entityOrder(page)).toEqual(before);
  });
});

test.describe("unsaved changes", () => {
  test("shows the indicator, clears it when Undo returns to the opened state, and guards closing", async ({ page }) => {
    const mapping = await openEditable(page);
    const unsaved = page.getByTestId("unsaved-indicator");
    await expect(unsaved).toHaveCount(0);
    const hasUnloadGuard = () =>
      page.evaluate(() => {
        const event = new Event("beforeunload", { cancelable: true });
        window.dispatchEvent(event);
        return event.defaultPrevented;
      });
    expect(await hasUnloadGuard()).toBe(false);

    await typeCommand(page, "rect");
    await click(page, at(mapping, 550, 30));
    await click(page, at(mapping, 750, 70));
    await expect(unsaved).toBeVisible();
    expect(await hasUnloadGuard()).toBe(true);

    // 閉じようとすると確認が出る。キャンセルすれば、閉じない
    const messages: string[] = [];
    page.once("dialog", (dialog) => {
      messages.push(dialog.message());
      void dialog.dismiss();
    });
    await page.getByRole("button", { name: "図面を閉じる" }).click();
    await expect.poll(() => messages.length).toBe(1);
    expect(messages[0]).toContain("未保存の変更があります");
    await expect(page.locator(".status-bar")).toContainText("factory.dxf");
    await expect(page.locator(".start-screen")).toHaveCount(0);

    // コマンドの CLOSE でも、別の図面を開く(OPEN)でも、同じ確認が出る
    page.once("dialog", (dialog) => {
      messages.push(dialog.message());
      void dialog.dismiss();
    });
    await typeCommand(page, "close");
    await expect.poll(() => messages.length).toBe(2);
    page.once("dialog", (dialog) => {
      messages.push(dialog.message());
      void dialog.dismiss();
    });
    await typeCommand(page, "open");
    await expect.poll(() => messages.length).toBe(3);
    expect(messages[2]).toContain("別の図面を開く");
    await expect(page.locator(".status-bar")).toContainText("factory.dxf");

    // 開いた直後の状態に戻せば、未保存ではなくなる
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+z");
    await expect(unsaved).toHaveCount(0);
    expect(await hasUnloadGuard()).toBe(false);
    await page.keyboard.press("Control+y");
    await expect(unsaved).toBeVisible();

    // 受け入れれば、閉じる
    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: "図面を閉じる" }).click();
    await expect(page.locator(".start-screen")).toBeVisible();
  });
});
