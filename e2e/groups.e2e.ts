// グループ・ロック・描画順(Phase 19)のE2Eテスト。
// 見本図面(工場レイアウト)に、開発用の入口で線を足して(新しく描いた図形)、グループを作る・選ぶ・解除する。
// レイヤー WALL をロックして、外枠が選べない・動かない・薄く描かれる・吸着はできることを確かめる。
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { factoryLayoutDxf } from "../src/regression/fixtures";
import { calibrate, openDrawing, propertyPanel } from "./helpers";
import type { Mapping, Pt } from "./helpers";
// window.__cadDev の型を取り込む(読み込むだけで、実行はしない)
import type {} from "../src/devHooks";

const log = (page: Page) => page.getByTestId("command-line-log");
const input = (page: Page) => page.getByTestId("command-line-input");

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
/** 図面の点をクリックする。Ctrl を押しながらのクリックは、キーを押し下げて行う(page.mouse.click は、修飾キーを付けないため) */
async function click(page: Page, mapping: Mapping, x: number, y: number, modifiers: Array<"Control"> = []): Promise<void> {
  const p = at(mapping, x, y);
  for (const key of modifiers) await page.keyboard.down(key);
  await page.mouse.click(p.x, p.y);
  for (const key of modifiers) await page.keyboard.up(key);
}
async function blur(page: Page): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}
async function undo(page: Page): Promise<void> {
  await blur(page);
  await page.keyboard.press("Control+z");
}
const order = (page: Page) => page.evaluate(() => window.__cadDev!.entityOrder());

/** 画面の点の周り(半径 3px)の、赤の成分の最大値。ロックの前と後で比べて、薄くなったことを確かめる(線の位置による濃淡の差に左右されない) */
async function maxRed(page: Page, p: Pt): Promise<number> {
  return page.evaluate((at) => {
    const canvas = document.querySelector("canvas") as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    const ratio = canvas.width / rect.width;
    const cx = Math.round((at.x - rect.left) * ratio);
    const cy = Math.round((at.y - rect.top) * ratio);
    const r = Math.round(3 * ratio);
    const data = (canvas.getContext("2d") as CanvasRenderingContext2D).getImageData(cx - r, cy - r, 2 * r + 1, 2 * r + 1).data;
    let max = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i + 1] < 40 && data[i + 2] < 40) max = Math.max(max, data[i]);
    return max;
  }, p);
}

/** 何も無い所に、2本の線 (20,250)-(120,250)・(20,280)-(120,280) を足し、両方を選んで、グループ「U」を作る */
async function makeGroup(page: Page, mapping: Mapping): Promise<[string, string]> {
  const a = await page.evaluate(() => window.__cadDev!.addLine(20, 250, 120, 250));
  const b = await page.evaluate(() => window.__cadDev!.addLine(20, 280, 120, 280));
  await click(page, mapping, 70, 250);
  await click(page, mapping, 70, 280, ["Control"]);
  await expect(propertyPanel(page)).toContainText("2 entities selected");
  await typeCommand(page, "group");
  await typeCommand(page, "U");
  await expect(log(page)).toContainText("グループ「U」を作りました(2 個の図形)");
  await click(page, mapping, 900, 330);
  await expect(propertyPanel(page)).toContainText("選択なし");
  return [a, b];
}

test.describe("groups", () => {
  test("clicking one member selects the whole group; Ctrl+Shift+A switches to single picking; Ctrl+click removes the whole group", async ({ page }) => {
    const mapping = await openEditable(page);
    await makeGroup(page, mapping);
    await click(page, mapping, 40, 250);
    await expect(propertyPanel(page)).toContainText("2 entities selected");
    // 選んであるグループの1つを、クリックし直しても、グループのまま(グリップの中点を避けて、線の途中をクリックする)
    await click(page, mapping, 40, 280);
    await expect(propertyPanel(page)).toContainText("2 entities selected");
    // Ctrl+クリックで、グループごと外れる(Ctrl を押したクリックは、グリップの上でも選択の操作)
    await click(page, mapping, 70, 250, ["Control"]);
    await expect(propertyPanel(page)).toContainText("選択なし");
    // PICKSTYLE を切る: 1つずつ選ぶ
    await blur(page);
    await page.keyboard.press("Control+Shift+A");
    await expect(log(page)).toContainText("グループ単位の選択(PICKSTYLE): オフ");
    await click(page, mapping, 70, 250);
    await expect(propertyPanel(page)).toContainText("Entity Type");
    await expect(propertyPanel(page)).not.toContainText("entities selected");
    await blur(page);
    await page.keyboard.press("Control+Shift+A");
    await expect(log(page)).toContainText("グループ単位の選択(PICKSTYLE): オン");
  });

  test("moving the group moves both members as one Undo step", async ({ page }) => {
    const mapping = await openEditable(page);
    await makeGroup(page, mapping);
    await click(page, mapping, 70, 250);
    await typeCommand(page, "move");
    await typeCommand(page, "0,0");
    await typeCommand(page, "0,30");
    await expect(log(page)).toContainText("2個の図形を移動しました");
    await undo(page);
    await expect(log(page)).toContainText("元に戻しました");
  });

  test("the GROUPS panel lists groups; rename and ungroup work and are undoable; deleting a member shrinks the group", async ({ page }) => {
    const mapping = await openEditable(page);
    const [a] = await makeGroup(page, mapping);
    await typeCommand(page, "groups");
    await expect(page.getByTestId("group-row-U")).toContainText("2 個");
    await page.getByTestId("group-rename-U").click();
    await page.getByTestId("group-rename-input-U").fill("Conveyor");
    await page.getByTestId("group-rename-input-U").press("Enter");
    await expect(page.getByTestId("group-row-Conveyor")).toBeVisible();
    // メンバーを1つ削除すると、グループは 1 個になる(Undo で戻る)
    await page.getByTestId("group-panel-close").click();
    await page.evaluate((id) => window.__cadDev!.removeEntity(id), a);
    await typeCommand(page, "groups");
    await expect(page.getByTestId("group-row-Conveyor")).toContainText("1 個");
    await undo(page);
    await expect(page.getByTestId("group-row-Conveyor")).toContainText("2 個");
    await page.getByTestId("group-ungroup-Conveyor").click();
    await expect(page.getByTestId("group-row-Conveyor")).toBeHidden();
    await undo(page);
    await expect(page.getByTestId("group-row-Conveyor")).toBeVisible();
  });

  test("copying the whole group makes the copy an unnamed group (*A1)", async ({ page }) => {
    const mapping = await openEditable(page);
    await makeGroup(page, mapping);
    await click(page, mapping, 70, 250);
    await typeCommand(page, "copy");
    await typeCommand(page, "0,0");
    await typeCommand(page, "0,60");
    await page.keyboard.press("Enter");
    await expect(log(page)).toContainText("複写しました");
    await typeCommand(page, "groups");
    await expect(page.getByTestId("group-row-*A1")).toContainText("2 個");
  });
});

