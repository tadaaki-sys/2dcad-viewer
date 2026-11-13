// 作図(CIRCLE・ARC)のE2Eテスト(Phase 5)。
// 工場レイアウトの図面の、左側の空いている場所(中心 (100,300)・半径 60 の円の周り)に、WALL レイヤー(赤)で描く。
// ワールド座標は、Y軸が上向き。「上」は y が大きい側、「下」は y が小さい側。
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { factoryLayoutDxf } from "../src/regression/fixtures";
import { calibrate, hasHueNear, openDrawing, propertyPanel } from "./helpers";
import type { Mapping, Pt } from "./helpers";
// window.__cadDev の型を取り込む(読み込むだけで、実行はしない)
import type {} from "../src/devHooks";

const RED: [number, number, number] = [255, 0, 0];
const WHITE: [number, number, number] = [255, 255, 255];

const log = (page: Page) => page.getByTestId("command-line-log");
const input = (page: Page) => page.getByTestId("command-line-input");
const label = (page: Page) => page.getByTestId("command-line-label");
const toolbarButton = (page: Page, name: string) => page.locator(".toolbar").getByRole("button", { name, exact: true });
const entityCount = (page: Page) => page.evaluate(() => window.__cadDev!.entityCount());

async function openEditable(page: Page): Promise<Mapping> {
  await openDrawing(page, "factory.dxf", factoryLayoutDxf());
  await page.waitForFunction(() => window.__cadDev?.ready() === true, undefined, { timeout: 30_000 });
  const mapping = await calibrate(page);
  await page.locator(".layer-panel__item", { hasText: "WALL" }).locator('input[type="radio"]').check();
  await expect(page.getByTestId("current-layer-indicator")).toContainText("WALL");
  return mapping;
}

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

// 中心 (100,300)、半径 60 の円周上の点
const TOP: [number, number] = [100, 360];
const BOTTOM: [number, number] = [100, 240];
const LEFT: [number, number] = [40, 300];
const RIGHT: [number, number] = [160, 300];
const LOWER_RIGHT: [number, number] = [142.4, 257.6]; // 315度

test.describe("CIRCLE", () => {
  test("clicks: center then a point on the circle; drawn in the layer color, selectable, one Undo / Redo", async ({ page }) => {
    const mapping = await openEditable(page);
    const before = await entityCount(page);
    await expectHue(page, at(mapping, ...TOP), RED, false);

    await typeCommand(page, "circle");
    await expect(label(page)).toHaveText("CIRCLE:");
    await click(page, at(mapping, 100, 300));
    // 半径を指示する前に、カーソルに追従する白い破線の円が見える
    await page.mouse.move(at(mapping, ...RIGHT).x, at(mapping, ...RIGHT).y);
    await expectHue(page, at(mapping, ...BOTTOM), WHITE, true);
    await click(page, at(mapping, ...RIGHT));
    await expect(log(page)).toContainText("円を追加しました(半径");
    await expect(label(page)).toHaveText("コマンド:");
    expect(await entityCount(page)).toBe(before + 1);

    // 確定した円は赤(WALL)で、ゴム紐(白)は消えている
    await page.mouse.move(at(mapping, 600, 300).x, at(mapping, 600, 300).y);
    for (const point of [TOP, BOTTOM, LEFT]) {
      await expectHue(page, at(mapping, ...point), RED, true);
      await expectHue(page, at(mapping, ...point), WHITE, false);
    }

    await click(page, at(mapping, ...TOP));
    await expect(propertyPanel(page)).toContainText("CIRCLE");
    await expect(propertyPanel(page)).toContainText("WALL");

    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+z");
    await expect(log(page)).toContainText("元に戻しました: 円を追加");
    expect(await entityCount(page)).toBe(before);
    await expectHue(page, at(mapping, ...TOP), RED, false);
    await page.keyboard.press("Control+y");
    expect(await entityCount(page)).toBe(before + 1);
    await expectHue(page, at(mapping, ...TOP), RED, true);
  });

  test("typed center and radius; D gives a diameter; a bad radius is refused and the command keeps waiting", async ({ page }) => {
    const mapping = await openEditable(page);
    const before = await entityCount(page);

    await typeCommand(page, "c");
    await typeCommand(page, "100,300");
    await typeCommand(page, "0");
    await expect(log(page)).toContainText("半径が小さすぎるか大きすぎます");
    expect(await entityCount(page)).toBe(before);
    await typeCommand(page, "60");
    await expect(log(page)).toContainText("円を追加しました(半径 60.000)");
    expect(await entityCount(page)).toBe(before + 1);
    await expectHue(page, at(mapping, ...BOTTOM), RED, true);

    // 直径(D)。同じ円をもう1つ重ねず、別の場所に描く
    await typeCommand(page, "circle");
    await typeCommand(page, "100,100");
    await typeCommand(page, "d");
    await expect(log(page)).toContainText("直径を数値で入力してください");
    await typeCommand(page, "100");
    await expect(log(page)).toContainText("円を追加しました(半径 50.000)");
    expect(await entityCount(page)).toBe(before + 2);
  });

  test("Enter and Esc end without drawing", async ({ page }) => {
    const mapping = await openEditable(page);
    const before = await entityCount(page);
    await typeCommand(page, "circle");
    await click(page, at(mapping, 100, 300));
    await typeCommand(page, "");
    await expect(log(page)).toContainText("CIRCLE を終了しました(図形は描かれませんでした)");
    await typeCommand(page, "circle");
    await click(page, at(mapping, 100, 300));
    await page.keyboard.press("Escape");
    expect(await entityCount(page)).toBe(before);
  });

  test("the toolbar button starts the command", async ({ page }) => {
    await openEditable(page);
    await toolbarButton(page, "円").click();
    await expect(label(page)).toHaveText("CIRCLE:");
    await expect(log(page)).toContainText("円の中心を指示してください");
  });
});

