// 形を変える編集(MIRROR・SCALE・STRETCH。Phase 10)のE2Eテスト。
// 工場レイアウトの図面の、取り込んだ図形(線 (100,100)-(500,100)、円 (300,300) 半径 100)を、選んで編集する。
// ブロック(INSERT)の中身(円 (850,500) 半径 20 など)は、読み取り専用で、編集を断る。
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

/** 入力欄のフォーカスを外してから、元に戻す・やり直す(入力欄にフォーカスがあると、Ctrl+Z は、入力欄の文字の取り消しになる) */
async function undo(page: Page): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("Control+z");
}

/** 図形をクリックして選び、プロパティの種類が出るのを待つ */
async function select(page: Page, p: Pt, type: string): Promise<void> {
  await page.mouse.click(p.x, p.y);
  await expect(propertyPanel(page)).toContainText(type);
}

async function readPoint(page: Page, name: "Start" | "End" | "Center"): Promise<{ x: number; y: number }> {
  const text = await propertyPanel(page).innerText();
  const match = new RegExp(`${name} X\\/Y\\s*(-?[\\d.]+) mm, (-?[\\d.]+) mm`).exec(text);
  if (match === null) throw new Error(`${name} を読み取れません: ${text}`);
  return { x: Number(match[1]), y: Number(match[2]) };
}

async function readRadius(page: Page): Promise<number> {
  const text = await propertyPanel(page).innerText();
  const match = /Radius\s*(-?[\d.]+)/.exec(text);
  if (match === null) throw new Error(`Radius を読み取れません: ${text}`);
  return Number(match[1]);
}

const MACHINE_LINE = (mapping: Mapping) => at(mapping, 200, 100);
const CIRCLE_RIM = (mapping: Mapping) => at(mapping, 400, 300);
// ブロック(INSERT)の中身の円 (850,500) 半径 20 の縁
const BLOCK_CIRCLE = (mapping: Mapping) => at(mapping, 870, 500);

test.describe("SCALE", () => {
  test("a typed factor scales a circle about the base point; Undo restores it as one step", async ({ page }) => {
    const mapping = await openEditable(page);
    await select(page, CIRCLE_RIM(mapping), "CIRCLE");
    expect(await readRadius(page)).toBe(100);

    await typeCommand(page, "scale");
    await expect(label(page)).toHaveText("SCALE:");
    await typeCommand(page, "300,300");
    await expect(log(page)).toContainText("倍率を入力してください");
    await typeCommand(page, "2");
    await expect(log(page)).toContainText("1個の図形を拡大縮小しました");
    await expect(label(page)).toHaveText("コマンド:");
    expect(await readRadius(page)).toBe(200);
    expect(await readPoint(page, "Center")).toEqual({ x: 300, y: 300 }); // 基点が円の中心なので、中心は動かない

    await undo(page);
    await expect(log(page)).toContainText("元に戻しました: 図形を拡大縮小");
    expect(await readRadius(page)).toBe(100);
  });

  test("a base point away from the shape moves it: the line is scaled about (100,100)", async ({ page }) => {
    const mapping = await openEditable(page);
    await select(page, MACHINE_LINE(mapping), "LINE");
    await typeCommand(page, "scale");
    await typeCommand(page, "0,0");
    await typeCommand(page, "0.5");
    await expect(log(page)).toContainText("1個の図形を拡大縮小しました");
    expect(await readPoint(page, "Start")).toEqual({ x: 50, y: 50 });
    expect(await readPoint(page, "End")).toEqual({ x: 250, y: 50 });
  });

  test("R (reference): a reference length and a new length give the factor", async ({ page }) => {
    const mapping = await openEditable(page);
    await select(page, MACHINE_LINE(mapping), "LINE");
    await typeCommand(page, "scale");
    await typeCommand(page, "100,100");
    await typeCommand(page, "r");
    await expect(log(page)).toContainText("参照の長さ");
    await typeCommand(page, "400"); // 線の長さ
    await expect(log(page)).toContainText("新しい長さ");
    await typeCommand(page, "800");
    await expect(log(page)).toContainText("1個の図形を拡大縮小しました");
    expect(await readPoint(page, "Start")).toEqual({ x: 100, y: 100 });
    expect(await readPoint(page, "End")).toEqual({ x: 900, y: 100 });
  });

  test("an unusable factor (0, 1) keeps asking; the clicking of a point is not a factor; the toolbar button starts the command", async ({ page }) => {
    const mapping = await openEditable(page);
    await select(page, MACHINE_LINE(mapping), "LINE");
    await toolbarButton(page, "拡大縮小").click();
    await expect(label(page)).toHaveText("SCALE:");
    await typeCommand(page, "0,0");
    await typeCommand(page, "0");
    await expect(log(page)).toContainText("0より大きい");
    await typeCommand(page, "1");
    await expect(log(page)).toContainText("倍率が1です");
    await expect(label(page)).toHaveText("SCALE:");
    await page.keyboard.press("Escape");
    expect(await readPoint(page, "End")).toEqual({ x: 500, y: 100 }); // 動いていない
  });
});

