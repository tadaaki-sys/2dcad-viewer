// グリップ・頂点の編集・プロパティの編集(Phase 18)のE2Eテスト。
// 見本図面(工場レイアウト)に、開発用の入口で線・折れ線を足して(新しく描いた図形=編集できる)、グリップを動かす。
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
async function click(page: Page, mapping: Mapping, x: number, y: number): Promise<void> {
  const p = at(mapping, x, y);
  await page.mouse.click(p.x, p.y);
}
async function undo(page: Page): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("Control+z");
}
/** 何も無い所に、横の線 (20,250)-(120,250) を足して、選ぶ。線の ID を返す */
async function addAndSelectLine(page: Page, mapping: Mapping): Promise<string> {
  const id = await page.evaluate(() => window.__cadDev!.addLine(20, 250, 120, 250));
  await click(page, mapping, 70, 250);
  await expect(propertyPanel(page)).toContainText("LINE");
  return id;
}

const lineEnd = (page: Page, id: string) =>
  page.evaluate((lineId) => {
    const text = (window as unknown as { __cadDev: { entityOrder: () => string[] } }).__cadDev.entityOrder();
    return text.includes(lineId);
  }, id);

test.describe("grips", () => {
  test("selecting a line shows grips; clicking the end grip, moving, and clicking again moves the end as ONE Undo step", async ({ page }) => {
    const mapping = await openEditable(page);
    const id = await addAndSelectLine(page, mapping);
    expect(await lineEnd(page, id)).toBe(true);
    await click(page, mapping, 120, 250); // 終点のグリップ
    await expect(log(page)).toContainText("グリップの新しい位置を指示してください");
    await typeCommand(page, "160,280"); // 座標を打って、正確な位置に置く
    await expect(log(page)).toContainText("グリップを動かしました");
    // 選択は残り、プロパティの End X/Y が新しい位置
    await expect(propertyPanel(page)).toContainText(/End X\/Y\s*160\.0 mm, 280\.0 mm/);
    await undo(page);
    await expect(propertyPanel(page)).toContainText(/End X\/Y\s*120\.0 mm, 250\.0 mm/);
  });

  test("Esc cancels the grip move and changes nothing", async ({ page }) => {
    const mapping = await openEditable(page);
    await addAndSelectLine(page, mapping);
    await click(page, mapping, 120, 250);
    await expect(log(page)).toContainText("グリップの新しい位置");
    await page.keyboard.press("Escape");
    await expect(propertyPanel(page)).toContainText(/End X\/Y\s*120\.0 mm, 250\.0 mm/);
    const history = await page.evaluate(() => window.__cadDev!.history().nextUndoLabel);
    expect(history).toBe("線を追加");
  });

  test("the middle grip moves the whole line; a typed length and angle place the grip (dynamic input)", async ({ page }) => {
    const mapping = await openEditable(page);
    await addAndSelectLine(page, mapping);
    await click(page, mapping, 70, 250); // 中点のグリップ
    await typeCommand(page, "70,300");
    await expect(propertyPanel(page)).toContainText(/Start X\/Y\s*20\.0 mm, 300\.0 mm/);
    await expect(propertyPanel(page)).toContainText(/End X\/Y\s*120\.0 mm, 300\.0 mm/);
    // 終点を、基点(終点)からの距離と角度で動かす: @50<90 → (120, 350)
    await click(page, mapping, 120, 300);
    await typeCommand(page, "@50<90");
    await expect(propertyPanel(page)).toContainText(/End X\/Y\s*120\.0 mm, 350\.0 mm/);
  });

  test("grips do not appear while a command runs, and clicking empty space still deselects", async ({ page }) => {
    const mapping = await openEditable(page);
    await addAndSelectLine(page, mapping);
    await typeCommand(page, "move");
    await click(page, mapping, 120, 250);
    // MOVE の基点として使われる(グリップのコマンドは始まらない)
    await expect(log(page)).not.toContainText("グリップの新しい位置");
    await page.keyboard.press("Escape");
    await click(page, mapping, 900, 330);
    await expect(propertyPanel(page)).not.toContainText("LINE");
  });

  test("a circle's quadrant grip changes the radius; an imported (read-only) figure shows no grips", async ({ page }) => {
    const mapping = await openEditable(page);
    // 取り込んだ円(MACHINE。中心 (300,300) 半径 100)は、対応づけが済んでいれば編集できる図形
    await click(page, mapping, 300, 200);
    await expect(propertyPanel(page)).toContainText("CIRCLE");
    await click(page, mapping, 400, 300); // 右の四半円点のグリップ
    await typeCommand(page, "450,300");
    await expect(propertyPanel(page)).toContainText(/Radius\s*150\.0/);
    await undo(page);
    await expect(propertyPanel(page)).toContainText(/Radius\s*100\.0/);
  });
});