test.describe("ARC", () => {
  test("3 points: the arc goes through the middle point, whichever way the points were given", async ({ page }) => {
    const mapping = await openEditable(page);
    const before = await entityCount(page);

    // 左 → 上 → 右(時計回りで指示)。上側の半円になる
    await typeCommand(page, "arc");
    await expect(label(page)).toHaveText("ARC:");
    await click(page, at(mapping, ...LEFT));
    await click(page, at(mapping, ...TOP));
    // 終点を決める前に、白い破線の円弧が3点を通る
    await page.mouse.move(at(mapping, ...RIGHT).x, at(mapping, ...RIGHT).y);
    await expectHue(page, at(mapping, ...TOP), WHITE, true);
    await click(page, at(mapping, ...RIGHT));
    await expect(log(page)).toContainText("円弧を追加しました(半径");
    expect(await entityCount(page)).toBe(before + 1);

    await page.mouse.move(at(mapping, 600, 300).x, at(mapping, 600, 300).y);
    await expectHue(page, at(mapping, ...TOP), RED, true);
    await expectHue(page, at(mapping, ...TOP), WHITE, false);
    await expectHue(page, at(mapping, ...BOTTOM), RED, false); // 下側は描かれない

    await click(page, at(mapping, ...TOP));
    await expect(propertyPanel(page)).toContainText("ARC");
    await expect(propertyPanel(page)).toContainText("WALL");

    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+z");
    await expect(log(page)).toContainText("元に戻しました: 円弧を追加");
    await expectHue(page, at(mapping, ...TOP), RED, false);

    // 右 → 上 → 左(反時計回りで指示)でも、同じ上側の半円
    await typeCommand(page, "a");
    await typeCommand(page, "160,300");
    await typeCommand(page, "100,360");
    await typeCommand(page, "40,300");
    await expectHue(page, at(mapping, ...TOP), RED, true);
    await expectHue(page, at(mapping, ...BOTTOM), RED, false);
  });

  test("3 collinear points are refused; the command keeps waiting for another end point", async ({ page }) => {
    const mapping = await openEditable(page);
    const before = await entityCount(page);
    await typeCommand(page, "arc");
    await typeCommand(page, "40,300");
    await typeCommand(page, "100,300");
    await typeCommand(page, "160,300");
    await expect(log(page)).toContainText("円弧になりません");
    expect(await entityCount(page)).toBe(before);
    await expect(label(page)).toHaveText("ARC:");
    await click(page, at(mapping, ...TOP));
    await expect(log(page)).toContainText("円弧を追加しました");
    expect(await entityCount(page)).toBe(before + 1);
  });

  test("C: center, start, end - counter-clockwise from the start, only the direction of the end is used", async ({ page }) => {
    const mapping = await openEditable(page);
    const before = await entityCount(page);
    await typeCommand(page, "arc");
    await typeCommand(page, "c");
    await click(page, at(mapping, 100, 300)); // 中心
    await click(page, at(mapping, ...RIGHT)); // 始点(0度)
    // 終点は、中心の真下(270度)の、円の外側。反時計回りに、右 → 上 → 左 → 下
    await page.mouse.move(at(mapping, 100, 200).x, at(mapping, 100, 200).y);
    await expectHue(page, at(mapping, ...LEFT), WHITE, true);
    await click(page, at(mapping, 100, 200));
    // クリックの位置には1px前後の誤差があるので、半径は 60 の近く(59〜61)
    await expect(log(page)).toContainText(/円弧を追加しました\(半径 (59|60|61)\./);
    expect(await entityCount(page)).toBe(before + 1);

    await page.mouse.move(at(mapping, 600, 300).x, at(mapping, 600, 300).y);
    await expectHue(page, at(mapping, ...TOP), RED, true);
    await expectHue(page, at(mapping, ...LEFT), RED, true);
    await expectHue(page, at(mapping, ...LOWER_RIGHT), RED, false); // 270度〜360度は描かれない
  });

  test("the toolbar button starts the command", async ({ page }) => {
    await openEditable(page);
    await toolbarButton(page, "円弧").click();
    await expect(label(page)).toHaveText("ARC:");
    await expect(log(page)).toContainText("円弧の始点を指示してください");
  });
});
