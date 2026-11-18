// オフセット(OFFSET)・切断(BREAK)(Phase 12)のE2Eテスト。
// 工場レイアウトの図面の、取り込んだ線 (100,100)-(500,100) を、写す・切断する。
// 図形を指すクリックは、吸着しない。
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

const MACHINE_LINE = (mapping: Mapping, x = 300) => at(mapping, x, 100);

test.describe("OFFSET", () => {
  test("distance, click the figure, click the side: a new parallel line is added; one Undo removes it", async ({ page }) => {
    const mapping = await openEditable(page);
    const before = await entityCount(page);
    await typeCommand(page, "offset");
    await expect(label(page)).toHaveText("OFFSET:");
    await expect(log(page)).toContainText("オフセットの距離を数値で入力");
    await typeCommand(page, "50");
    await expect(log(page)).toContainText("写す図形をクリック");

    const lineClick = MACHINE_LINE(mapping);
    await page.mouse.click(lineClick.x, lineClick.y);
    await expect(log(page)).toContainText("写す側の点を指示");
    const side = at(mapping, 300, 160);
    await page.mouse.click(side.x, side.y);
    await expect(log(page)).toContainText("図形をオフセットしました(距離 50)");
    expect(await entityCount(page)).toBe(before + 1);
    await expect(label(page)).toHaveText("OFFSET:"); // コマンドは続く
    await page.keyboard.press("Escape");
    await expect(label(page)).toHaveText("コマンド:");

    // 新しい線は、y=150(元の線 y=100 の、クリックした側)
    await select(page, at(mapping, 300, 150), "LINE");
    expect(await readPoint(page, "Start")).toEqual({ x: 100, y: 150 });
    expect(await readPoint(page, "End")).toEqual({ x: 500, y: 150 });
    // 元の線は、そのまま
    await select(page, MACHINE_LINE(mapping), "LINE");
    expect(await readPoint(page, "Start")).toEqual({ x: 100, y: 100 });

    await undo(page);
    await expect(log(page)).toContainText("元に戻しました: 図形をオフセット");
    expect(await entityCount(page)).toBe(before);
  });

  test("the other side, and repeating in one command: each one is its own Undo step", async ({ page }) => {
    const mapping = await openEditable(page);
    const before = await entityCount(page);
    await typeCommand(page, "o");
    await typeCommand(page, "30");
    const lineClick = MACHINE_LINE(mapping);
    await page.mouse.click(lineClick.x, lineClick.y);
    const below = at(mapping, 300, 40);
    await page.mouse.click(below.x, below.y); // 下側(y が小さい側)へ
    await expect(log(page)).toContainText("図形をオフセットしました(距離 30)");
    await page.mouse.click(lineClick.x, lineClick.y);
    const above = at(mapping, 300, 150);
    await page.mouse.click(above.x, above.y);
    expect(await entityCount(page)).toBe(before + 2);
    await page.keyboard.press("Escape");
    await select(page, at(mapping, 300, 70), "LINE");
    expect(await readPoint(page, "Start")).toEqual({ x: 100, y: 70 });
    await select(page, at(mapping, 300, 130), "LINE");
    expect(await readPoint(page, "Start")).toEqual({ x: 100, y: 130 });

    await undo(page);
    expect(await entityCount(page)).toBe(before + 1);
    await undo(page);
    expect(await entityCount(page)).toBe(before);
  });

  test("T: the offset passes through the clicked point", async ({ page }) => {
    const mapping = await openEditable(page);
    const before = await entityCount(page);
    await typeCommand(page, "offset");
    await typeCommand(page, "t");
    const lineClick = MACHINE_LINE(mapping);
    await page.mouse.click(lineClick.x, lineClick.y);
    await expect(log(page)).toContainText("通過点を指示");
    // 通過点は、座標を打って指示する(吸着の影響を受けない)
    await typeCommand(page, "300,180");
    await expect(log(page)).toContainText("図形をオフセットしました(距離 80)");
    expect(await entityCount(page)).toBe(before + 1);
    await page.keyboard.press("Escape");
    await select(page, at(mapping, 300, 180), "LINE");
    expect(await readPoint(page, "Start")).toEqual({ x: 100, y: 180 });
  });

  test("a bad distance is asked again; clicking an empty place shows the reason; clicking on the figure itself for the side is refused", async ({ page }) => {
    const mapping = await openEditable(page);
    const before = await entityCount(page);
    await typeCommand(page, "offset");
    await typeCommand(page, "0");
    await expect(log(page)).toContainText("0 より大きい数");
    await typeCommand(page, "20");
    const empty = at(mapping, 100, 350); // 何も無い所
    await page.mouse.click(empty.x, empty.y);
    await expect(log(page)).toContainText("クリックした所に図形がありません");
    const lineClick = MACHINE_LINE(mapping);
    await page.mouse.click(lineClick.x, lineClick.y);
    await typeCommand(page, "300,100"); // 線の真上の点(側が決まらない)
    await expect(log(page)).toContainText("どちら側へ写すか決まりません");
    expect(await entityCount(page)).toBe(before);
    await page.keyboard.press("Escape");
  });

  test("the toolbar button starts OFFSET", async ({ page }) => {
    await openEditable(page);
    await toolbarButton(page, "オフセット").click();
    await expect(label(page)).toHaveText("OFFSET:");
    await page.keyboard.press("Escape");
  });
});

