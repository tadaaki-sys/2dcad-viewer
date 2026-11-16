// トラッキング(ORTHO・POLAR・OTRACK、角度の刻み、間隔。Phase 8)のE2Eテスト。
// 工場レイアウトの図面の空いている場所に線を描いて、終点が揃った位置になることを、描いた線のプロパティ(座標は小数1桁)で確かめる。
// クリックは画素単位なので、狙いから数mmずらした位置をクリックする。
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
const toggle = (page: Page, name: "ortho" | "polar" | "otrack" | "osnap" | "snap" | "grid") => page.getByTestId(`status-toggle-${name}`);

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

async function moveTo(page: Page, p: Pt): Promise<void> {
  await page.mouse.move(p.x, p.y);
}

async function clickAt(page: Page, p: Pt): Promise<void> {
  await page.mouse.click(p.x, p.y);
}

async function setOn(page: Page, name: "ortho" | "polar" | "otrack", on: boolean): Promise<void> {
  const button = toggle(page, name);
  if ((await button.getAttribute("aria-pressed")) !== String(on)) await button.click();
  await expect(button).toHaveAttribute("aria-pressed", String(on));
}

/** 描いた線を選んで、プロパティの「End X/Y」(終点)を読む */
async function selectAndReadEnd(page: Page, selectAtPoint: Pt): Promise<{ x: number; y: number; text: string }> {
  await clickAt(page, selectAtPoint);
  await expect(propertyPanel(page)).toContainText("LINE");
  const text = await propertyPanel(page).innerText();
  const match = /End X\/Y\s*(-?[\d.]+) mm, (-?[\d.]+) mm/.exec(text);
  if (match === null) throw new Error(`終点を読み取れません: ${text}`);
  return { x: Number(match[1]), y: Number(match[2]), text };
}

/** 線を描く: 始点を座標で入力、終点をクリック、Esc で終了 */
async function drawLine(page: Page, start: string, endClick: Pt): Promise<void> {
  await typeCommand(page, "line");
  await typeCommand(page, start);
  await clickAt(page, endClick);
  await page.keyboard.press("Escape");
  await expect(label(page)).toHaveText("コマンド:");
}

test.describe("ORTHO", () => {
  test("the end point is aligned horizontally or vertically from the previous point", async ({ page }) => {
    const mapping = await openEditable(page);
    await setOn(page, "ortho", true);
    // 水平: (550,50) から、少し上にずれた (650,57) をクリック -> y=50
    await drawLine(page, "550,50", at(mapping, 650, 57));
    const horizontal = await selectAndReadEnd(page, at(mapping, 600, 50));
    expect(horizontal.y).toBe(50);
    expect(horizontal.x).toBeGreaterThan(640);
    await page.keyboard.press("Escape");
    // 垂直: (550,100) から、少し右にずれた (557,170) をクリック -> x=550
    await drawLine(page, "550,100", at(mapping, 557, 170));
    const vertical = await selectAndReadEnd(page, at(mapping, 550, 135));
    expect(vertical.x).toBe(550);
    expect(vertical.y).toBeGreaterThan(160);
  });

  test("without ORTHO the same clicks are not aligned", async ({ page }) => {
    const mapping = await openEditable(page);
    await drawLine(page, "550,50", at(mapping, 650, 57));
    const end = await selectAndReadEnd(page, at(mapping, 600, 53));
    expect(end.y).not.toBe(50);
  });

  test("a typed length goes along the aligned direction (direct distance entry)", async ({ page }) => {
    const mapping = await openEditable(page);
    await setOn(page, "ortho", true);
    await typeCommand(page, "line");
    await typeCommand(page, "550,50");
    await moveTo(page, at(mapping, 700, 62)); // ほぼ水平
    await input(page).focus();
    await page.keyboard.type("120");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    const end = await selectAndReadEnd(page, at(mapping, 610, 50));
    expect(end).toMatchObject({ x: 670, y: 50 });
  });

  test("the first point is not constrained (there is no base point)", async ({ page }) => {
    const mapping = await openEditable(page);
    await setOn(page, "ortho", true);
    await typeCommand(page, "id");
    const p = at(mapping, 612, 47);
    await clickAt(page, p);
    await expect(log(page)).toContainText(/X = 61\d\.\d, Y = 4[6-8]\.\d/); // 揃えられず、クリックした位置のまま
  });

  test("measurement uses ORTHO from the first measurement point", async ({ page }) => {
    const mapping = await openEditable(page);
    await setOn(page, "ortho", true);
    await page.keyboard.press("m");
    await clickAt(page, at(mapping, 550, 50));
    await clickAt(page, at(mapping, 700, 60));
    await expect(page.locator(".measurement-panel")).toContainText("V: 0.0 mm"); // 垂直方向の差が 0 (水平に揃う)
  });
});

