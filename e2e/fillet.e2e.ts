// フィレット(FILLET)・面取り(CHAMFER)(Phase 13)のE2Eテスト。
// 工場レイアウトの図面の何も無い所に、開発用の入口で線を2本足して(新しく描いた図形)、角を丸める・面取りする。
// 取り込んだ長方形(WALL の閉じた折れ線)の角も処理する。図形を指すクリックは、吸着しない。
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
const toolbarButton = (page: Page, name: string) => page.locator(".toolbar").getByRole("button", { name, exact: true });
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

async function select(page: Page, p: Pt, type: string): Promise<void> {
  await page.mouse.click(p.x, p.y);
  await expect(propertyPanel(page)).toContainText(type);
}

async function readPoint(page: Page, name: "Start" | "End"): Promise<{ x: number; y: number }> {
  const text = await propertyPanel(page).innerText();
  const match = new RegExp(`${name} X\\/Y\\s*(-?[\\d.]+) mm, (-?[\\d.]+) mm`).exec(text);
  if (match === null) throw new Error(`${name} を読み取れません: ${text}`);
  return { x: Number(match[1]), y: Number(match[2]) };
}

/** 何も無い所に、横の線 A (40,300)-(160,300) と、縦の線 B (100,260)-(100,400) を足す。2本は (100,300) で交わる */
async function addCross(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__cadDev!.addLine(40, 300, 160, 300);
    window.__cadDev!.addLine(100, 260, 100, 400);
  });
}

test.describe("FILLET", () => {
  test("radius, then two lines: both lines are cut at the tangent points and an arc is added; one Undo restores everything", async ({ page }) => {
    const mapping = await openEditable(page);
    await addCross(page);
    const before = await entityCount(page);
    await typeCommand(page, "fillet");
    await expect(label(page)).toHaveText("FILLET:");
    await expect(log(page)).toContainText("半径を入力");
    await typeCommand(page, "40");
    await expect(log(page)).toContainText("1つ目の線");
    const first = at(mapping, 60, 300); // 横の線の、左の腕
    await page.mouse.click(first.x, first.y);
    await expect(log(page)).toContainText("2つ目の線");
    const second = at(mapping, 100, 380); // 縦の線の、上の腕
    await page.mouse.click(second.x, second.y);
    await expect(log(page)).toContainText("角を丸めました(半径 40)");
    expect(await entityCount(page)).toBe(before + 1);
    await expect(label(page)).toHaveText("FILLET:"); // コマンドは続く
    await page.keyboard.press("Escape");
    await expect(label(page)).toHaveText("コマンド:");

    // 横の線は、左の腕だけ(交点 (100,300) 側の端が、接点 (60,300) へ)。縦の線は、上の腕だけ(下の端が、接点 (100,340) へ)
    await select(page, at(mapping, 50, 300), "LINE");
    expect(await readPoint(page, "Start")).toEqual({ x: 40, y: 300 });
    expect(await readPoint(page, "End")).toEqual({ x: 60, y: 300 });
    await select(page, at(mapping, 100, 380), "LINE");
    expect(await readPoint(page, "Start")).toEqual({ x: 100, y: 340 });
    expect(await readPoint(page, "End")).toEqual({ x: 100, y: 400 });
    // 円弧(中心 (60,340)、半径 40)の、45° の位置
    await select(page, at(mapping, 60 + 40 * Math.cos(-Math.PI / 4), 340 + 40 * Math.sin(-Math.PI / 4)), "ARC");

    await undo(page);
    await expect(log(page)).toContainText("元に戻しました: 角を丸める");
    expect(await entityCount(page)).toBe(before);
    await select(page, at(mapping, 150, 300), "LINE"); // 右の腕も、元どおり
    expect(await readPoint(page, "End")).toEqual({ x: 160, y: 300 });
  });

  test("radius 0 joins the lines at the intersection (no arc is added)", async ({ page }) => {
    const mapping = await openEditable(page);
    await page.evaluate(() => {
      window.__cadDev!.addLine(40, 300, 80, 300); // 交点 (100,300) に届かない線
      window.__cadDev!.addLine(100, 260, 100, 400);
    });
    const before = await entityCount(page);
    await typeCommand(page, "fil");
    await typeCommand(page, "0");
    const first = at(mapping, 60, 300);
    await page.mouse.click(first.x, first.y);
    const second = at(mapping, 100, 380);
    await page.mouse.click(second.x, second.y);
    await expect(log(page)).toContainText("角を作りました");
    expect(await entityCount(page)).toBe(before);
    await page.keyboard.press("Escape");
    await select(page, at(mapping, 60, 300), "LINE");
    expect(await readPoint(page, "End")).toEqual({ x: 100, y: 300 }); // 延びた
    await select(page, at(mapping, 100, 380), "LINE");
    expect(await readPoint(page, "Start")).toEqual({ x: 100, y: 300 }); // 下の腕が短くなった
  });

  test("a radius that is too large is refused with the reason; nothing changes", async ({ page }) => {
    const mapping = await openEditable(page);
    await addCross(page);
    const before = await entityCount(page);
    await typeCommand(page, "fillet");
    await typeCommand(page, "500");
    const first = at(mapping, 60, 300);
    await page.mouse.click(first.x, first.y);
    const second = at(mapping, 100, 380);
    await page.mouse.click(second.x, second.y);
    await expect(log(page)).toContainText("半径が大きすぎます");
    expect(await entityCount(page)).toBe(before);
    await expect(label(page)).toHaveText("FILLET:");
    await page.keyboard.press("Escape");
  });

  test("a corner of the imported rectangle (a closed polyline) is rounded: the figure is replaced, not added", async ({ page }) => {
    const mapping = await openEditable(page);
    const before = await entityCount(page);
    await typeCommand(page, "fillet");
    await typeCommand(page, "100");
    const bottom = at(mapping, 900, 0); // 下の壁
    await page.mouse.click(bottom.x, bottom.y);
    const right = at(mapping, 1000, 200); // 右の壁
    await page.mouse.click(right.x, right.y);
    await expect(log(page)).toContainText("角を丸めました(半径 100)");
    expect(await entityCount(page)).toBe(before); // 図形は増えない
    await page.keyboard.press("Escape");
    // 角 (1000,0) の位置には、もう壁が無い。円弧(中心 (900,100)、半径 100)の、45° の位置には、壁がある
    await select(page, at(mapping, 900 + 100 * Math.cos(-Math.PI / 4), 100 + 100 * Math.sin(-Math.PI / 4)), "LWPOLYLINE");

    await undo(page);
    await expect(log(page)).toContainText("元に戻しました: 角を丸める");
    expect(await entityCount(page)).toBe(before);
  });

  test("clicking a circle is refused (lines and polylines only); an empty place shows the reason", async ({ page }) => {
    const mapping = await openEditable(page);
    await typeCommand(page, "fillet");
    await typeCommand(page, "10");
    const circle = at(mapping, 200, 300); // MACHINE の円(中心 (300,300)、半径 100)の左端
    await page.mouse.click(circle.x, circle.y);
    await expect(log(page)).toContainText("CIRCLE は、フィレットできません");
    const empty = at(mapping, 100, 350);
    await page.mouse.click(empty.x, empty.y);
    await expect(log(page)).toContainText("クリックした所に図形がありません");
    await expect(label(page)).toHaveText("FILLET:");
    await page.keyboard.press("Escape");
  });

  test("the toolbar button starts FILLET", async ({ page }) => {
    await openEditable(page);
    await toolbarButton(page, "フィレット").click();
    await expect(label(page)).toHaveText("FILLET:");
    await page.keyboard.press("Escape");
  });
});

