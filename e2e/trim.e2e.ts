// トリム・延長(TRIM・EXTEND。Phase 11)のE2Eテスト。
// 工場レイアウトの図面の、取り込んだ線 (100,100)-(500,100) を、作図した縦の線(境界)で切る・延ばす。
// クリックは、吸着しない(境界との交点の近くをクリックしても、クリックした側が切られる)。
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

/** 縦の線を、座標を打って描く(境界にする) */
async function drawVertical(page: Page, x: number, y0 = 50, y1 = 150): Promise<void> {
  await typeCommand(page, "line");
  await typeCommand(page, `${x},${y0}`);
  await typeCommand(page, `${x},${y1}`);
  await typeCommand(page, ""); // 終了
  await expect(log(page)).toContainText("1本の線を追加しました");
}

const MACHINE_LINE = (mapping: Mapping, x = 300) => at(mapping, x, 100);

test.describe("TRIM", () => {
  test("between two boundaries: the clicked part goes and the line splits in two; one Undo restores it", async ({ page }) => {
    const mapping = await openEditable(page);
    await drawVertical(page, 200);
    await drawVertical(page, 400);
    const before = await entityCount(page);

    await typeCommand(page, "trim");
    await expect(label(page)).toHaveText("TRIM:");
    await expect(log(page)).toContainText("切り取り境界の図形を選択");
    await typeCommand(page, ""); // 何も選ばずに Enter = すべての図形
    await expect(log(page)).toContainText("すべての図形を境界にします");
    const click = MACHINE_LINE(mapping, 300);
    await page.mouse.click(click.x, click.y);
    await expect(log(page)).toContainText("図形をトリムしました(2つの図形に分かれました)");
    expect(await entityCount(page)).toBe(before + 1);
    await expect(label(page)).toHaveText("TRIM:"); // コマンドは続く
    await page.keyboard.press("Escape");
    await expect(label(page)).toHaveText("コマンド:");

    await select(page, at(mapping, 150, 100), "LINE");
    expect(await readPoint(page, "Start")).toEqual({ x: 100, y: 100 });
    expect(await readPoint(page, "End")).toEqual({ x: 200, y: 100 });
    await select(page, at(mapping, 450, 100), "LINE");
    expect(await readPoint(page, "Start")).toEqual({ x: 400, y: 100 });
    expect(await readPoint(page, "End")).toEqual({ x: 500, y: 100 });

    await undo(page);
    await expect(log(page)).toContainText("元に戻しました: 図形をトリム");
    expect(await entityCount(page)).toBe(before);
    await select(page, MACHINE_LINE(mapping), "LINE");
    expect(await readPoint(page, "Start")).toEqual({ x: 100, y: 100 });
    expect(await readPoint(page, "End")).toEqual({ x: 500, y: 100 });
  });

  test("a click near a crossing is NOT snapped to it: the clicked side is the one that goes", async ({ page }) => {
    const mapping = await openEditable(page);
    await drawVertical(page, 200);
    await drawVertical(page, 400);
    await typeCommand(page, "tr");
    await typeCommand(page, "");
    // 境界 x=200 の、すぐ左(5mm)。吸着されて x=200 の交点になると、反対側(右)が切れてしまう
    const click = at(mapping, 195, 100);
    await page.mouse.click(click.x, click.y);
    await expect(log(page)).toContainText("図形をトリムしました");
    await page.keyboard.press("Escape");
    await select(page, MACHINE_LINE(mapping, 300), "LINE");
    expect(await readPoint(page, "Start")).toEqual({ x: 200, y: 100 });
    expect(await readPoint(page, "End")).toEqual({ x: 500, y: 100 });
  });

  test("a selected figure is the only boundary", async ({ page }) => {
    const mapping = await openEditable(page);
    await drawVertical(page, 200);
    await drawVertical(page, 400);
    // 縦の線 x=200 だけを選んで、トリム
    await select(page, at(mapping, 200, 130), "LINE");
    await typeCommand(page, "trim");
    await typeCommand(page, ""); // 選択を、境界として渡す
    await expect(log(page)).toContainText("境界の図形: 1個");
    const click = at(mapping, 350, 100);
    await page.mouse.click(click.x, click.y);
    await expect(log(page)).toContainText("図形をトリムしました");
    await page.keyboard.press("Escape");
    await select(page, at(mapping, 150, 100), "LINE");
    // 境界は x=200 だけ。右側(x=350)をクリックしたので、200 より右が、すべて消える
    expect(await readPoint(page, "End")).toEqual({ x: 200, y: 100 });
  });

  test("clicking where there is no figure, or a figure nothing crosses, says why and changes nothing", async ({ page }) => {
    const mapping = await openEditable(page);
    const before = await entityCount(page);
    await typeCommand(page, "trim");
    await typeCommand(page, "");
    const empty = at(mapping, 900, 300);
    await page.mouse.click(empty.x, empty.y);
    await expect(log(page)).toContainText("クリックした所に図形がありません");
    const noCross = MACHINE_LINE(mapping);
    await page.mouse.click(noCross.x, noCross.y); // 境界が、線と交わらない
    await expect(log(page)).toContainText("交わる境界がありません");
    expect(await entityCount(page)).toBe(before);
    await page.keyboard.press("Escape");
  });

  test("the toolbar button starts the command; Enter ends it", async ({ page }) => {
    await openEditable(page);
    await toolbarButton(page, "トリム").click();
    await expect(label(page)).toHaveText("TRIM:");
    await typeCommand(page, "");
    await typeCommand(page, "");
    await expect(log(page)).toContainText("TRIM を終了しました");
    await expect(label(page)).toHaveText("コマンド:");
  });
});