test.describe("MIRROR", () => {
  test("Enter (the default 'no') adds a mirrored copy and keeps the original; Undo removes the copy", async ({ page }) => {
    const mapping = await openEditable(page);
    const before = await entityCount(page);
    await select(page, MACHINE_LINE(mapping), "LINE");
    await typeCommand(page, "mirror");
    await expect(log(page)).toContainText("鏡像軸の1点目");
    await typeCommand(page, "0,300");
    await typeCommand(page, "1000,300"); // y = 300 を軸にする
    await expect(log(page)).toContainText("元の図形を削除しますか?");
    await typeCommand(page, ""); // 既定は「いいえ」
    await expect(log(page)).toContainText("複写しました(合計 1 個を追加)");
    expect(await entityCount(page)).toBe(before + 1);
    expect(await readPoint(page, "Start")).toEqual({ x: 100, y: 100 }); // 元の図形は、そのまま

    await undo(page);
    await expect(log(page)).toContainText("元に戻しました: 図形を鏡像コピー");
    expect(await entityCount(page)).toBe(before);
  });

  test("Y replaces the original by its mirror image (same entity, same count); Undo brings it back", async ({ page }) => {
    const mapping = await openEditable(page);
    const before = await entityCount(page);
    await select(page, MACHINE_LINE(mapping), "LINE");
    await typeCommand(page, "mirror");
    await typeCommand(page, "0,300");
    await typeCommand(page, "1000,300");
    await typeCommand(page, "y");
    await expect(log(page)).toContainText("1個の図形を鏡像化しました");
    expect(await entityCount(page)).toBe(before);
    expect(await readPoint(page, "Start")).toEqual({ x: 100, y: 500 }); // y' = 600 - y
    expect(await readPoint(page, "End")).toEqual({ x: 500, y: 500 });

    await undo(page);
    expect(await readPoint(page, "Start")).toEqual({ x: 100, y: 100 });
  });

  test("a vertical axis mirrors a circle exactly (center x' = 2a - x)", async ({ page }) => {
    const mapping = await openEditable(page);
    await select(page, CIRCLE_RIM(mapping), "CIRCLE");
    await typeCommand(page, "mi");
    await typeCommand(page, "500,0");
    await typeCommand(page, "500,600");
    await typeCommand(page, "yes");
    expect(await readPoint(page, "Center")).toEqual({ x: 700, y: 300 });
    expect(await readRadius(page)).toBe(100);
  });

  test("any other answer keeps asking; the block contents are refused as read-only", async ({ page }) => {
    const mapping = await openEditable(page);
    await select(page, MACHINE_LINE(mapping), "LINE");
    await typeCommand(page, "mirror");
    await typeCommand(page, "0,300");
    await typeCommand(page, "1000,300");
    await typeCommand(page, "maybe");
    await expect(log(page)).toContainText("Y(はい)か N(いいえ)");
    await expect(label(page)).toHaveText("MIRROR:");
    await page.keyboard.press("Escape");
    await expect(label(page)).toHaveText("コマンド:");

    await select(page, BLOCK_CIRCLE(mapping), "CIRCLE");
    await typeCommand(page, "mirror");
    await expect(log(page)).toContainText("編集できる図形が選択されていません");
    await expect(log(page)).toContainText("読み取り専用");
  });
});

test.describe("STRETCH", () => {
  test("a crossing window around the start of a line: only that end moves", async ({ page }) => {
    const mapping = await openEditable(page);
    await typeCommand(page, "stretch");
    await expect(label(page)).toHaveText("STRETCH:");
    await typeCommand(page, "50,50");
    await typeCommand(page, "150,150"); // 線 (100,100)-(500,100) の始点だけが入る窓
    await expect(log(page)).toContainText("窓にかかる図形");
    await typeCommand(page, "0,0"); // 基点
    await typeCommand(page, "@0,100"); // 上へ 100
    await expect(log(page)).toContainText("1個の図形をストレッチしました");
    await expect(log(page)).toContainText("形が変わった 1 個");
    await expect(label(page)).toHaveText("コマンド:");

    // 線は、(100,200)-(500,100) になった。中点 (300,150) をクリックして確かめる
    await select(page, at(mapping, 300, 150), "LINE");
    expect(await readPoint(page, "Start")).toEqual({ x: 100, y: 200 });
    expect(await readPoint(page, "End")).toEqual({ x: 500, y: 100 });

    await undo(page);
    await expect(log(page)).toContainText("元に戻しました: ストレッチ");
    await select(page, MACHINE_LINE(mapping), "LINE");
    expect(await readPoint(page, "Start")).toEqual({ x: 100, y: 100 });
  });

  test("a window around a whole circle moves it as a whole; a window with nothing ends the command", async ({ page }) => {
    const mapping = await openEditable(page);
    await typeCommand(page, "s");
    await typeCommand(page, "190,190");
    await typeCommand(page, "410,410"); // 円 (300,300) 半径 100 が、全体入る
    await typeCommand(page, "0,0");
    await typeCommand(page, "@50,0");
    await expect(log(page)).toContainText("図形ごと移動");
    await select(page, at(mapping, 450, 300), "CIRCLE");
    expect(await readPoint(page, "Center")).toEqual({ x: 350, y: 300 });

    await typeCommand(page, "stretch");
    await typeCommand(page, "2000,2000");
    await typeCommand(page, "2100,2100");
    await expect(log(page)).toContainText("編集できる図形がありません");
    await expect(label(page)).toHaveText("コマンド:");
  });

  test("the same corner twice and the same base/target point are refused; Esc ends without a change", async ({ page }) => {
    await openEditable(page);
    await typeCommand(page, "stretch");
    await typeCommand(page, "50,50");
    await typeCommand(page, "50,50");
    await expect(log(page)).toContainText("窓の大きさが0です");
    await typeCommand(page, "150,150");
    await typeCommand(page, "10,10");
    await typeCommand(page, "10,10");
    await expect(log(page)).toContainText("移動量が0です");
    await page.keyboard.press("Escape");
    await expect(label(page)).toHaveText("コマンド:");
  });

  test("the toolbar button starts the command", async ({ page }) => {
    await openEditable(page);
    await toolbarButton(page, "ストレッチ").click();
    await expect(label(page)).toHaveText("STRETCH:");
    await expect(log(page)).toContainText("窓の1点目");
  });
});
