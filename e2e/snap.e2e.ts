// Snap の拡張(中心・四半円点・垂線・接線・延長・グリッド・円が絡む交点、OSNAP・SNAP・GRID と設定。Phase 7)のE2Eテスト。
// 工場レイアウトの図面(円 (300,300) 半径 100、線 (100,100)-(500,100) など)の上で、線を描いて、始点・終点が吸着した位置になることを、
// 描いた線のプロパティ(座標は小数1桁)で確かめる。クリックは画素単位なので、狙いから数mmずらした位置をクリックする。
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { factoryLayoutDxf } from "../src/regression/fixtures";
import { calibrate, hasColorNear, openDrawing, propertyPanel } from "./helpers";
import type { Mapping, Pt } from "./helpers";
// window.__cadDev の型を取り込む(読み込むだけで、実行はしない)
import type {} from "../src/devHooks";

const log = (page: Page) => page.getByTestId("command-line-log");
const input = (page: Page) => page.getByTestId("command-line-input");
const label = (page: Page) => page.getByTestId("command-line-label");
const toggle = (page: Page, name: "grid" | "snap" | "osnap") => page.getByTestId(`status-toggle-${name}`);

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

/** 設定パネルで、種類のチェックボックスを切り替える */
async function setSnapType(page: Page, type: string, checked: boolean): Promise<void> {
  const panel = page.getByTestId("snap-settings-panel");
  if (!(await panel.isVisible())) await page.getByTestId("snap-settings-button").click();
  await page.getByTestId(`snap-type-${type}`).setChecked(checked);
}

async function closeSnapSettings(page: Page): Promise<void> {
  if (await page.getByTestId("snap-settings-panel").isVisible()) await page.getByTestId("snap-settings-button").click();
  await expect(page.getByTestId("snap-settings-panel")).toHaveCount(0);
}

/**
 * 線を1本描く: 始点(typedStart のとき座標を入力、なければクリック)と、終点(クリック)。描けたら、その線を中点のクリックで選ぶ。
 * 終わったあと、プロパティに出る文字(始点・終点の座標を含む)を返す。
 */
async function drawLineAndRead(
  page: Page,
  mapping: Mapping,
  start: { typed?: string; click?: Pt },
  endClick: Pt,
  midpoint: Pt,
): Promise<string> {
  await typeCommand(page, "line");
  if (start.typed !== undefined) await typeCommand(page, start.typed);
  else await clickAt(page, start.click!);
  await clickAt(page, endClick);
  await page.keyboard.press("Escape");
  await expect(label(page)).toHaveText("コマンド:");
  await clickAt(page, midpoint);
  await expect(propertyPanel(page)).toContainText("LINE");
  void mapping;
  return propertyPanel(page).innerText();
}

test.describe("center and quadrant (on by default)", () => {
  test("a click near a circle's center snaps to the center", async ({ page }) => {
    const mapping = await openEditable(page);
    // 円 (300,300) の中心の近く(約3mmずらす)から、真右へ 100 の線
    const text = await drawLineAndRead(page, mapping, { click: at(mapping, 302.5, 297.5) }, at(mapping, 600, 400), at(mapping, 450, 350));
    expect(text).toContain("300.0 mm, 300.0 mm"); // 始点が、中心にぴったり
  });

  test("a click near a quadrant point snaps to it", async ({ page }) => {
    const mapping = await openEditable(page);
    // 円 (300,300) 半径 100 の右の四半円点 (400,300)。近接(円周上の最も近い点)なら、ぴったりにはならない
    const text = await drawLineAndRead(page, mapping, { click: at(mapping, 402.5, 297) }, at(mapping, 450, 450), at(mapping, 425, 375));
    expect(text).toContain("400.0 mm, 300.0 mm");
  });
});

test.describe("intersection with a circle is exact", () => {
  test("a line crossing the circle: the snapped point is exactly on the circle", async ({ page }) => {
    const mapping = await openEditable(page);
    // 水平線 y=330 を、(200,330)-(450,330) で描く。円 (300,300) 半径 100 との交点は x = 300 + sqrt(100^2 - 30^2) = 395.4
    await typeCommand(page, "line");
    await typeCommand(page, "200,330");
    await typeCommand(page, "450,330");
    await page.keyboard.press("Escape");
    await expect(log(page)).toContainText("線を追加しました");

    const text = await drawLineAndRead(page, mapping, { click: at(mapping, 396.5, 331.5) }, at(mapping, 500, 450), at(mapping, 448, 390));
    expect(text).toContain("395.4 mm, 330.0 mm");
  });
});