test.describe("CHAMFER", () => {
  test("distance 1 and 2, then two lines: a chamfer line is added; one Undo restores everything", async ({ page }) => {
    const mapping = await openEditable(page);
    await addCross(page);
    const before = await entityCount(page);
    await typeCommand(page, "chamfer");
    await expect(label(page)).toHaveText("CHAMFER:");
    await typeCommand(page, "30");
    await expect(log(page)).toContainText("2つ目の距離");
    await typeCommand(page, "50");
    const first = at(mapping, 60, 300);
    await page.mouse.click(first.x, first.y);
    const second = at(mapping, 100, 380);
    await page.mouse.click(second.x, second.y);
    await expect(log(page)).toContainText("角を面取りしました(距離 30, 50)");
    expect(await entityCount(page)).toBe(before + 1);
    await page.keyboard.press("Escape");

    // 距離1(30)は横の線の上、距離2(50)は縦の線の上。面取りの線は (70,300)-(100,350)
    await select(page, at(mapping, 85, 325), "LINE");
    expect(await readPoint(page, "Start")).toEqual({ x: 70, y: 300 });
    expect(await readPoint(page, "End")).toEqual({ x: 100, y: 350 });
    await select(page, at(mapping, 50, 300), "LINE");
    expect(await readPoint(page, "End")).toEqual({ x: 70, y: 300 });

    await undo(page);
    await expect(log(page)).toContainText("元に戻しました: 角を面取りする");
    expect(await entityCount(page)).toBe(before);
  });

  test("a corner of the imported rectangle is chamfered (one polyline, vertices replaced)", async ({ page }) => {
    const mapping = await openEditable(page);
    const before = await entityCount(page);
    await typeCommand(page, "cha");
    await typeCommand(page, "80");
    await typeCommand(page, "80");
    const bottom = at(mapping, 900, 0);
    await page.mouse.click(bottom.x, bottom.y);
    const right = at(mapping, 1000, 200);
    await page.mouse.click(right.x, right.y);
    await expect(log(page)).toContainText("角を面取りしました(距離 80, 80)");
    expect(await entityCount(page)).toBe(before);
    await page.keyboard.press("Escape");
    await select(page, at(mapping, 960, 40), "LWPOLYLINE"); // 面取りの斜めの辺 (920,0)-(1000,80) の真ん中
  });

  test("only one of the two distances being 0 is refused", async ({ page }) => {
    await openEditable(page);
    await typeCommand(page, "chamfer");
    await typeCommand(page, "0");
    await typeCommand(page, "5");
    await expect(log(page)).toContainText("片方だけ 0");
    await expect(label(page)).toHaveText("CHAMFER:");
    await page.keyboard.press("Escape");
  });

  test("the toolbar button starts CHAMFER", async ({ page }) => {
    await openEditable(page);
    await toolbarButton(page, "面取り").click();
    await expect(label(page)).toHaveText("CHAMFER:");
    await page.keyboard.press("Escape");
  });
});
