// 編集(MOVE・COPY・ROTATE・DELETE、描画順の拡張。Phase 9)のE2Eテスト。
// 工場レイアウトの図面の、取り込んだ図形(線 (100,100)-(500,100)、円 (300,300) 半径 100)を、選んで編集する。
// ブロック(INSERT)の中身(例: (800,450)-(900,450) の線)は、読み取り専用で、編集を断る。
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { factoryLayoutDxf } from "../src/regression/fixtures";
import { calibrate, hasHueNear, openDrawing, propertyPanel } from "./helpers";
import type { Mapping, Pt } from "./helpers";
// window.__cadDev の型を取り込む(読み込むだけで、実行はしない)
import type {} from "../src/devHooks";

const WHITE: [number, number, number] = [255, 255, 255];

const log = (page: Page) => page.getByTestId("command-line-log");
const input = (page: Page) => page.getByTestId("command-line-input");
const label = (page: Page) => page.getByTestId("command-line-label");
const row = (page: Page, name: "x" | "y" | "length" | "angle") => page.getByTestId(`dynamic-input-${name}`);
const toolbarButton = (page: Page, name: string) => page.locator(".toolbar").getByRole("button", { name, exact: true });
const entityCount = (page: Page) => page.evaluate(() => window.__cadDev!.entityCount());
const entityOrder = (page: Page) => page.evaluate(() => window.__cadDev!.entityOrder());

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

async function clickAt(page: Page, p: Pt): Promise<void> {
  await page.mouse.click(p.x, p.y);
}

/** 入力欄のフォーカスを外してから、元に戻す・やり直す(入力欄にフォーカスがあると、Ctrl+Z は、入力欄の文字の取り消しになる) */
async function undo(page: Page): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("Control+z");
}
async function redo(page: Page): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("Control+y");
}

/** 図形をクリックして選び、プロパティの種類が出るのを待つ */
async function select(page: Page, p: Pt, type: string): Promise<void> {
  await clickAt(page, p);
  await expect(propertyPanel(page)).toContainText(type);
}

/** プロパティの座標(Start X/Y・End X/Y・Center X/Y)を読む */
async function readPoint(page: Page, name: "Start" | "End" | "Center"): Promise<{ x: number; y: number }> {
  const text = await propertyPanel(page).innerText();
  const match = new RegExp(`${name} X\\/Y\\s*(-?[\\d.]+) mm, (-?[\\d.]+) mm`).exec(text);
  if (match === null) throw new Error(`${name} を読み取れません: ${text}`);
  return { x: Number(match[1]), y: Number(match[2]) };
}

// 線 (100,100)-(500,100)・円 (300,300) 半径 100 をクリックする位置
const MACHINE_LINE = (mapping: Mapping) => at(mapping, 200, 100);
const CIRCLE_RIM = (mapping: Mapping) => at(mapping, 400, 300);
// ブロック(INSERT)の中身の円 (850,500) 半径 20 の縁。(線 (800,450)-(900,450) は、取り込んだ最上位の GUIDE の線 y=450 と重なるので使わない)
const BLOCK_LINE = (mapping: Mapping) => at(mapping, 870, 500);