test.describe("BREAK", () => {
  test("F then the first and second points: the line is cut between them (two lines); one Undo restores it", async ({ page }) => {
    const mapping = await openEditable(page);
    const before = await entityCount(page);
    await typeCommand(page, "break");
    await expect(label(page)).toHaveText("BREAK:");
    const lineClick = MACHINE_LINE(mapping, 200);
    await page.mouse.click(lineClick.x, lineClick.y);
    await expect(log(page)).toContainText("クリックした位置を、第1点にしました");
    // 第1点を、座標で指定し直す(クリックは吸着しないので、正確な位置は座標で)
    await typeCommand(page, "f");
    await typeCommand(page, "250,100");
    await typeCommand(page, "350,100");
    await expect(log(page)).toContainText("図形を切断しました(2つの図形に分かれました)");
    expect(await entityCount(page)).toBe(before + 1);
    await expect(label(page)).toHaveText("コマンド:"); // BREAK は1回で終わる

    await select(page, at(mapping, 180, 100), "LINE");
    expect(await readPoint(page, "Start")).toEqual({ x: 100, y: 100 });
    expect(await readPoint(page, "End")).toEqual({ x: 250, y: 100 });
    await select(page, at(mapping, 450, 100), "LINE");
    expect(await readPoint(page, "Start")).toEqual({ x: 350, y: 100 });
    expect(await readPoint(page, "End")).toEqual({ x: 500, y: 100 });

    await undo(page);
    await expect(log(page)).toContainText("元に戻しました: 図形を切断");
    expect(await entityCount(page)).toBe(before);
    await select(page, MACHINE_LINE(mapping), "LINE");
    expect(await readPoint(page, "End")).toEqual({ x: 500, y: 100 });
  });

  test("the second point equal to the first splits the line at that point", async ({ page }) => {
    const mapping = await openEditable(page);
    const before = await entityCount(page);
    await typeCommand(page, "br");
    const lineClick = MACHINE_LINE(mapping, 200);
    await page.mouse.click(lineClick.x, lineClick.y);
    await typeCommand(page, "f");
    await typeCommand(page, "300,100");
    await typeCommand(page, "300,100");
    await expect(log(page)).toContainText("図形を切断しました(2つの図形に分かれました)");
    expect(await entityCount(page)).toBe(before + 1);
    await select(page, at(mapping, 200, 100), "LINE");
    expect(await readPoint(page, "End")).toEqual({ x: 300, y: 100 });
    await select(page, at(mapping, 400, 100), "LINE");
    expect(await readPoint(page, "Start")).toEqual({ x: 300, y: 100 });
  });

  test("points past the end of the line: the part up to the end is removed (one line is left)", async ({ page }) => {
    const mapping = await openEditable(page);
    const before = await entityCount(page);
    await typeCommand(page, "break");
    const lineClick = MACHINE_LINE(mapping, 200);
    await page.mouse.click(lineClick.x, lineClick.y);
    await typeCommand(page, "f");
    await typeCommand(page, "400,100");
    await typeCommand(page, "900,100");
    await expect(log(page)).toContainText("図形を切断しました");
    expect(await entityCount(page)).toBe(before);
    await select(page, at(mapping, 200, 100), "LINE");
    expect(await readPoint(page, "End")).toEqual({ x: 400, y: 100 });
  });

  test("clicking an empty place shows the reason and keeps waiting; Esc ends", async ({ page }) => {
    const mapping = await openEditable(page);
    await typeCommand(page, "break");
    const empty = at(mapping, 100, 350); // 何も無い所
    await page.mouse.click(empty.x, empty.y);
    await expect(log(page)).toContainText("クリックした所に図形がありません");
    await expect(label(page)).toHaveText("BREAK:");
    await page.keyboard.press("Escape");
    await expect(label(page)).toHaveText("コマンド:");
  });

  test("the toolbar button starts BREAK", async ({ page }) => {
    await openEditable(page);
    await toolbarButton(page, "切断").click();
    await expect(label(page)).toHaveText("BREAK:");
    await page.keyboard.press("Escape");
  });
});
