// 既存ビューアの画面操作を固定するE2Eテスト(Phase 0.5)。
// 見本図面(src/regression/fixtures.ts)をブラウザで開き、実際のマウス・キーボード操作で確認する。
import { expect, test } from "@playwright/test";
import { factoryLayoutDxf, smallDxf, unsupportedDxf } from "../src/regression/fixtures";
import { calibrate, countNonBlackPixels, hasColorNear, hoverAndRead, measurementPanel, openDrawing, propertyPanel } from "./helpers";

const RED: [number, number, number] = [255, 0, 0];

test.describe("opening drawings", () => {
  test("opens a drawing, draws it, and lists the layers (OFF / frozen start unchecked)", async ({ page }) => {
    await openDrawing(page, "factory.dxf", factoryLayoutDxf());

    expect(await countNonBlackPixels(page)).toBeGreaterThan(500);
    const layer = (name: string) => page.locator(".layer-panel__item", { hasText: name }).locator('input[type="checkbox"]');
    await expect(layer("WALL")).toBeChecked();
    await expect(layer("MACHINE")).toBeChecked();
    await expect(layer("HIDDEN_OFF")).not.toBeChecked();
    await expect(layer("FROZEN")).not.toBeChecked();
    await expect(page.locator(".status-bar__unsupported-button")).toHaveCount(0);
  });

  test("shows the unsupported entity count and still draws the rest", async ({ page }) => {
    await openDrawing(page, "unsupported.dxf", unsupportedDxf());
    await expect(page.locator(".status-bar__unsupported-button")).toContainText("1件");
    expect(await countNonBlackPixels(page)).toBeGreaterThan(20);
  });

  test("closes the drawing and opens another one from the toolbar", async ({ page }) => {
    await openDrawing(page, "factory.dxf", factoryLayoutDxf());
    await page.getByRole("button", { name: "図面を閉じる" }).click();
    await expect(page.locator(".start-screen")).toBeVisible();

    await page.locator('input[type="file"]').setInputFiles({ name: "small.dxf", mimeType: "application/dxf", buffer: Buffer.from(smallDxf(), "utf8") });
    await expect(page.locator(".status-bar")).toContainText("small.dxf");
  });
});

test.describe("raw source kept for saving (Phase 1b)", () => {
  const overlay = (page: import("@playwright/test").Page) => page.locator(".performance-overlay");

  test("keeps the original bytes and record index, and classifies the records", async ({ page }) => {
    await openDrawing(page, "factory.dxf", factoryLayoutDxf());
    // 見本図面: 記録17個(編集できる13、読み取り専用4 = INSERT 3と寸法1、未対応0)
    await expect(overlay(page)).toContainText("17 rec");
    await expect(overlay(page)).toContainText("editable 13 / readOnly 4 / unsupported 0");
  });

  test("counts records that are not drawn as unsupported, and keeps drawing the rest", async ({ page }) => {
    await openDrawing(page, "unsupported.dxf", unsupportedDxf());
    await expect(overlay(page)).toContainText("editable 1 / readOnly 0 / unsupported 1");
    expect(await countNonBlackPixels(page)).toBeGreaterThan(20);
  });

  test("replaces the source when another drawing is opened, and clears it when the drawing is closed", async ({ page }) => {
    await openDrawing(page, "factory.dxf", factoryLayoutDxf());
    await expect(overlay(page)).toContainText("17 rec");

    // 別の図面を開くと、元データも入れ替わる
    await page.locator('input[type="file"]').setInputFiles({ name: "small.dxf", mimeType: "application/dxf", buffer: Buffer.from(smallDxf(), "utf8") });
    await expect(page.locator(".status-bar")).toContainText("small.dxf");
    await expect(overlay(page)).toContainText("1 rec");
    await expect(overlay(page)).toContainText("editable 1 / readOnly 0 / unsupported 0");

    // 閉じて、開き直しても、新しい図面の元データになる(前の図面の内容が残らない)
    await page.getByRole("button", { name: "図面を閉じる" }).click();
    await expect(page.locator(".start-screen")).toBeVisible();
    await page.locator('input[type="file"]').setInputFiles({ name: "unsupported.dxf", mimeType: "application/dxf", buffer: Buffer.from(unsupportedDxf(), "utf8") });
    await expect(page.locator(".status-bar")).toContainText("unsupported.dxf");
    await expect(overlay(page)).toContainText("2 rec");
    await expect(overlay(page)).toContainText("editable 1 / readOnly 0 / unsupported 1");
  });

  test("draws the drawing without page errors while the source is kept", async ({ page }) => {
    // 元データの保持が、表示を妨げないこと。(対応づけに失敗した場合に、編集不可になるだけで表示は続く動作は、単体テストで確認している)
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await openDrawing(page, "factory.dxf", factoryLayoutDxf());
    expect(await countNonBlackPixels(page)).toBeGreaterThan(500);
    expect(errors).toEqual([]);
  });
});

