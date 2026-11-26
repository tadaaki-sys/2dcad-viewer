// レイヤー・線種・線の太さ(Phase 17)のE2Eテスト。
// 見本図面(工場レイアウト)を開き、LAYER のパネルでレイヤーを作る・色を変える・名前を変える・削除する・図形を移す。
// レイヤーの設定を変えると、ByLayer の図形(新しく描いた図形・取り込んだ図形)が追従し、Undo 1回で元に戻ることを確かめる。
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { factoryLayoutDxf } from "../src/regression/fixtures";
import { calibrate, hasHueNear, openDrawing, propertyPanel } from "./helpers";
import type { Mapping, Pt } from "./helpers";
// window.__cadDev の型を取り込む(読み込むだけで、実行はしない)
import type {} from "../src/devHooks";

const log = (page: Page) => page.getByTestId("command-line-log");
const input = (page: Page) => page.getByTestId("command-line-input");
const panel = (page: Page) => page.getByTestId("layer-manager");
const result = (page: Page) => page.getByTestId("layer-manager-result");
const RED: [number, number, number] = [255, 0, 0];
const GREEN: [number, number, number] = [0, 255, 0];
const BLUE: [number, number, number] = [0, 0, 255];
const WHITE: [number, number, number] = [255, 255, 255];

async function openEditable(page: Page): Promise<Mapping> {
  await openDrawing(page, "factory.dxf", factoryLayoutDxf());
  await page.waitForFunction(() => window.__cadDev?.ready() === true, undefined, { timeout: 30_000 });
  return calibrate(page);
}

async function typeCommand(page: Page, text: string): Promise<void> {
  await input(page).focus();
  await input(page).fill(text);
  await page.keyboard.press("Enter");
}

const at = (mapping: Mapping, x: number, y: number): Pt => mapping.toPage({ x, y });

async function click(page: Page, mapping: Mapping, x: number, y: number): Promise<void> {
  const p = at(mapping, x, y);
  await page.mouse.click(p.x, p.y);
}

async function undo(page: Page): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("Control+z");
}

async function openPanel(page: Page, command = "layer"): Promise<void> {
  await typeCommand(page, command);
  await expect(panel(page)).toBeVisible();
}

async function closePanel(page: Page): Promise<void> {
  await page.getByTestId("layer-manager-close").click();
  await expect(panel(page)).toBeHidden();
}

async function createLayer(page: Page, name: string): Promise<void> {
  await page.getByTestId("layer-new-name").fill(name);
  await page.getByTestId("layer-new").click();
  await expect(page.getByTestId(`layer-row-${name}`)).toBeVisible();
}

/** 色の入力に値を入れる(ブラウザの change が出て、反映される) */
async function setColor(page: Page, layer: string, color: string): Promise<void> {
  await page.getByTestId(`layer-color-${layer}`).fill(color);
}

/** 新しいレイヤーを現在のレイヤーにして、何も無い所に、横の線 (20,250)-(120,250) を描く(ByLayer の図形になる) */
async function drawLineOnLayer(page: Page, mapping: Mapping, layer: string): Promise<void> {
  await page.getByLabel(`${layer} を現在のレイヤーにする`).check();
  await typeCommand(page, "line");
  await click(page, mapping, 20, 250);
  await click(page, mapping, 120, 250);
  await page.keyboard.press("Enter");
  await expect(log(page)).toContainText("線を");
}

/** 何も無い所をクリックして、選択を外す(選択中の図形は、選択の色で描かれるので、色の確認の前に外す) */
async function deselect(page: Page, mapping: Mapping): Promise<void> {
  await click(page, mapping, 900, 330);
  await expect(propertyPanel(page)).not.toContainText("LINE");
}

async function lineColorIs(page: Page, mapping: Mapping, color: [number, number, number]): Promise<boolean> {
  return hasHueNear(page, at(mapping, 70, 250), color, 4);
}