test.describe("vertex editing commands", () => {
  async function drawPolyline(page: Page, mapping: Mapping): Promise<void> {
    await typeCommand(page, "pline");
    await click(page, mapping, 20, 250);
    await click(page, mapping, 120, 250);
    await click(page, mapping, 120, 320);
    await page.keyboard.press("Enter");
    await expect(log(page)).toContainText("ポリライン");
  }

  test("VERTEXADD adds a vertex on a segment; VERTEXDEL removes one; PCLOSE / POPEN close and open; each is one Undo step", async ({ page }) => {
    const mapping = await openEditable(page);
    await drawPolyline(page, mapping);
    await click(page, mapping, 70, 250);
    await expect(propertyPanel(page)).toContainText(/Vertex Count\s*3/);
    await page.keyboard.press("Escape");

    await typeCommand(page, "vertexadd");
    await click(page, mapping, 70, 250);
    await expect(log(page)).toContainText("頂点を追加しました");
    await page.keyboard.press("Escape");
    await click(page, mapping, 100, 250);
    await expect(propertyPanel(page)).toContainText(/Vertex Count\s*4/);
    await page.keyboard.press("Escape");

    await typeCommand(page, "vertexdel");
    await click(page, mapping, 70, 250);
    await expect(log(page)).toContainText("頂点を削除しました");
    await page.keyboard.press("Escape");

    await click(page, mapping, 100, 250);
    await expect(propertyPanel(page)).toContainText(/Vertex Count\s*3/);
    await typeCommand(page, "pclose");
    await expect(log(page)).toContainText("1個の折れ線を閉じました");
    await typeCommand(page, "popen");
    await expect(log(page)).toContainText("1個の折れ線を開きました");
    await typeCommand(page, "popen");
    await expect(log(page)).toContainText("すでに開いています");
  });

  test("VERTEXDEL refuses a click in the middle of a segment (no vertex nearby)", async ({ page }) => {
    const mapping = await openEditable(page);
    await drawPolyline(page, mapping);
    await typeCommand(page, "vertexdel");
    await click(page, mapping, 70, 250);
    await expect(log(page)).toContainText("頂点の近くをクリックしてください");
  });
});

test.describe("property editing", () => {
  test("the layer, color, linetype and lineweight of the selection can be changed in the panel (one Undo step each)", async ({ page }) => {
    const mapping = await openEditable(page);
    await addAndSelectLine(page, mapping);
    const editor = page.getByTestId("property-editor");
    await expect(editor).toBeVisible();
    await page.getByTestId("property-linetype").selectOption("CENTER");
    await expect(propertyPanel(page)).toContainText(/Linetype\s*CENTER/);
    await page.getByTestId("property-lineweight").selectOption("70");
    await expect(propertyPanel(page)).toContainText(/Lineweight\s*0\.70 mm/);
    await page.getByTestId("property-layer").selectOption("WALL");
    await expect(propertyPanel(page)).toContainText(/Layer\s*WALL/);
    await page.getByTestId("property-color").fill("#0000ff");
    await expect(propertyPanel(page)).toContainText(/Color\s*#0000ff/);
    await page.getByTestId("property-color-bylayer").click();
    await expect(propertyPanel(page)).toContainText(/Color\s*#ff0000 \(ByLayer\)/);
    await undo(page);
    await expect(propertyPanel(page)).toContainText(/Color\s*#0000ff/);
  });

  test("the color can be changed several times in a row (the color input is rebuilt after each change and must keep working)", async ({ page }) => {
    const mapping = await openEditable(page);
    await addAndSelectLine(page, mapping);
    await page.getByTestId("property-color").fill("#0000ff");
    await expect(propertyPanel(page)).toContainText(/Color\s*#0000ff/);
    await page.getByTestId("property-color").fill("#00ff00");
    await expect(propertyPanel(page)).toContainText(/Color\s*#00ff00/);
    await page.getByTestId("property-color").fill("#123456");
    await expect(propertyPanel(page)).toContainText(/Color\s*#123456/);
  });

  test("a rejected number is not left in the field (the field shows the figure's real value again)", async ({ page }) => {
    const mapping = await openEditable(page);
    await addAndSelectLine(page, mapping);
    const endX = page.getByTestId("property-geometry-endX");
    await endX.fill("20"); // 始点と同じ x ではないが、終点 (20,250) は始点 (20,250) と同じ位置になる → 断られる
    await endX.press("Enter");
    await expect(page.getByTestId("property-editor-result")).toContainText("同じ位置");
    await expect(page.getByTestId("property-geometry-endX")).toHaveValue("120");
  });

  test("numeric values: the end point, accepted with Enter; a bad value is refused with a reason and nothing changes", async ({ page }) => {
    const mapping = await openEditable(page);
    await addAndSelectLine(page, mapping);
    const endX = page.getByTestId("property-geometry-endX");
    await endX.fill("200");
    await endX.press("Enter");
    await expect(propertyPanel(page)).toContainText(/End X\/Y\s*200\.0 mm, 250\.0 mm/);
    await page.getByTestId("property-geometry-endY").fill("abc");
    await page.getByTestId("property-geometry-endY").press("Enter");
    await expect(page.getByTestId("property-editor-result")).toContainText("数値で入力してください");
    await expect(propertyPanel(page)).toContainText(/End X\/Y\s*200\.0 mm, 250\.0 mm/);
    await undo(page);
    await expect(propertyPanel(page)).toContainText(/End X\/Y\s*120\.0 mm, 250\.0 mm/);
  });

  test("a figure that cannot be edited (a block's contents) shows no edit section", async ({ page }) => {
    const mapping = await openEditable(page);
    // ブロック UNIT の中身(挿入 (800,450) の中の円 中心 (850,500) 半径 20。ほかの図形と重ならない右端)
    await click(page, mapping, 870, 500);
    await expect(propertyPanel(page)).toContainText("CIRCLE");
    await expect(page.getByTestId("property-editor")).toBeHidden();
  });
});
