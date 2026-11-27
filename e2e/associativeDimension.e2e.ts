// 連動寸法(Phase 16)のE2Eテスト。
// 何も無い所に、開発用の入口で線を足して(新しく描いた図形)、その端点に寸法を付ける。図形を拡大縮小・削除・移動して、追従と警告を確かめる。
// 点の指示は、吸着する(端点)。吸着した点は、図形の端点に一致するので、自動で関連付けられる。
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { factoryLayoutDxf } from "../src/regression/fixtures";
import { calibrate, hasHueNear, openDrawing, propertyPanel } from "./helpers";
import type { Mapping, Pt } from "./helpers";
// window.__cadDev の型を取り込む(読み込むだけで、実行はしない)
import type {} from "../src/devHooks";

const log = (page: Page) => page.getByTestId("command-line-log");
const input = (page: Page) => page.getByTestId("command-line-input");
const label = (page: Page) => page.getByTestId("command-line-label");
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

async function click(page: Page, mapping: Mapping, x: number, y: number): Promise<void> {
  const p = at(mapping, x, y);
  await page.mouse.click(p.x, p.y);
}

async function undo(page: Page): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("Control+z");
}

async function select(page: Page, mapping: Mapping, x: number, y: number, text: string): Promise<void> {
  await click(page, mapping, x, y);
  await expect(propertyPanel(page)).toContainText(text);
}

/** 何も無い所に、横の線 (20,200)-(180,200) を足し、その端点に、水平寸法を、y = 160 の高さに描く(測定値 160)。寸法は、両端を、線に関連付ける */
async function drawLinkedDimension(page: Page, mapping: Mapping): Promise<void> {
  await page.evaluate(() => window.__cadDev!.addLine(20, 200, 180, 200));
  await typeCommand(page, "dh");
  await click(page, mapping, 20, 200);
  await click(page, mapping, 180, 200);
  await click(page, mapping, 100, 160);
  await expect(log(page)).toContainText("水平寸法を追加しました(160)");
  await expect(log(page)).toContainText("図形に関連付けました(2か所)");
}

test.describe("associating at creation", () => {
  test("clicking the end points of a figure links the dimension (2 places); the properties show the references", async ({ page }) => {
    const mapping = await openEditable(page);
    await drawLinkedDimension(page, mapping);
    await select(page, mapping, 60, 160, "DIMENSION");
    await expect(propertyPanel(page)).toContainText(/Associativity\s*Associated/);
    await expect(propertyPanel(page)).toContainText(/Reference p1\s*n\d+ start/);
    await expect(propertyPanel(page)).toContainText(/Reference p2\s*n\d+ end/);
  });

  test("points that are not on a figure position stay plain: no link, no message about linking", async ({ page }) => {
    const mapping = await openEditable(page);
    await typeCommand(page, "dh");
    // 何も無い所の2点(吸着する図形が無い)
    await click(page, mapping, 40, 330);
    await click(page, mapping, 160, 330);
    await click(page, mapping, 100, 290);
    await expect(log(page)).toContainText("水平寸法を追加しました(120)");
    await expect(log(page)).not.toContainText("関連付けました");
    await select(page, mapping, 60, 290, "DIMENSION");
    await expect(propertyPanel(page)).toContainText(/Associativity\s*None/);
  });
});

test.describe("following the figure", () => {
  test("SCALE of the line: the dimension value follows (160 → 320); one Undo restores both; Redo repeats", async ({ page }) => {
    const mapping = await openEditable(page);
    await drawLinkedDimension(page, mapping);
    const before = await entityCount(page);
    await select(page, mapping, 150, 200, "LINE");
    await typeCommand(page, "scale");
    await typeCommand(page, "20,200");
    await typeCommand(page, "2");
    await expect(log(page)).toContainText("拡大縮小しました");
    expect(await entityCount(page)).toBe(before);
    await select(page, mapping, 60, 160, "DIMENSION");
    await expect(propertyPanel(page)).toContainText(/Measurement\s*320/);
    await expect(propertyPanel(page)).toContainText(/Associativity\s*Associated/);

    await undo(page);
    await expect(log(page)).toContainText("元に戻しました: 図形を拡大縮小");
    await select(page, mapping, 60, 160, "DIMENSION");
    await expect(propertyPanel(page)).toContainText(/Measurement\s*160/);
    await page.keyboard.press("Control+y");
    await expect(log(page)).toContainText("やり直しました");
    await select(page, mapping, 60, 160, "DIMENSION");
    await expect(propertyPanel(page)).toContainText(/Measurement\s*320/);
  });

  test("MOVE of the line: the measuring points follow it, the dimension line stays where it was", async ({ page }) => {
    const mapping = await openEditable(page);
    await drawLinkedDimension(page, mapping);
    await select(page, mapping, 150, 200, "LINE");
    await typeCommand(page, "move");
    await click(page, mapping, 100, 200);
    await click(page, mapping, 100, 240);
    await expect(log(page)).toContainText("移動しました");
    // 平行寸法の測定値は、動かしても変わらない。寸法線 (y = 160) の位置も、そのまま
    await select(page, mapping, 60, 160, "DIMENSION");
    await expect(propertyPanel(page)).toContainText(/Measurement\s*160/);
    await expect(propertyPanel(page)).toContainText(/Associativity\s*Associated/);
  });
});