test.describe("the layer panel", () => {
  test("LAYER opens it with a row per layer; LINETYPE and LINEWEIGHT open the other tabs; Esc and the button close it", async ({ page }) => {
    await openEditable(page);
    await openPanel(page);
    for (const name of ["0", "WALL", "MACHINE", "GUIDE"]) await expect(page.getByTestId(`layer-row-${name}`)).toBeVisible();
    // 取り込んだ図面のレイヤーの線種が、選択肢に出る
    await expect(page.getByTestId("layer-linetype-GUIDE")).toHaveValue("DASHED");
    await closePanel(page);

    await openPanel(page, "linetype");
    await expect(page.getByTestId("layer-tab-linetypes")).toHaveAttribute("aria-selected", "true");
    for (const name of ["CONTINUOUS", "DASHED", "CENTER", "HIDDEN"]) await expect(page.getByTestId(`linetype-row-${name}`)).toBeVisible();
    await expect(page.getByTestId("ltscale-input")).toHaveValue("1");
    await closePanel(page);

    await openPanel(page, "lw");
    await expect(page.getByTestId("layer-tab-lineweights")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("lineweight-row-25")).toBeVisible();
    // Esc は、パネルの中にフォーカスがあるときに効く(他のパネルと同じ)
    await page.getByTestId("layer-tab-lineweights").focus();
    await page.keyboard.press("Escape");
    await expect(panel(page)).toBeHidden();
  });

  test("the Manage button in the Layers list opens it", async ({ page }) => {
    await openEditable(page);
    await page.getByTestId("layer-manage").click();
    await expect(panel(page)).toBeVisible();
  });
});

test.describe("creating, renaming and deleting layers", () => {
  test("a new layer appears, is one Undo step, and Undo removes it; names that are not allowed are refused", async ({ page }) => {
    await openEditable(page);
    await openPanel(page);
    await createLayer(page, "SHAPES");
    await expect(page.getByLabel("SHAPES を現在のレイヤーにする")).toBeVisible();
    await page.getByTestId("layer-new-name").fill("wall");
    await page.getByTestId("layer-new").click();
    await expect(result(page)).toContainText("同じ名前");
    await page.getByTestId("layer-new-name").fill("a:b");
    await page.getByTestId("layer-new").click();
    await expect(result(page)).toContainText("使えない文字");
    await undo(page);
    await expect(page.getByTestId("layer-row-SHAPES")).toBeHidden();
    await expect(log(page)).toContainText("元に戻しました");
  });

  test("renaming moves the figures with it; the Properties show the new name; Undo brings the old name back", async ({ page }) => {
    const mapping = await openEditable(page);
    await openPanel(page);
    await createLayer(page, "SHAPES");
    await closePanel(page);
    await drawLineOnLayer(page, mapping, "SHAPES");
    await click(page, mapping, 70, 250);
    await expect(propertyPanel(page)).toContainText(/Layer\s*SHAPES/);

    await openPanel(page);
    await page.getByTestId("layer-rename-SHAPES").click();
    await page.getByTestId("layer-rename-input-SHAPES").fill("PARTS");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("layer-row-PARTS")).toBeVisible();
    await expect(page.getByTestId("layer-row-SHAPES")).toBeHidden();
    await expect(result(page)).toContainText("1 個を付け替えました");
    await expect(propertyPanel(page)).toContainText(/Layer\s*PARTS/);

    await undo(page);
    await expect(page.getByTestId("layer-row-SHAPES")).toBeVisible();
    await expect(propertyPanel(page)).toContainText(/Layer\s*SHAPES/);
  });

  test("a layer with figures, layer 0 and the current layer cannot be deleted; an empty one can, and Undo restores it", async ({ page }) => {
    const mapping = await openEditable(page);
    await openPanel(page);
    await createLayer(page, "SHAPES");
    await createLayer(page, "EMPTY");
    await closePanel(page);
    await drawLineOnLayer(page, mapping, "SHAPES");
    await openPanel(page);

    await page.getByTestId("layer-delete-SHAPES").click();
    await expect(result(page)).toContainText("現在のレイヤー");
    await page.getByTestId("layer-delete-WALL").click();
    await expect(result(page)).toContainText("図形が");
    await expect(page.getByTestId("layer-row-WALL")).toBeVisible();
    await page.getByTestId("layer-delete-0").click();
    await expect(result(page)).toContainText("レイヤー 0");

    await page.getByTestId("layer-delete-EMPTY").click();
    await expect(page.getByTestId("layer-row-EMPTY")).toBeHidden();
    await undo(page);
    await expect(page.getByTestId("layer-row-EMPTY")).toBeVisible();
  });
});