test.describe("POLAR", () => {
  test("aligns to a ray of the angle increment (45 degrees by default)", async ({ page }) => {
    const mapping = await openEditable(page);
    await setOn(page, "polar", true);
    // (550,50) から 45 度の線の近く (650, 152) -> 線の上の点になり、x の差と y の差が等しい
    await drawLine(page, "550,50", at(mapping, 650, 152));
    const end = await selectAndReadEnd(page, at(mapping, 600, 100));
    expect(Math.abs(end.x - 550 - (end.y - 50))).toBeLessThan(0.11);
    expect(end.x).toBeGreaterThan(640);
  });

  test("a click far from every ray is not aligned", async ({ page }) => {
    const mapping = await openEditable(page);
    await setOn(page, "polar", true);
    // 45 度の線からも 0 度の線からも遠い (650, 120)(約 35 度)
    await drawLine(page, "550,50", at(mapping, 650, 120));
    const end = await selectAndReadEnd(page, at(mapping, 600, 85));
    expect(Math.abs(end.x - 550 - (end.y - 50))).toBeGreaterThan(5);
    expect(end.y).not.toBe(50);
  });

  test("the angle increment can be changed in the settings (30 degrees)", async ({ page }) => {
    const mapping = await openEditable(page);
    await setOn(page, "polar", true);
    await page.getByTestId("snap-settings-button").click();
    await page.getByTestId("tracking-angle-increment").selectOption("30");
    await page.getByTestId("snap-settings-button").click();
    // 30 度の線の近く: (650, 50 + 100·tan30 = 107.7) の近く (650, 110)
    await drawLine(page, "550,50", at(mapping, 650, 109));
    const end = await selectAndReadEnd(page, at(mapping, 600, 80));
    expect(Math.abs((end.y - 50) / (end.x - 550) - Math.tan((30 * Math.PI) / 180))).toBeLessThan(0.002);
  });

  test("the distance increment rounds the length to a multiple", async ({ page }) => {
    const mapping = await openEditable(page);
    await setOn(page, "polar", true);
    await page.getByTestId("snap-settings-button").click();
    await page.getByTestId("tracking-distance-increment").fill("25");
    await page.getByTestId("tracking-distance-increment").press("Enter");
    await page.getByTestId("snap-settings-button").click();
    // 0 度の線の上、基準点から約 101 -> 100(25 の倍数)
    await drawLine(page, "550,50", at(mapping, 651, 51));
    const end = await selectAndReadEnd(page, at(mapping, 600, 50));
    expect(end).toMatchObject({ x: 650, y: 50 });
  });

  test("an invalid distance increment is refused with the reason", async ({ page }) => {
    await openEditable(page);
    await page.getByTestId("snap-settings-button").click();
    await page.getByTestId("tracking-distance-increment").fill("abc");
    await page.getByTestId("tracking-distance-increment").press("Enter");
    await expect(page.getByTestId("tracking-distance-error")).toContainText("数値");
    await page.getByTestId("tracking-distance-increment").fill("-5");
    await page.getByTestId("tracking-distance-increment").press("Enter");
    await expect(page.getByTestId("tracking-distance-error")).toBeVisible();
    await page.getByTestId("tracking-distance-increment").fill("0");
    await page.getByTestId("tracking-distance-increment").press("Enter");
    await expect(page.getByTestId("tracking-distance-error")).toHaveCount(0);
  });
});