test.describe("camera", () => {
  test("zooms with the wheel keeping the point under the cursor, and pans with Space+drag and the middle button", async ({ page }) => {
    await openDrawing(page, "factory.dxf", factoryLayoutDxf());
    const box = (await page.locator("canvas").boundingBox())!;
    const cursor = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

    const before = await calibrate(page);
    const worldBefore = await hoverAndRead(page, cursor);
    await page.mouse.wheel(0, -400); // 手前に回す = 拡大
    await page.waitForTimeout(120);
    const worldAfter = await hoverAndRead(page, cursor);
    const after = await calibrate(page);

    expect(after.mmPerPx).toBeLessThan(before.mmPerPx); // 拡大(1pxあたりのmmが減る)
    expect(Math.abs(worldAfter.x - worldBefore.x)).toBeLessThan(0.3); // カーソル直下の点は動かない
    expect(Math.abs(worldAfter.y - worldBefore.y)).toBeLessThan(0.3);

    // Space+ドラッグで右へ100px動かすと、同じ画面位置のワールド座標は 100*mmPerPx だけ小さくなる
    const reference = await hoverAndRead(page, cursor);
    await page.keyboard.down("Space");
    await page.mouse.move(cursor.x, cursor.y);
    await page.mouse.down();
    await page.mouse.move(cursor.x + 100, cursor.y, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up("Space");
    const panned = await hoverAndRead(page, cursor);
    expect(panned.x).toBeCloseTo(reference.x - 100 * after.mmPerPx, 0);
    expect(panned.y).toBeCloseTo(reference.y, 0);

    // 中ボタンのドラッグでも同様に動く
    await page.mouse.move(cursor.x, cursor.y);
    await page.mouse.down({ button: "middle" });
    await page.mouse.move(cursor.x, cursor.y + 60, { steps: 5 });
    await page.mouse.up({ button: "middle" });
    const pannedMiddle = await hoverAndRead(page, cursor);
    expect(pannedMiddle.y).toBeCloseTo(panned.y + 60 * after.mmPerPx, 0);
  });

  test("fits to the drawing with the button and the F key, using visible layers only", async ({ page }) => {
    await openDrawing(page, "factory.dxf", factoryLayoutDxf());
    const initial = await calibrate(page);

    // ズームしてから、全体表示ボタンで初期表示と同じ倍率に戻る
    await page.mouse.wheel(0, -600);
    await page.waitForTimeout(120);
    expect((await calibrate(page)).mmPerPx).toBeLessThan(initial.mmPerPx);
    await page.getByRole("button", { name: "全体表示" }).click();
    await page.waitForTimeout(120);
    expect((await calibrate(page)).mmPerPx).toBeCloseTo(initial.mmPerPx, 2);

    // Fキーでも同じ
    await page.mouse.wheel(0, -600);
    await page.waitForTimeout(120);
    await page.keyboard.press("f");
    await page.waitForTimeout(120);
    expect((await calibrate(page)).mmPerPx).toBeCloseTo(initial.mmPerPx, 2);

    // 非表示のレイヤー(FROZEN, y=800)を表示にすると、範囲が広がるので1pxあたりのmmが増える(縮小される)
    await page.locator(".layer-panel__item", { hasText: "FROZEN" }).locator('input[type="checkbox"]').check();
    await page.getByRole("button", { name: "全体表示" }).click();
    await page.waitForTimeout(120);
    expect((await calibrate(page)).mmPerPx).toBeGreaterThan(initial.mmPerPx * 1.2);
  });
});

test.describe("layers", () => {
  test("hides and shows a layer's entities when its checkbox is toggled", async ({ page }) => {
    await openDrawing(page, "factory.dxf", factoryLayoutDxf());
    const mapping = await calibrate(page);
    const wallBottom = mapping.toPage({ x: 650, y: 0 });
    expect(await hasColorNear(page, wallBottom, RED)).toBe(true);

    const wallCheckbox = page.locator(".layer-panel__item", { hasText: "WALL" }).locator('input[type="checkbox"]');
    await wallCheckbox.uncheck();
    await page.waitForTimeout(150);
    expect(await hasColorNear(page, wallBottom, RED)).toBe(false);

    await wallCheckbox.check();
    await page.waitForTimeout(150);
    expect(await hasColorNear(page, wallBottom, RED)).toBe(true);
  });
});

test.describe("selection", () => {
  test("selects by click, adds with Ctrl+click, clears with Escape, and ignores empty space", async ({ page }) => {
    await openDrawing(page, "factory.dxf", factoryLayoutDxf());
    const mapping = await calibrate(page);

    await page.mouse.click(...xy(mapping.toPage({ x: 400, y: 300 })));
    await expect(propertyPanel(page)).toContainText("CIRCLE");
    await expect(propertyPanel(page)).toContainText("MACHINE");

    await page.keyboard.down("Control");
    await page.mouse.click(...xy(mapping.toPage({ x: 500, y: 500 })));
    await page.keyboard.up("Control");
    await expect(propertyPanel(page)).toContainText("2 entities selected");

    await page.keyboard.press("Escape");
    await expect(propertyPanel(page)).toContainText("選択なし");

    await page.mouse.click(...xy(mapping.toPage({ x: 650, y: 0 })));
    await expect(propertyPanel(page)).toContainText("LWPOLYLINE");
    await page.mouse.click(...xy(mapping.toPage({ x: 600, y: 350 })));
    await expect(propertyPanel(page)).toContainText("選択なし");
  });

  test("selects by window (left to right) and crossing (right to left) boxes", async ({ page }) => {
    await openDrawing(page, "factory.dxf", factoryLayoutDxf());
    const mapping = await calibrate(page);
    const drag = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
      const a = mapping.toPage(from);
      const b = mapping.toPage(to);
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await page.mouse.move(b.x, b.y, { steps: 8 });
      await page.mouse.up();
    };

    // 円(中心(300,300) 半径100)を完全に含む範囲 → 窓選択で円が選ばれる
    await drag({ x: 180, y: 180 }, { x: 420, y: 420 });
    await expect(propertyPanel(page)).toContainText("CIRCLE");

    // 円の一部しか含まない範囲 → 窓選択では何も選ばれない
    await page.keyboard.press("Escape");
    await drag({ x: 250, y: 250 }, { x: 450, y: 450 });
    await expect(propertyPanel(page)).toContainText("選択なし");

    // 同じ左上の角から、下端をガイド線(Y=450)に触れない高さにして右から左へ → 交差選択で円が選ばれる
    await drag({ x: 450, y: 430 }, { x: 250, y: 250 });
    await expect(propertyPanel(page)).toContainText("CIRCLE");
  });
});