test.describe("EXTEND", () => {
  test("the end nearer to the click is extended to the nearest boundary; one Undo restores it", async ({ page }) => {
    const mapping = await openEditable(page);
    await drawVertical(page, 700);
    await typeCommand(page, "extend");
    await expect(label(page)).toHaveText("EXTEND:");
    await typeCommand(page, "");
    const click = at(mapping, 480, 100); // 右の端に近い所
    await page.mouse.click(click.x, click.y);
    await expect(log(page)).toContainText("図形を延長しました");
    await page.keyboard.press("Escape");
    await select(page, MACHINE_LINE(mapping), "LINE");
    expect(await readPoint(page, "Start")).toEqual({ x: 100, y: 100 });
    expect(await readPoint(page, "End")).toEqual({ x: 700, y: 100 });

    await undo(page);
    await expect(log(page)).toContainText("元に戻しました: 図形を延長");
    await select(page, MACHINE_LINE(mapping), "LINE");
    expect(await readPoint(page, "End")).toEqual({ x: 500, y: 100 });
  });

  test("the left end is extended when the click is near it; with a single chosen boundary, no boundary ahead says so", async ({ page }) => {
    const mapping = await openEditable(page);
    await drawVertical(page, 50);
    // 縦の線 x=50 だけを境界に選ぶ(「すべて」だと、図面の外枠 x=1000 も境界になる)
    await select(page, at(mapping, 50, 130), "LINE");
    await typeCommand(page, "ex");
    await typeCommand(page, "");
    await expect(log(page)).toContainText("境界の図形: 1個");
    const left = at(mapping, 120, 100);
    await page.mouse.click(left.x, left.y);
    await expect(log(page)).toContainText("図形を延長しました");
    await page.mouse.click(at(mapping, 480, 100).x, at(mapping, 480, 100).y); // 右の先には、境界が無い
    await expect(log(page)).toContainText("延ばした先に、境界がありません");
    await page.keyboard.press("Escape");
    await select(page, MACHINE_LINE(mapping), "LINE");
    expect(await readPoint(page, "Start")).toEqual({ x: 50, y: 100 });
    expect(await readPoint(page, "End")).toEqual({ x: 500, y: 100 });
  });

  test("with every figure as the boundary, the drawing frame is a boundary too (the right end goes to x = 1000)", async ({ page }) => {
    const mapping = await openEditable(page);
    await typeCommand(page, "extend");
    await typeCommand(page, "");
    const right = at(mapping, 480, 100);
    await page.mouse.click(right.x, right.y);
    await expect(log(page)).toContainText("図形を延長しました");
    await page.keyboard.press("Escape");
    await select(page, MACHINE_LINE(mapping), "LINE");
    expect(await readPoint(page, "End")).toEqual({ x: 1000, y: 100 });
  });

  test("a circle cannot be extended and a block's contents are refused", async ({ page }) => {
    const mapping = await openEditable(page);
    await typeCommand(page, "extend");
    await typeCommand(page, "");
    const rim = at(mapping, 400, 300);
    await page.mouse.click(rim.x, rim.y);
    await expect(log(page)).toContainText("延長できません");
    const block = at(mapping, 870, 500); // ブロックの中身の円
    await page.mouse.click(block.x, block.y);
    await expect(log(page)).toContainText("読み取り専用");
    await page.keyboard.press("Escape");
  });
});