test.describe("broken reference", () => {
  test("deleting the figure: a warning in the log, the dimension turns red and says Broken Reference; Undo brings back both", async ({ page }) => {
    const mapping = await openEditable(page);
    await drawLinkedDimension(page, mapping);
    // 寸法が赤くない(線の色は、レイヤーの色)ことを、先に確かめる
    const onLine = at(mapping, 100, 160);
    expect(await hasHueNear(page, onLine, [255, 59, 48], 4)).toBe(false);

    await select(page, mapping, 150, 200, "LINE");
    await page.keyboard.press("Delete");
    await expect(log(page)).toContainText("参照が切れました");
    await expect(log(page)).toContainText("Broken Reference");
    // 選択が外れるので、寸法線の上をクリックして選ぶ
    await select(page, mapping, 60, 160, "DIMENSION");
    await expect(propertyPanel(page)).toContainText(/Associativity\s*Broken Reference/);
    await expect(propertyPanel(page)).toContainText("(broken)");
    // 選択をやめて、警告の色(赤)を見る
    await page.keyboard.press("Escape");
    await expect.poll(() => hasHueNear(page, onLine, [255, 59, 48], 4)).toBe(true);

    await undo(page);
    await expect(log(page)).toContainText("元に戻しました");
    await select(page, mapping, 60, 160, "DIMENSION");
    await expect(propertyPanel(page)).toContainText(/Associativity\s*Associated/);
    await page.keyboard.press("Escape");
    await expect.poll(() => hasHueNear(page, onLine, [255, 59, 48], 4)).toBe(false);
  });

  test("DIMREASSOC repairs it: link the dimension to a new line (click its end points), and it follows that line again", async ({ page }) => {
    const mapping = await openEditable(page);
    await drawLinkedDimension(page, mapping);
    await select(page, mapping, 150, 200, "LINE");
    await page.keyboard.press("Delete");
    await expect(log(page)).toContainText("参照が切れました");
    await page.evaluate(() => window.__cadDev!.addLine(20, 200, 180, 200));
    await typeCommand(page, "dre");
    await expect(label(page)).toHaveText("DIMREASSOC:");
    await click(page, mapping, 100, 160); // 寸法をクリック
    await expect(log(page)).toContainText("1つ目の点を図形に付けます");
    await click(page, mapping, 20, 200);
    await expect(log(page)).toContainText("2つ目の点を図形に付けます");
    await click(page, mapping, 180, 200);
    await expect(log(page)).toContainText("寸法を関連付けました(2か所)");
    await expect(label(page)).toHaveText("コマンド:");
    await select(page, mapping, 60, 160, "DIMENSION");
    await expect(propertyPanel(page)).toContainText(/Associativity\s*Associated/);

    // 新しい線を拡大縮小すると、寸法が追従する
    await select(page, mapping, 150, 200, "LINE");
    await typeCommand(page, "scale");
    await typeCommand(page, "20,200");
    await typeCommand(page, "0.5");
    await select(page, mapping, 100, 160, "DIMENSION");
    await expect(propertyPanel(page)).toContainText(/Measurement\s*80/);
  });

  test("DIMREASSOC refuses a click that is not on a figure position, and a click on a figure that is not a dimension", async ({ page }) => {
    const mapping = await openEditable(page);
    await drawLinkedDimension(page, mapping);
    await typeCommand(page, "dre");
    await click(page, mapping, 150, 200); // 線(寸法ではない)
    await expect(log(page)).toContainText("できません");
    await click(page, mapping, 100, 160); // 寸法
    await expect(log(page)).toContainText("1つ目の点を図形に付けます");
    await click(page, mapping, 60, 330); // 何も無い所
    await expect(log(page)).toContainText("一致しません");
    await page.keyboard.press("Escape");
    await expect(label(page)).toHaveText("コマンド:");
  });
});

test.describe("the dimension itself is edited", () => {
  test("moving the dimension alone releases its links (and says so); the line then no longer drags it", async ({ page }) => {
    const mapping = await openEditable(page);
    await drawLinkedDimension(page, mapping);
    await select(page, mapping, 60, 160, "DIMENSION");
    await typeCommand(page, "move");
    await click(page, mapping, 100, 160);
    await click(page, mapping, 100, 120);
    await expect(log(page)).toContainText("移動しました");
    await expect(log(page)).toContainText("関連付けを");
    await select(page, mapping, 60, 120, "DIMENSION");
    await expect(propertyPanel(page)).toContainText(/Associativity\s*None/);
  });

  test("copying a linked dimension gives a plain dimension (no link)", async ({ page }) => {
    const mapping = await openEditable(page);
    await drawLinkedDimension(page, mapping);
    const before = await entityCount(page);
    await select(page, mapping, 60, 160, "DIMENSION");
    await typeCommand(page, "copy");
    await click(page, mapping, 100, 160);
    await click(page, mapping, 100, 100);
    await page.keyboard.press("Escape");
    expect(await entityCount(page)).toBe(before + 1);
    await select(page, mapping, 60, 100, "DIMENSION");
    await expect(propertyPanel(page)).toContainText(/Associativity\s*None/);
  });
});