test.describe("measurement", () => {
  test("measures between snapped corners and shows the distances; snaps onto a nearby line", async ({ page }) => {
    await openDrawing(page, "factory.dxf", factoryLayoutDxf());
    const mapping = await calibrate(page);

    await page.keyboard.press("m");
    await expect(page.getByRole("button", { name: "測定" })).toHaveClass(/toolbar__button--active/);

    // 外枠の左下角(0,0)と右上角(1000,600)の近くをクリック → 端点に吸い付いて正確な値になる
    const nearOrigin = mapping.toPage({ x: 4, y: 4 });
    const nearCorner = mapping.toPage({ x: 996, y: 596 });
    await page.mouse.click(nearOrigin.x, nearOrigin.y);
    await page.mouse.click(nearCorner.x, nearCorner.y);
    await expect(measurementPanel(page)).toContainText("H: 1000.0 mm");
    await expect(measurementPanel(page)).toContainText("V: 600.0 mm");
    await expect(measurementPanel(page)).toContainText("D: 1166.2 mm");

    // 線の近く(下辺の少し上)にカーソルを置くと、線の上の点(Y=0)に吸い付く。吸着の目印も出る
    const nearLine = mapping.toPage({ x: 650, y: 3 });
    const snapped = await hoverAndRead(page, nearLine);
    expect(snapped.y).toBe(0);
    // 線から離れた場所では吸い付かない(座標は生のまま)
    const away = await hoverAndRead(page, mapping.toPage({ x: 600, y: 350 }));
    expect(Math.abs(away.y - 350)).toBeLessThan(2);

    // 測定結果を削除すると、一覧が空になる
    await page.getByTitle("この測定結果を削除").click();
    await expect(measurementPanel(page)).toContainText("測定結果なし");

    // Escで測定モードを抜ける
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "測定" })).not.toHaveClass(/toolbar__button--active/);
  });
});

function xy(p: { x: number; y: number }): [number, number] {
  return [p.x, p.y];
}