test.describe("perpendicular, tangent and extension (off by default)", () => {
  test("they do nothing until they are turned on in the settings", async ({ page }) => {
    const mapping = await openEditable(page);
    // 既定(垂線オフ)では、線 (100,100)-(500,100) の近く(x=203)をクリックしても、垂線の足 (200,100) にはならず、最近点(203付近)になる
    const text = await drawLineAndRead(page, mapping, { typed: "200,30" }, at(mapping, 203, 103), at(mapping, 201, 65));
    expect(text).not.toContain("200.0 mm, 100.0 mm");
  });

  test("perpendicular: the foot of the perpendicular from the previous point", async ({ page }) => {
    const mapping = await openEditable(page);
    await setSnapType(page, "perpendicular", true);
    await closeSnapSettings(page);
    const text = await drawLineAndRead(page, mapping, { typed: "200,30" }, at(mapping, 203, 103), at(mapping, 200, 65));
    expect(text).toContain("200.0 mm, 100.0 mm"); // 線 y=100 への垂線の足(最近点なら 203 付近になる)
  });

  test("tangent: the tangent point on the circle seen from the previous point", async ({ page }) => {
    const mapping = await openEditable(page);
    await setSnapType(page, "tangent", true);
    await closeSnapSettings(page);
    // 円 (300,300) 半径 100 を、外の点 (500,300) から見る。接点は (350, 300 ± 86.6)
    const text = await drawLineAndRead(page, mapping, { typed: "500,300" }, at(mapping, 352, 384), at(mapping, 425, 343));
    expect(text).toContain("350.0 mm, 386.6 mm");
  });

  test("extension: on the extension of a line beyond its end", async ({ page }) => {
    const mapping = await openEditable(page);
    await setSnapType(page, "extension", true);
    await closeSnapSettings(page);
    // 線 (100,100)-(500,100) の右の延長線上(y=100)。少しずらした位置をクリックしても、y がちょうど 100 になる
    const text = await drawLineAndRead(page, mapping, { typed: "650,30" }, at(mapping, 600, 103), at(mapping, 625, 65));
    expect(text).toMatch(/\d+\.\d mm, 100\.0 mm/);
  });
});