test.describe("layer lock", () => {
  test("a locked layer: its figures cannot be selected (click or window) or moved, they are drawn faded, snapping still works; Undo unlocks", async ({ page }) => {
    const mapping = await openEditable(page);
    // 外枠の右の辺(下の辺は、寸法の線と重なっているので避ける)
    const wallBottom = at(mapping, 1000, 300);
    const unlocked = await maxRed(page, wallBottom);
    expect(unlocked).toBeGreaterThan(90);
    await page.getByTestId("layer-lock-toggle-WALL").click();
    await expect(log(page)).toContainText("レイヤー「WALL」をロックしました");
    // 薄く描かれる(赤の成分が、およそ半分)
    await expect.poll(() => maxRed(page, wallBottom)).toBeLessThan(unlocked * 0.7);
    expect(await maxRed(page, wallBottom)).toBeGreaterThan(0);
    // クリックで選べない
    await click(page, mapping, 1000, 300);
    await expect(propertyPanel(page)).toContainText("選択なし");
    // 吸着はできる: ID で、外枠の角の近くをクリックすると、角 (1000, 0) になる
    await typeCommand(page, "id");
    await click(page, mapping, 997, 3);
    await expect(log(page)).toContainText("X = 1000.0, Y = 0.0");
    // Undo で、ロックが外れる。外枠を選べる
    await undo(page);
    await expect.poll(() => maxRed(page, wallBottom)).toBe(unlocked);
    await click(page, mapping, 1000, 300);
    await expect(propertyPanel(page)).toContainText("LWPOLYLINE");
  });

  test("the lock checkbox in the layer panel; a figure that was selected before its layer is locked leaves the selection", async ({ page }) => {
    const mapping = await openEditable(page);
    // 外枠を先に選んでから、ロックする(選択から外れる)
    await click(page, mapping, 1000, 300);
    await expect(propertyPanel(page)).toContainText("LWPOLYLINE");
    await typeCommand(page, "layer");
    await page.getByTestId("layer-lock-WALL").check();
    await expect(page.getByTestId("layer-manager-result")).toContainText("ロックしました");
    await page.getByTestId("layer-manager-close").click();
    await expect(propertyPanel(page)).toContainText("選択なし");
    // DELETE は、選択を待つ(外枠は消えない)
    await typeCommand(page, "delete");
    await expect(log(page)).toContainText("選択");
    await page.keyboard.press("Escape");
  });
});

test.describe("draw order", () => {
  test("DRAWORDER back / above a reference, and TEXTTOFRONT; each is one Undo step", async ({ page }) => {
    const mapping = await openEditable(page);
    const id = await page.evaluate(() => window.__cadDev!.addLine(20, 250, 120, 250));
    expect((await order(page)).at(-1)).toBe(id);
    await click(page, mapping, 70, 250);
    await typeCommand(page, "draworder");
    await typeCommand(page, "b");
    await expect(log(page)).toContainText("最背面へ移動しました");
    expect((await order(page))[0]).toBe(id);
    // 基準の図形(GUIDE の破線 y=450)の上へ。選び直しは、グリップ(中点)を避けてクリックする
    const before = await order(page);
    await click(page, mapping, 900, 330);
    await click(page, mapping, 40, 250);
    await typeCommand(page, "dr");
    await typeCommand(page, "a");
    await click(page, mapping, 500, 450);
    await expect(log(page)).toContainText("基準の図形の上へ移動しました");
    const after = await order(page);
    expect(after.length).toBe(before.length);
    expect(after.indexOf(id)).toBeGreaterThan(0);
    await undo(page);
    expect((await order(page))[0]).toBe(id);
    await typeCommand(page, "texttofront");
    await expect(log(page)).toContainText("最前面へ移動しました");
  });
});