test.describe("MOVE", () => {
  test("a selected line: base point, target point (relative); Undo / Redo restore and redo it as one step", async ({ page }) => {
    const mapping = await openEditable(page);
    await select(page, MACHINE_LINE(mapping), "LINE");
    expect(await readPoint(page, "Start")).toEqual({ x: 100, y: 100 });

    await typeCommand(page, "move");
    await expect(label(page)).toHaveText("MOVE:");
    await expect(log(page)).toContainText("基点を指示してください");
    await typeCommand(page, "0,0");
    await expect(log(page)).toContainText("移動先の点を指示してください");
    await typeCommand(page, "@50,20");
    await expect(log(page)).toContainText("1個の図形を移動しました");
    await expect(label(page)).toHaveText("コマンド:");
    expect(await readPoint(page, "Start")).toEqual({ x: 150, y: 120 });
    expect(await readPoint(page, "End")).toEqual({ x: 550, y: 120 });
    await expect(page.getByTestId("unsaved-indicator")).toBeVisible();

    await undo(page);
    await expect(log(page)).toContainText("元に戻しました: 図形を移動");
    expect(await readPoint(page, "Start")).toEqual({ x: 100, y: 100 });
    await redo(page);
    expect(await readPoint(page, "Start")).toEqual({ x: 150, y: 120 });
  });

  test("shows the moved shape as a white dashed preview while choosing the target, and removes it at the end", async ({ page }) => {
    const mapping = await openEditable(page);
    await select(page, CIRCLE_RIM(mapping), "CIRCLE");
    await typeCommand(page, "move");
    await typeCommand(page, "0,0");
    // 円 (300,300) 半径 100 を (50,80) だけ動かした円 (350,380) の右端 (450,380)
    const target = at(mapping, 50, 80);
    await page.mouse.move(target.x, target.y);
    await expect.poll(() => hasHueNear(page, at(mapping, 450, 380), WHITE, 5), { timeout: 5_000 }).toBe(true);
    await page.keyboard.press("Escape");
    await expect(label(page)).toHaveText("コマンド:");
    await expect.poll(() => hasHueNear(page, at(mapping, 450, 380), WHITE, 5), { timeout: 5_000 }).toBe(false);
    expect(await readPoint(page, "Center")).toEqual({ x: 300, y: 300 }); // 動いていない
  });

  test("without a selection: the command asks for one; the usual click selects it and Enter confirms", async ({ page }) => {
    const mapping = await openEditable(page);
    await typeCommand(page, "move");
    await expect(log(page)).toContainText("対象の図形を選択して、Enter を押してください");
    // 点の指示としては、受け付けない(クリックは、選択になる)
    await clickAt(page, MACHINE_LINE(mapping));
    await expect(propertyPanel(page)).toContainText("LINE");
    await expect(label(page)).toHaveText("MOVE:");
    await page.keyboard.press("Enter");
    await expect(log(page)).toContainText("基点を指示してください");
    await typeCommand(page, "0,0");
    await typeCommand(page, "@0,100");
    expect(await readPoint(page, "Start")).toEqual({ x: 100, y: 200 });
  });

  test("Enter with nothing selected keeps asking; Esc cancels", async ({ page }) => {
    await openEditable(page);
    await typeCommand(page, "move");
    await page.keyboard.press("Enter"); // 入力欄が空のまま
    await expect(log(page)).toContainText("図形が選択されていません");
    await expect(label(page)).toHaveText("MOVE:");
    await page.keyboard.press("Escape");
    await expect(label(page)).toHaveText("コマンド:");
    expect(await entityCount(page)).toBeGreaterThan(0);
  });

  test("a click-based move works with the toolbar button", async ({ page }) => {
    const mapping = await openEditable(page);
    await select(page, MACHINE_LINE(mapping), "LINE");
    await toolbarButton(page, "移動").click();
    await expect(label(page)).toHaveText("MOVE:");
    await typeCommand(page, "100,100");
    await clickAt(page, at(mapping, 100, 160));
    const start = await readPoint(page, "Start");
    expect(Math.abs(start.x - 100)).toBeLessThan(2); // クリックは画素単位なので、約60だけ上へ(x は、ほぼそのまま)
    expect(start.y).toBeGreaterThan(155);
    expect(start.y).toBeLessThan(165);
  });
});