test.describe("OSNAP, SNAP and GRID", () => {
  test("the buttons and F3 / F9 / F7 toggle them, and the log says so; a command in progress is not ended", async ({ page }) => {
    await openEditable(page);
    await expect(toggle(page, "osnap")).toHaveAttribute("aria-pressed", "true");
    await expect(toggle(page, "snap")).toHaveAttribute("aria-pressed", "false");
    await expect(toggle(page, "grid")).toHaveAttribute("aria-pressed", "false");

    await typeCommand(page, "line");
    await expect(label(page)).toHaveText("LINE:");
    await page.keyboard.press("F3");
    await expect(toggle(page, "osnap")).toHaveAttribute("aria-pressed", "false");
    await expect(log(page)).toContainText("OSNAP(図形への吸着): オフ");
    await page.keyboard.press("F9");
    await expect(toggle(page, "snap")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("F7");
    await expect(toggle(page, "grid")).toHaveAttribute("aria-pressed", "true");
    await expect(label(page)).toHaveText("LINE:"); // 作図中のコマンドは、続いている

    await toggle(page, "osnap").click();
    await expect(toggle(page, "osnap")).toHaveAttribute("aria-pressed", "true");
    await expect(label(page)).toHaveText("LINE:");
    await page.keyboard.press("Escape");
  });

  test("the command line commands OSNAP, SNAP and GRID do the same", async ({ page }) => {
    await openEditable(page);
    await typeCommand(page, "snap");
    await expect(toggle(page, "snap")).toHaveAttribute("aria-pressed", "true");
    await expect(log(page)).toContainText("SNAP(格子点への吸着): オン");
    await typeCommand(page, "grid");
    await expect(toggle(page, "grid")).toHaveAttribute("aria-pressed", "true");
    await typeCommand(page, "osnap");
    await expect(toggle(page, "osnap")).toHaveAttribute("aria-pressed", "false");
  });

  test("with OSNAP off a click near a circle's center is not pulled to it", async ({ page }) => {
    const mapping = await openEditable(page);
    await toggle(page, "osnap").click();
    const text = await drawLineAndRead(page, mapping, { click: at(mapping, 302.5, 297.5) }, at(mapping, 600, 400), at(mapping, 450, 350));
    expect(text).not.toContain("300.0 mm, 300.0 mm");
  });

  test("SNAP: a click lands on the nearest grid point (spacing from the settings); the grid is drawn with GRID", async ({ page }) => {
    const mapping = await openEditable(page);
    // 間隔を 20 mm にする(画面上で、表示できる間隔になるように)
    await page.getByTestId("snap-settings-button").click();
    await page.getByTestId("snap-grid-spacing").fill("20");
    await page.getByTestId("snap-grid-spacing").press("Enter");
    await closeSnapSettings(page);

    // GRID オン: 格子点 (560,60) に、小さな点が見える。オフでは見えない
    const gridPoint = at(mapping, 560, 60);
    await expect.poll(() => hasColorNear(page, gridPoint, [58, 58, 58], 2, 14)).toBe(false);
    await toggle(page, "grid").click();
    await expect.poll(() => hasColorNear(page, gridPoint, [58, 58, 58], 2, 14)).toBe(true);

    // SNAP オン: (563,57) 付近のクリックは、(560,60) になる
    await toggle(page, "snap").click();
    const text = await drawLineAndRead(page, mapping, { click: at(mapping, 563, 57) }, at(mapping, 703, 117), at(mapping, 630, 90));
    expect(text).toContain("560.0 mm, 60.0 mm");
    expect(text).toContain("700.0 mm, 120.0 mm");
  });

  test("an invalid grid spacing is refused with the reason, and the old value stays", async ({ page }) => {
    await openEditable(page);
    await page.getByTestId("snap-settings-button").click();
    await page.getByTestId("snap-grid-spacing").fill("abc");
    await page.getByTestId("snap-grid-spacing").press("Enter");
    await expect(page.getByTestId("snap-grid-spacing-error")).toContainText("数値");
    await page.getByTestId("snap-grid-spacing").fill("0");
    await page.getByTestId("snap-grid-spacing").press("Enter");
    await expect(page.getByTestId("snap-grid-spacing-error")).toContainText("範囲");
    await page.getByTestId("snap-grid-spacing").fill("25");
    await page.getByTestId("snap-grid-spacing").press("Enter");
    await expect(page.getByTestId("snap-grid-spacing-error")).toHaveCount(0);
  });

  test("the settings are kept when the drawing is opened again", async ({ page }) => {
    await openEditable(page);
    await toggle(page, "osnap").click(); // OSNAP オフ
    await setSnapType(page, "tangent", true);
    await closeSnapSettings(page);
    await openDrawing(page, "factory.dxf", factoryLayoutDxf()); // ページを読み込み直して、開き直す
    await expect(toggle(page, "osnap")).toHaveAttribute("aria-pressed", "false");
    await page.getByTestId("snap-settings-button").click();
    await expect(page.getByTestId("snap-type-tangent")).toBeChecked();
    await expect(page.getByTestId("snap-type-endpoint")).toBeChecked();
  });
});

test.describe("measurement uses the new Snap too", () => {
  test("a measurement point snaps to a circle's center", async ({ page }) => {
    const mapping = await openEditable(page);
    await page.keyboard.press("m"); // 測定モード
    await clickAt(page, at(mapping, 302.5, 297.5)); // 中心 (300,300) の近く
    await clickAt(page, at(mapping, 100.3, 100.3)); // 線の端点 (100,100) の近く
    // 中心 (300,300) と端点 (100,100) の距離は 282.8 mm(吸着していれば、ぴったり)
    await expect(page.locator(".measurement-panel")).toContainText("282.8 mm");
  });
});