test.describe("ByLayer figures follow the layer", () => {
  test("a figure drawn on a layer takes its color; changing the layer color changes the figure; ONE Undo restores both", async ({ page }) => {
    const mapping = await openEditable(page);
    await openPanel(page);
    await createLayer(page, "SHAPES");
    await closePanel(page);
    await drawLineOnLayer(page, mapping, "SHAPES");
    expect(await lineColorIs(page, mapping, WHITE)).toBe(true);
    await click(page, mapping, 70, 250);
    await expect(propertyPanel(page)).toContainText(/Color\s*#ffffff \(ByLayer\)/);

    await openPanel(page);
    await setColor(page, "SHAPES", "#00ff00");
    await expect(result(page)).toContainText("ByLayer の図形 1 個が追従しました");
    await expect(propertyPanel(page)).toContainText(/Color\s*#00ff00 \(ByLayer\)/);
    await closePanel(page);
    await deselect(page, mapping);
    await expect.poll(() => lineColorIs(page, mapping, GREEN)).toBe(true);

    await undo(page);
    await expect.poll(() => lineColorIs(page, mapping, WHITE)).toBe(true);
    // Redo で、もう一度
    await page.keyboard.press("Control+y");
    await expect.poll(() => lineColorIs(page, mapping, GREEN)).toBe(true);
  });

  test("an imported figure that follows its layer changes too (the wall: red → blue) and goes back with Undo", async ({ page }) => {
    const mapping = await openEditable(page);
    const wallBottom = at(mapping, 500, 0);
    expect(await hasHueNear(page, wallBottom, RED, 4)).toBe(true);
    await openPanel(page);
    await setColor(page, "WALL", "#0000ff");
    await expect.poll(() => hasHueNear(page, wallBottom, BLUE, 4)).toBe(true);
    expect(await hasHueNear(page, wallBottom, RED, 4)).toBe(false);
    await undo(page);
    await expect.poll(() => hasHueNear(page, wallBottom, RED, 4)).toBe(true);
  });

  test("changing a layer's color also recolors the imported figures on it that follow it (the machine circle)", async ({ page }) => {
    const mapping = await openEditable(page);
    await openPanel(page);
    // MACHINE レイヤーの色(緑)を変えると、図面にある MACHINE の図形(ByLayer の色)が変わる
    await setColor(page, "MACHINE", "#ff0000");
    await closePanel(page);
    await click(page, mapping, 300, 200);
    await expect(propertyPanel(page)).toContainText("CIRCLE");
    await expect(propertyPanel(page)).toContainText(/Color\s*#ff0000 \(ByLayer\)/);
  });

  test("the linetype follows the layer: the GUIDE line is DASHED (ByLayer); making the layer solid makes the line solid; Undo restores", async ({ page }) => {
    const mapping = await openEditable(page);
    await click(page, mapping, 500, 450);
    await expect(propertyPanel(page)).toContainText(/Linetype\s*DASHED \(ByLayer\)/);
    await openPanel(page);
    await page.getByTestId("layer-linetype-GUIDE").selectOption("CONTINUOUS");
    await expect(result(page)).toContainText("線種");
    await expect(propertyPanel(page)).toContainText(/Linetype\s*CONTINUOUS \(ByLayer\)/);
    await undo(page);
    await expect(propertyPanel(page)).toContainText(/Linetype\s*DASHED \(ByLayer\)/);
  });

  test("the weight follows the layer: a heavier GUIDE layer makes its line 0.50 mm (ByLayer)", async ({ page }) => {
    const mapping = await openEditable(page);
    await openPanel(page);
    await page.getByTestId("layer-weight-GUIDE").selectOption("50");
    await closePanel(page);
    await click(page, mapping, 500, 450);
    await expect(propertyPanel(page)).toContainText(/Lineweight\s*0\.50 mm \(ByLayer\)/);
  });
});

test.describe("moving figures to another layer (LAYMOVE)", () => {
  test("the selected figure takes the target layer's color; one Undo step", async ({ page }) => {
    const mapping = await openEditable(page);
    await openPanel(page);
    await createLayer(page, "SHAPES");
    await closePanel(page);
    await drawLineOnLayer(page, mapping, "SHAPES");
    await click(page, mapping, 70, 250);
    await expect(propertyPanel(page)).toContainText(/Layer\s*SHAPES/);
    await typeCommand(page, "laymove");
    await typeCommand(page, "WALL");
    await expect(log(page)).toContainText("レイヤー「WALL」へ移しました");
    await expect(propertyPanel(page)).toContainText(/Layer\s*WALL/);
    await deselect(page, mapping);
    await expect.poll(() => lineColorIs(page, mapping, RED)).toBe(true);
    await undo(page);
    await click(page, mapping, 70, 250);
    await expect(propertyPanel(page)).toContainText(/Layer\s*SHAPES/);
    await deselect(page, mapping);
    await expect.poll(() => lineColorIs(page, mapping, WHITE)).toBe(true);
  });

  test("the panel's Move button moves the current selection", async ({ page }) => {
    const mapping = await openEditable(page);
    await openPanel(page);
    await createLayer(page, "SHAPES");
    await expect(page.getByTestId("layer-move-WALL")).toBeDisabled();
    await closePanel(page);
    await drawLineOnLayer(page, mapping, "SHAPES");
    await click(page, mapping, 70, 250);
    await openPanel(page);
    await page.getByTestId("layer-move-GUIDE").click();
    await expect(result(page)).toContainText("レイヤー「GUIDE」へ移しました");
    await expect(propertyPanel(page)).toContainText(/Layer\s*GUIDE/);
  });
});

test.describe("the global linetype scale", () => {
  test("LTSCALE changes it (one Undo step); the panel shows the value; bad input is refused", async ({ page }) => {
    await openEditable(page);
    await typeCommand(page, "ltscale");
    await typeCommand(page, "abc");
    await expect(log(page)).toContainText("数値で入力してください");
    await typeCommand(page, "0.5");
    await expect(log(page)).toContainText("全体の線種尺度を 1 から 0.5 に変更しました");
    await openPanel(page, "lt");
    await expect(page.getByTestId("ltscale-input")).toHaveValue("0.5");
    await page.getByTestId("ltscale-input").fill("2");
    await page.getByTestId("ltscale-input").press("Enter");
    await expect(result(page)).toContainText("0.5 から 2 に変更");
    await undo(page);
    await expect(page.getByTestId("ltscale-input")).toHaveValue("0.5");
    await undo(page);
    await expect(page.getByTestId("ltscale-input")).toHaveValue("1");
  });
});

test.describe("visibility is a view setting", () => {
  test("hiding a layer does not create an Undo step, and layer edits keep it hidden", async ({ page }) => {
    const mapping = await openEditable(page);
    const wallBottom = at(mapping, 500, 0);
    await page.getByRole("checkbox", { name: /表示・非表示/ }).first().waitFor();
    const history = () => page.evaluate(() => window.__cadDev!.history().canUndo);
    expect(await history()).toBe(false);
    // WALL の行(左の一覧)の表示のチェックを外す
    const row = page.locator(".layer-panel__item", { hasText: "WALL" });
    await row.locator('input[type="checkbox"]').uncheck();
    await expect.poll(() => hasHueNear(page, wallBottom, RED, 4)).toBe(false);
    expect(await history()).toBe(false);
    // 色を変えても、非表示のまま。Undo しても、非表示のまま
    await openPanel(page);
    await setColor(page, "WALL", "#0000ff");
    await expect.poll(() => hasHueNear(page, wallBottom, BLUE, 4)).toBe(false);
    await undo(page);
    await expect.poll(() => hasHueNear(page, wallBottom, RED, 4)).toBe(false);
    await row.locator('input[type="checkbox"]').check();
    await expect.poll(() => hasHueNear(page, wallBottom, RED, 4)).toBe(true);
  });
});