test.describe("COPY", () => {
  test("repeats until Enter; all copies are one Undo step; the originals stay", async ({ page }) => {
    const mapping = await openEditable(page);
    const before = await entityCount(page);
    await select(page, CIRCLE_RIM(mapping), "CIRCLE");
    await typeCommand(page, "copy");
    await typeCommand(page, "0,0");
    await typeCommand(page, "@0,-150");
    await expect(log(page)).toContainText("次のコピー先の点を指示してください");
    expect(await entityCount(page)).toBe(before); // まだ確定していない
    await typeCommand(page, "@0,-300");
    await typeCommand(page, ""); // Enter で終了
    await expect(log(page)).toContainText("1個の図形を2回、複写しました");
    expect(await entityCount(page)).toBe(before + 2);
    expect(await readPoint(page, "Center")).toEqual({ x: 300, y: 300 }); // 選択は、もとの図形のまま

    await undo(page); // 1回で、2つとも消える
    expect(await entityCount(page)).toBe(before);
    await redo(page);
    expect(await entityCount(page)).toBe(before + 2);
  });

  test("Esc confirms the copies placed so far; U takes the last one back", async ({ page }) => {
    const mapping = await openEditable(page);
    const before = await entityCount(page);
    await select(page, CIRCLE_RIM(mapping), "CIRCLE");
    await typeCommand(page, "co");
    await typeCommand(page, "0,0");
    await typeCommand(page, "@0,-150");
    await typeCommand(page, "@0,-300");
    await typeCommand(page, "u");
    await page.keyboard.press("Escape");
    expect(await entityCount(page)).toBe(before + 1);
  });
});

test.describe("ROTATE", () => {
  test("a typed angle (90 degrees) rotates exactly about the base point", async ({ page }) => {
    const mapping = await openEditable(page);
    await select(page, MACHINE_LINE(mapping), "LINE");
    await typeCommand(page, "rotate");
    await typeCommand(page, "100,100"); // 線の始点
    await typeCommand(page, "90");
    await expect(log(page)).toContainText("1個の図形を回転しました");
    expect(await readPoint(page, "Start")).toEqual({ x: 100, y: 100 });
    expect(await readPoint(page, "End")).toEqual({ x: 100, y: 500 }); // 90度は正確(丸め誤差が出ない)
    await undo(page);
    expect(await readPoint(page, "End")).toEqual({ x: 500, y: 100 });
  });

  test("the dynamic input asks for the angle only, and a typed 45 shows in the field before Enter", async ({ page }) => {
    const mapping = await openEditable(page);
    await select(page, MACHINE_LINE(mapping), "LINE");
    await typeCommand(page, "ro");
    await typeCommand(page, "100,100");
    await page.mouse.move(at(mapping, 600, 300).x, at(mapping, 600, 300).y);
    await expect(row(page, "angle")).toBeVisible();
    await expect(row(page, "length")).toHaveCount(0);
    await expect(row(page, "x")).toHaveCount(0);
    await input(page).focus();
    await page.keyboard.type("45");
    await expect(row(page, "angle")).toHaveAttribute("data-state", "typing");
    await page.keyboard.press("Enter");
    const end = await readPoint(page, "End");
    expect(end.x).toBeCloseTo(100 + 400 * Math.SQRT1_2, 0);
    expect(end.y).toBeCloseTo(100 + 400 * Math.SQRT1_2, 0);
  });

  test("0 degrees is refused and the command keeps waiting", async ({ page }) => {
    const mapping = await openEditable(page);
    await select(page, MACHINE_LINE(mapping), "LINE");
    await typeCommand(page, "rotate");
    await typeCommand(page, "100,100");
    await typeCommand(page, "360");
    await expect(log(page)).toContainText("回転角が0度です");
    await expect(label(page)).toHaveText("ROTATE:");
    await page.keyboard.press("Escape");
    expect(await readPoint(page, "End")).toEqual({ x: 500, y: 100 });
  });
});

test.describe("DELETE", () => {
  test("the Delete key removes the selection; Undo brings it back", async ({ page }) => {
    const mapping = await openEditable(page);
    const before = await entityCount(page);
    await select(page, CIRCLE_RIM(mapping), "CIRCLE");
    await page.keyboard.press("Delete");
    await expect(log(page)).toContainText("1個の図形を削除しました");
    expect(await entityCount(page)).toBe(before - 1);
    await expect(propertyPanel(page)).not.toContainText("CIRCLE");
    await undo(page);
    expect(await entityCount(page)).toBe(before);
  });

  test("the toolbar button and the command line command do the same", async ({ page }) => {
    const mapping = await openEditable(page);
    const before = await entityCount(page);
    await select(page, MACHINE_LINE(mapping), "LINE");
    await toolbarButton(page, "削除").click();
    expect(await entityCount(page)).toBe(before - 1);
    await undo(page);
    await select(page, MACHINE_LINE(mapping), "LINE");
    await typeCommand(page, "delete");
    expect(await entityCount(page)).toBe(before - 1);
  });

  test("the Delete key does nothing without a selection, and not while typing in the command line", async ({ page }) => {
    await openEditable(page);
    const before = await entityCount(page);
    await page.keyboard.press("Delete");
    expect(await entityCount(page)).toBe(before);
    await input(page).focus();
    await page.keyboard.press("Delete");
    expect(await entityCount(page)).toBe(before);
  });
});