test.describe("OTRACK", () => {
  // 工場レイアウトの図面: 線 (100,100)-(500,100) の右端 (500,100) と、円 (300,300) 半径 100 の中心 (300,300)
  test("hovering an endpoint for a moment acquires it; the vertical line through it aligns the cursor", async ({ page }) => {
    const mapping = await openEditable(page);
    await setOn(page, "otrack", true);
    await typeCommand(page, "line");
    await typeCommand(page, "300,250");
    await moveTo(page, at(mapping, 503, 97)); // 端点 (500,100) の近く
    await page.waitForTimeout(600); // 約0.3秒のとどめ
    await moveTo(page, at(mapping, 502.5, 250));
    await clickAt(page, at(mapping, 502.5, 250));
    await page.keyboard.press("Escape");
    const end = await selectAndReadEnd(page, at(mapping, 400, 250));
    expect(end.x).toBe(500); // 取得した端点の真上(x がちょうど 500)
  });

  test("moving on before the dwell time does not acquire", async ({ page }) => {
    const mapping = await openEditable(page);
    await setOn(page, "otrack", true);
    await typeCommand(page, "line");
    await typeCommand(page, "300,250");
    await moveTo(page, at(mapping, 503, 97));
    await page.waitForTimeout(80); // 短すぎる
    await moveTo(page, at(mapping, 502.5, 250));
    await clickAt(page, at(mapping, 502.5, 250));
    await page.keyboard.press("Escape");
    const end = await selectAndReadEnd(page, at(mapping, 400, 250));
    expect(end.x).not.toBe(500);
  });

  test("two acquired points: the cursor snaps to the crossing of their vertical and horizontal lines", async ({ page }) => {
    const mapping = await openEditable(page);
    await setOn(page, "otrack", true);
    await typeCommand(page, "line");
    await typeCommand(page, "700,30");
    await moveTo(page, at(mapping, 503, 97)); // 端点 (500,100)
    await page.waitForTimeout(600);
    await moveTo(page, at(mapping, 302.5, 297.5)); // 円の中心 (300,300)
    await page.waitForTimeout(600);
    // 端点の真上(x=500)と、中心の真横(y=300)の交点 (500,300) の近く
    await moveTo(page, at(mapping, 502, 298));
    await clickAt(page, at(mapping, 502, 298));
    await page.keyboard.press("Escape");
    const end = await selectAndReadEnd(page, at(mapping, 600, 165));
    expect(end).toMatchObject({ x: 500, y: 300 });
  });

  test("hovering an acquired point again releases it", async ({ page }) => {
    const mapping = await openEditable(page);
    await setOn(page, "otrack", true);
    await typeCommand(page, "line");
    await typeCommand(page, "300,250");
    await moveTo(page, at(mapping, 503, 97));
    await page.waitForTimeout(600); // 取得
    await moveTo(page, at(mapping, 600, 400)); // 離れる
    await page.waitForTimeout(100);
    await moveTo(page, at(mapping, 503, 97));
    await page.waitForTimeout(600); // もう一度 -> 取得の解除
    await moveTo(page, at(mapping, 502.5, 250));
    await clickAt(page, at(mapping, 502.5, 250));
    await page.keyboard.press("Escape");
    const end = await selectAndReadEnd(page, at(mapping, 400, 250));
    expect(end.x).not.toBe(500);
  });

  test("turning OTRACK off drops the acquired points", async ({ page }) => {
    const mapping = await openEditable(page);
    await setOn(page, "otrack", true);
    await typeCommand(page, "line");
    await typeCommand(page, "300,250");
    await moveTo(page, at(mapping, 503, 97));
    await page.waitForTimeout(600);
    await page.keyboard.press("F11"); // OTRACK をオフ
    await expect(toggle(page, "otrack")).toHaveAttribute("aria-pressed", "false");
    await page.keyboard.press("F11"); // オンに戻す(取得した点は、捨てられている)
    await expect(toggle(page, "otrack")).toHaveAttribute("aria-pressed", "true");
    await moveTo(page, at(mapping, 502.5, 250));
    await clickAt(page, at(mapping, 502.5, 250));
    await page.keyboard.press("Escape");
    const end = await selectAndReadEnd(page, at(mapping, 400, 250));
    expect(end.x).not.toBe(500);
  });
});

