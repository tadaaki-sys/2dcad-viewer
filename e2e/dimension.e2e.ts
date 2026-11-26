// 寸法(DIMHORIZONTAL・DIMVERTICAL・DIMALIGNED・DIMRADIUS・DIMDIAMETER・DIMANGULAR)と寸法スタイル(Phase 15)のE2Eテスト。
// 工場レイアウトの図面(1000 x 600 mm)で、取り込んだ円や線を測る。角度寸法は、何も無い所に足した線を測る。
// 点を指すクリックは、吸着する(端点など)。円・線を指すクリックは、吸着しない。
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { factoryLayoutDxf } from "../src/regression/fixtures";
import { calibrate, openDrawing, propertyPanel } from "./helpers";
import type { Mapping, Pt } from "./helpers";
// window.__cadDev の型を取り込む(読み込むだけで、実行はしない)
import type {} from "../src/devHooks";

const log = (page: Page) => page.getByTestId("command-line-log");
const input = (page: Page) => page.getByTestId("command-line-input");
const label = (page: Page) => page.getByTestId("command-line-label");
const stylePanel = (page: Page) => page.getByTestId("dimension-style-panel");
const toolbarMenu = (page: Page) => page.getByTestId("toolbar-dimension-menu");
const entityCount = (page: Page) => page.evaluate(() => window.__cadDev!.entityCount());

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

async function undo(page: Page): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("Control+z");
}

async function click(page: Page, mapping: Mapping, x: number, y: number): Promise<void> {
  const p = at(mapping, x, y);
  await page.mouse.click(p.x, p.y);
}

async function select(page: Page, mapping: Mapping, x: number, y: number, text: string): Promise<void> {
  await click(page, mapping, x, y);
  await expect(propertyPanel(page)).toContainText(text);
}

/** 水平寸法を、取り込んだ線 (100,100)-(500,100) の下(y = 60)に描く。測定値は 400 */
async function drawHorizontal(page: Page, mapping: Mapping): Promise<void> {
  await typeCommand(page, "dh");
  await click(page, mapping, 100, 100);
  await click(page, mapping, 500, 100);
  await click(page, mapping, 300, 60);
}