test.describe("read-only entities (the contents of a block)", () => {
  test("MOVE, ROTATE, COPY and DELETE refuse a block's contents with the reason, and nothing changes", async ({ page }) => {
    const mapping = await openEditable(page);
    const before = await entityCount(page);
    await select(page, BLOCK_LINE(mapping), "CIRCLE");
    for (const command of ["move", "copy", "rotate", "delete"]) {
      await typeCommand(page, command);
      await expect(log(page)).toContainText("読み取り専用");
      await expect(label(page)).toHaveText("コマンド:");
    }
    await page.keyboard.press("Delete");
    expect(await entityCount(page)).toBe(before);
    await expect(page.getByTestId("unsaved-indicator")).toHaveCount(0);
  });
});

test.describe("draw order of imported entities", () => {
  test("TOFRONT / TOBACK now work for an imported top-level entity (one Undo step each)", async ({ page }) => {
    const mapping = await openEditable(page);
    const original = await entityOrder(page);
    await select(page, MACHINE_LINE(mapping), "LINE");
    await typeCommand(page, "tofront");
    await expect(log(page)).toContainText("1個の図形を最前面へ移動しました");
    const afterFront = await entityOrder(page);
    expect(afterFront).toHaveLength(original.length);
    expect(afterFront).not.toEqual(original);
    await typeCommand(page, "toback");
    const afterBack = await entityOrder(page);
    expect(afterBack[0]).toBe(afterFront[afterFront.length - 1]); // 同じ図形が、最背面へ
    await undo(page);
    expect(await entityOrder(page)).toEqual(afterFront);
    await undo(page);
    expect(await entityOrder(page)).toEqual(original);
  });

  test("TOFRONT refuses a block's contents", async ({ page }) => {
    const mapping = await openEditable(page);
    await select(page, BLOCK_LINE(mapping), "CIRCLE");
    await typeCommand(page, "tofront");
    await expect(log(page)).toContainText("読み取り専用");
  });
});

test.describe("together with the other features", () => {
  test("MOVE with ORTHO: the target point is aligned to the axis from the base point (the preview and the result agree)", async ({ page }) => {
    const mapping = await openEditable(page);
    await page.getByTestId("status-toggle-ortho").click();
    await select(page, MACHINE_LINE(mapping), "LINE");
    await typeCommand(page, "move");
    await typeCommand(page, "100,100");
    await clickAt(page, at(mapping, 220, 108)); // 基点から右へ約120、少し上 -> 水平に揃う
    const start = await readPoint(page, "Start");
    expect(start.y).toBe(100); // 上下には動かない
    expect(start.x).toBeGreaterThan(215);
    expect(start.x).toBeLessThan(225);
  });

  test("a moved imported entity is a different place for the Snap (the endpoint is where it is now)", async ({ page }) => {
    const mapping = await openEditable(page);
    await select(page, MACHINE_LINE(mapping), "LINE");
    await typeCommand(page, "move");
    await typeCommand(page, "0,0");
    await typeCommand(page, "@0,100"); // 線は (100,200)-(500,200) に
    await page.keyboard.press("Escape");
    await typeCommand(page, "id");
    await clickAt(page, at(mapping, 502, 198)); // 新しい終点 (500,200) の近く
    await expect(log(page)).toContainText("X = 500.0, Y = 200.0");
  });
});