test.describe("buttons, keys and commands", () => {
  test("ORTHO and POLAR are exclusive (button, F8 / F10, command), and say so in the log", async ({ page }) => {
    await openEditable(page);
    await expect(toggle(page, "ortho")).toHaveAttribute("aria-pressed", "false");
    await expect(toggle(page, "polar")).toHaveAttribute("aria-pressed", "false");
    await expect(toggle(page, "otrack")).toHaveAttribute("aria-pressed", "false");

    await page.keyboard.press("F8");
    await expect(toggle(page, "ortho")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("F10");
    await expect(toggle(page, "polar")).toHaveAttribute("aria-pressed", "true");
    await expect(toggle(page, "ortho")).toHaveAttribute("aria-pressed", "false");
    await expect(log(page)).toContainText("ORTHO はオフになりました");

    await typeCommand(page, "ortho");
    await expect(toggle(page, "ortho")).toHaveAttribute("aria-pressed", "true");
    await expect(toggle(page, "polar")).toHaveAttribute("aria-pressed", "false");
    await expect(log(page)).toContainText("POLAR はオフになりました");

    await typeCommand(page, "otrack");
    await expect(toggle(page, "otrack")).toHaveAttribute("aria-pressed", "true");
    await expect(toggle(page, "ortho")).toHaveAttribute("aria-pressed", "true"); // OTRACK は、ORTHO と共存できる
  });

  test("the buttons are in the specified order: GRID, SNAP, ORTHO, POLAR, OSNAP, OTRACK", async ({ page }) => {
    await openEditable(page);
    const labels = await page.locator(".status-bar__toggles .status-bar__toggle").allInnerTexts();
    expect(labels.slice(0, 6)).toEqual(["GRID", "SNAP", "ORTHO", "POLAR", "OSNAP", "OTRACK"]);
  });

  test("a function key does not end the command in progress, and a held key toggles only once", async ({ page }) => {
    await openEditable(page);
    await typeCommand(page, "line");
    await expect(label(page)).toHaveText("LINE:");
    await page.keyboard.down("F8");
    await page.keyboard.down("F8"); // 繰り返し
    await page.keyboard.up("F8");
    await expect(toggle(page, "ortho")).toHaveAttribute("aria-pressed", "true");
    await expect(label(page)).toHaveText("LINE:");
    await page.keyboard.press("Escape");
  });

  test("the settings are kept when the drawing is opened again", async ({ page }) => {
    await openEditable(page);
    await setOn(page, "polar", true);
    await setOn(page, "otrack", true);
    await page.getByTestId("snap-settings-button").click();
    await page.getByTestId("tracking-angle-increment").selectOption("22.5");
    await page.getByTestId("snap-settings-button").click();
    await openDrawing(page, "factory.dxf", factoryLayoutDxf());
    await expect(toggle(page, "polar")).toHaveAttribute("aria-pressed", "true");
    await expect(toggle(page, "otrack")).toHaveAttribute("aria-pressed", "true");
    await expect(toggle(page, "ortho")).toHaveAttribute("aria-pressed", "false");
    await page.getByTestId("snap-settings-button").click();
    await expect(page.getByTestId("tracking-angle-increment")).toHaveValue("22.5");
  });
});

test.describe("priority", () => {
  test("an object snap (endpoint) wins over ORTHO", async ({ page }) => {
    const mapping = await openEditable(page);
    await setOn(page, "ortho", true);
    // (300,250) から、端点 (500,100) の近くをクリック。ORTHO なら横一直線 (500,250) になるが、端点に吸着する
    await drawLine(page, "300,250", at(mapping, 502, 98));
    const end = await selectAndReadEnd(page, at(mapping, 400, 175));
    expect(end).toMatchObject({ x: 500, y: 100 });
  });

  test("tracking wins over nearest: a polar ray near a line is followed instead of the point on the line", async ({ page }) => {
    const mapping = await openEditable(page);
    await setOn(page, "polar", true);
    // 線 (100,100)-(500,100) の近く。基準点 (300,30) から真上(90度)の線は、(300,100)(中点)を通る。
    // (303,103) の近くをクリックすると、中点(吸着が優先)ではなく… 中点から離れた (320,103) では、近接より極トラッキングが優先
    await drawLine(page, "320,30", at(mapping, 321, 103));
    const end = await selectAndReadEnd(page, at(mapping, 320, 65));
    expect(end.x).toBe(320); // 基準点の真上(90度)に揃う(近接なら、線の上の最近点 (321,100) になる)
  });
});