test.describe("toolbar menu", () => {
  test("one 寸法 button opens a menu of the eight commands; choosing one starts it and closes the menu", async ({ page }) => {
    await openEditable(page);
    const button = page.getByTestId("toolbar-dimension");
    await expect(toolbarMenu(page)).toBeHidden();
    await button.click();
    await expect(toolbarMenu(page)).toBeVisible();
    await expect(toolbarMenu(page).getByRole("menuitem")).toHaveText(["水平寸法", "垂直寸法", "平行寸法", "半径寸法", "直径寸法", "角度寸法", "関連付け", "寸法スタイル"]);
    await toolbarMenu(page).getByRole("menuitem", { name: "平行寸法" }).click();
    await expect(toolbarMenu(page)).toBeHidden();
    await expect(label(page)).toHaveText("DIMALIGNED:");
    await expect(button).toHaveClass(/toolbar__button--active/);
    await page.keyboard.press("Escape");
    await expect(label(page)).toHaveText("コマンド:");
  });

  test("the menu closes with a click outside or Esc", async ({ page }) => {
    await openEditable(page);
    await page.getByTestId("toolbar-dimension").click();
    await expect(toolbarMenu(page)).toBeVisible();
    await page.mouse.click(5, 300);
    await expect(toolbarMenu(page)).toBeHidden();
    await page.getByTestId("toolbar-dimension").click();
    await expect(toolbarMenu(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(toolbarMenu(page)).toBeHidden();
  });
});

test.describe("linear dimensions", () => {
  test("horizontal: two points and the line position add ONE dimension (value 400); selectable; one Undo / Redo", async ({ page }) => {
    const mapping = await openEditable(page);
    const before = await entityCount(page);
    await typeCommand(page, "dh");
    await expect(label(page)).toHaveText("DIMHORIZONTAL:");
    await expect(log(page)).toContainText("1つ目の点を指示してください");
    await click(page, mapping, 100, 100);
    await expect(log(page)).toContainText("2つ目の点");
    await click(page, mapping, 500, 100);
    await expect(log(page)).toContainText("寸法線の位置");
    await click(page, mapping, 300, 60);
    await expect(log(page)).toContainText("水平寸法を追加しました(400)");
    await expect(label(page)).toHaveText("コマンド:");
    expect(await entityCount(page)).toBe(before + 1);

    // 寸法線の上をクリックして選ぶと、種類・測定値・スタイルが見える
    await select(page, mapping, 200, 60, "DIMENSION");
    await expect(propertyPanel(page)).toContainText("Linear");
    await expect(propertyPanel(page)).toContainText("400");
    await expect(propertyPanel(page)).toContainText("Standard");

    await undo(page);
    await expect(log(page)).toContainText("元に戻しました: 寸法を追加");
    expect(await entityCount(page)).toBe(before);
    await page.keyboard.press("Control+y");
    await expect(log(page)).toContainText("やり直しました: 寸法を追加");
    expect(await entityCount(page)).toBe(before + 1);
  });

  test("vertical and aligned dimensions measure the vertical distance and the length along the two points", async ({ page }) => {
    const mapping = await openEditable(page);
    await typeCommand(page, "dv");
    await click(page, mapping, 100, 100);
    await click(page, mapping, 500, 100);
    await expect(log(page)).toContainText("垂直方向の距離が 0");
    await click(page, mapping, 1000, 0);
    await click(page, mapping, 900, 40);
    await expect(log(page)).toContainText("垂直寸法を追加しました(");
    // 垂直寸法の測定値は、2点の y の差(100 → 0 = 100)
    await expect(log(page)).toContainText("垂直寸法を追加しました(100)");

    await typeCommand(page, "dal");
    await click(page, mapping, 0, 0);
    await click(page, mapping, 1000, 600);
    await click(page, mapping, 600, 100);
    await expect(log(page)).toContainText("平行寸法を追加しました(1166)");
  });

  test("the same point and a position without a result are refused with the reason; Enter and Esc add nothing", async ({ page }) => {
    const mapping = await openEditable(page);
    const before = await entityCount(page);
    await typeCommand(page, "dh");
    await click(page, mapping, 100, 100);
    await click(page, mapping, 100, 100);
    await expect(log(page)).toContainText("同じ点です");
    await typeCommand(page, "");
    await expect(log(page)).toContainText("寸法は描かれませんでした");
    await expect(label(page)).toHaveText("コマンド:");
    await typeCommand(page, "dh");
    await click(page, mapping, 100, 100);
    await click(page, mapping, 500, 100);
    await page.keyboard.press("Escape");
    await expect(label(page)).toHaveText("コマンド:");
    expect(await entityCount(page)).toBe(before);
  });

  test("the dimension follows MOVE (the measured length stays) and COPY; each is one Undo step", async ({ page }) => {
    const mapping = await openEditable(page);
    await drawHorizontal(page, mapping);
    await expect(log(page)).toContainText("水平寸法を追加しました(400)");
    const before = await entityCount(page);

    // MOVE: 寸法線 (300,60) を選んで、(0, 10) 動かす
    await select(page, mapping, 200, 60, "DIMENSION");
    await typeCommand(page, "move");
    await click(page, mapping, 300, 60);
    await click(page, mapping, 300, 80);
    await expect(log(page)).toContainText("移動しました");
    await expect(propertyPanel(page)).toContainText("400");
    await undo(page);
    await expect(log(page)).toContainText("元に戻しました");

    // COPY: 1つ複写して、図形が1つ増える
    await select(page, mapping, 200, 60, "DIMENSION");
    await typeCommand(page, "copy");
    await click(page, mapping, 300, 60);
    await click(page, mapping, 300, 40);
    await page.keyboard.press("Escape");
    expect(await entityCount(page)).toBe(before + 1);
    await undo(page);
    expect(await entityCount(page)).toBe(before);
  });
});

test.describe("radius and diameter", () => {
  test("DIMRADIUS: click the circle, then the text side: R100 on the circle (300,300) r 100; Undo removes it", async ({ page }) => {
    const mapping = await openEditable(page);
    const before = await entityCount(page);
    await typeCommand(page, "dra");
    await expect(log(page)).toContainText("円または円弧をクリック");
    await click(page, mapping, 400, 300); // 円周の、右の点
    await expect(log(page)).toContainText("文字の側の点");
    await click(page, mapping, 480, 300); // 文字の側(右)。寸法線は (400,300)-(480,300)
    await expect(log(page)).toContainText("半径寸法を追加しました(R100)");
    expect(await entityCount(page)).toBe(before + 1);
    await select(page, mapping, 440, 300, "DIMENSION");
    await expect(propertyPanel(page)).toContainText("Radius");
    await expect(propertyPanel(page)).toContainText("R100");
    await undo(page);
    expect(await entityCount(page)).toBe(before);
  });

  test("DIMDIAMETER on a circle and on an arc; a click on a line or on nothing is refused and asked again", async ({ page }) => {
    const mapping = await openEditable(page);
    await typeCommand(page, "ddi");
    await click(page, mapping, 100, 100); // 取り込んだ線(MACHINE の横線)の上
    await expect(log(page)).toContainText("できません");
    await click(page, mapping, 60, 330); // 何も無い所
    await expect(log(page)).toContainText("クリックした所に図形がありません");
    await click(page, mapping, 200, 300); // 円周の、左の点
    await click(page, mapping, 300, 420);
    await expect(log(page)).toContainText("直径寸法を追加しました(Ø200)");

    await typeCommand(page, "ddi");
    await click(page, mapping, 800, 300); // 円弧(700,300 r100 の上半分)の、右の端
    await click(page, mapping, 850, 420);
    await expect(log(page)).toContainText("直径寸法を追加しました(Ø200)");
  });
});

test.describe("angular dimensions", () => {
  /** 何も無い所に、横の線 (20,200)-(180,200) と縦の線 (20,200)-(20,400) を足す。2本は (20,200) で交わる(90度) */
  async function addCorner(page: Page): Promise<void> {
    await page.evaluate(() => {
      window.__cadDev!.addLine(20, 200, 180, 200);
      window.__cadDev!.addLine(20, 200, 20, 400);
    });
  }

  test("two lines, then the arc position: 90.0 degrees; one Undo", async ({ page }) => {
    const mapping = await openEditable(page);
    await addCorner(page);
    const before = await entityCount(page);
    await typeCommand(page, "dan");
    await expect(log(page)).toContainText("1本目の線をクリック");
    await click(page, mapping, 100, 200);
    await expect(log(page)).toContainText("2本目の線");
    await click(page, mapping, 20, 330);
    await expect(log(page)).toContainText("弧が通る点");
    await click(page, mapping, 90, 270);
    await expect(log(page)).toContainText("角度寸法を追加しました(90.0°)");
    expect(await entityCount(page)).toBe(before + 1);
    // 弧は、2本の線の交点 (20,200) から、位置 (90,270) を通る(45度の向き)
    await select(page, mapping, 90, 270, "DIMENSION");
    await expect(propertyPanel(page)).toContainText("Angular");
    await undo(page);
    expect(await entityCount(page)).toBe(before);
  });

  test("Enter at the first prompt switches to three points (vertex, arm 1, arm 2, arc position)", async ({ page }) => {
    const mapping = await openEditable(page);
    await typeCommand(page, "dan");
    await typeCommand(page, "");
    await expect(log(page)).toContainText("頂点を指示してください");
    await click(page, mapping, 100, 300);
    await click(page, mapping, 160, 300);
    await click(page, mapping, 100, 360);
    await click(page, mapping, 140, 340);
    await expect(log(page)).toContainText("角度寸法を追加しました(90.0°)");
  });

  test("parallel lines are refused and another line can be chosen", async ({ page }) => {
    const mapping = await openEditable(page);
    await page.evaluate(() => {
      window.__cadDev!.addLine(20, 200, 180, 200);
      window.__cadDev!.addLine(20, 250, 180, 250);
    });
    await typeCommand(page, "dan");
    await click(page, mapping, 100, 200);
    await click(page, mapping, 100, 250);
    await expect(log(page)).toContainText("2本の線が平行です");
    await expect(label(page)).toHaveText("DIMANGULAR:");
    await page.keyboard.press("Escape");
  });
});

test.describe("dimension style", () => {
  async function openStylePanel(page: Page): Promise<void> {
    await page.getByTestId("toolbar-dimension").click();
    await toolbarMenu(page).getByRole("menuitem", { name: "寸法スタイル" }).click();
    await expect(stylePanel(page)).toBeVisible();
  }

  test("DIMSTYLE opens the panel; a new style (height, decimals, unit, linetype) is used for the next dimension and recorded in it", async ({ page }) => {
    const mapping = await openEditable(page);
    await typeCommand(page, "dimstyle");
    await expect(stylePanel(page)).toBeVisible();
    await page.getByTestId("dimension-style-text-height").fill("40");
    await page.getByTestId("dimension-style-text-height").press("Enter");
    await page.getByTestId("dimension-style-decimals").selectOption("1");
    await page.getByTestId("dimension-style-unit").selectOption("cm");
    await page.getByTestId("dimension-style-show-unit").check();
    await page.getByTestId("dimension-style-linetype").selectOption("dashed");
    await page.getByTestId("dimension-style-name").fill("Small");
    await page.getByTestId("dimension-style-new").click();
    await expect(page.getByTestId("dimension-style-select")).toHaveValue("Small");
    await expect(page.getByTestId("dimension-style-error")).toBeHidden();
    await page.getByTestId("dimension-style-close").click();
    await expect(stylePanel(page)).toBeHidden();

    await drawHorizontal(page, mapping);
    await expect(log(page)).toContainText("水平寸法を追加しました(40.0 cm)");
    await select(page, mapping, 200, 60, "DIMENSION");
    await expect(propertyPanel(page)).toContainText("Small");
    await expect(propertyPanel(page)).toContainText("cm");
    await expect(propertyPanel(page)).toContainText("40.0 cm");
    await expect(propertyPanel(page)).toContainText("Linetype");
    await expect(propertyPanel(page)).toContainText("破線");
  });

  test("changing the style afterwards does not change a dimension that is already drawn", async ({ page }) => {
    const mapping = await openEditable(page);
    await drawHorizontal(page, mapping);
    await select(page, mapping, 200, 60, "Standard");
    await openStylePanel(page);
    await page.getByTestId("dimension-style-unit").selectOption("m");
    await page.getByTestId("dimension-style-close").click();
    await select(page, mapping, 200, 60, "Standard");
    // 描いた寸法の単位は、描いたときのまま(mm)。測定値の表示も変わらない
    await expect(propertyPanel(page)).toContainText(/Units\s*mm/);
    await expect(propertyPanel(page)).toContainText(/Measurement\s*400/);
  });

  test("the styles are kept in this browser: after a reload, the current style is still the new one", async ({ page }) => {
    await openEditable(page);
    await openStylePanel(page);
    await page.getByTestId("dimension-style-name").fill("Kept");
    await page.getByTestId("dimension-style-new").click();
    await page.getByTestId("dimension-style-close").click();
    await openEditable(page);
    await openStylePanel(page);
    await expect(page.getByTestId("dimension-style-select")).toHaveValue("Kept");
  });

  test("an unusable value is refused with the reason and the panel keeps the old value; Esc closes the panel", async ({ page }) => {
    await openEditable(page);
    await openStylePanel(page);
    await page.getByTestId("dimension-style-text-height").fill("0");
    await page.getByTestId("dimension-style-text-height").press("Enter");
    await expect(page.getByTestId("dimension-style-error")).toContainText("文字の高さ");
    await page.getByTestId("dimension-style-name").fill(" ");
    await page.getByTestId("dimension-style-new").click();
    await expect(page.getByTestId("dimension-style-error")).toContainText("名前");
    await page.getByTestId("dimension-style-name").press("Escape");
    await expect(stylePanel(page)).toBeHidden();
  });

  test("a style that names a layer draws the dimension on that layer", async ({ page }) => {
    const mapping = await openEditable(page);
    await openStylePanel(page);
    await page.getByTestId("dimension-style-layer").selectOption("DIM");
    await page.getByTestId("dimension-style-close").click();
    await drawHorizontal(page, mapping);
    await expect(log(page)).toContainText("水平寸法を追加しました");
    await select(page, mapping, 200, 60, "DIM");
    await expect(propertyPanel(page)).toContainText(/Layer\s*DIM/);
  });
});
