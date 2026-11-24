// 文字(TEXT・MTEXT・TEXTEDIT)と文字スタイル(Phase 14)のE2Eテスト。
// 工場レイアウトの図面の何も無い所(x 100〜400、y 280〜400)に、文字を描く。文字の入力は、画面の入力パネルで行う。
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
const panel = (page: Page) => page.getByTestId("text-input-panel");
const field = (page: Page) => page.getByTestId("text-input-field");
const stylePanel = (page: Page) => page.getByTestId("text-style-panel");
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

async function select(page: Page, p: Pt, text: string): Promise<void> {
  await page.mouse.click(p.x, p.y);
  await expect(propertyPanel(page)).toContainText(text);
}

/** 文字スタイルのパネルを開いて、高さを設定する(文字を小さくして、何も無い所に収める) */
async function setStyleHeight(page: Page, height: string): Promise<void> {
  await toolbarButton(page, "文字スタイル").click();
  await expect(stylePanel(page)).toBeVisible();
  await page.getByTestId("text-style-height").fill(height);
  await page.getByTestId("text-style-height").press("Enter");
  await page.getByTestId("text-style-close").click();
  await expect(stylePanel(page)).toBeHidden();
}

/** TEXT で、(x, y) に文字を描く(回転角は Enter = 0度) */
async function drawText(page: Page, mapping: Mapping, x: number, y: number, content: string): Promise<void> {
  await typeCommand(page, "text");
  const p = at(mapping, x, y);
  await page.mouse.click(p.x, p.y);
  await expect(log(page)).toContainText("回転角を指示してください");
  await typeCommand(page, "");
  await expect(panel(page)).toBeVisible();
  await field(page).fill(content);
  await field(page).press("Enter");
  await expect(log(page)).toContainText("文字を追加しました");
}

test.describe("TEXT", () => {
  test("the style height, then TEXT: the insertion point, the rotation (Enter) and the text in the panel add ONE text; one Undo removes it", async ({ page }) => {
    const mapping = await openEditable(page);
    await setStyleHeight(page, "20");
    const before = await entityCount(page);
    await typeCommand(page, "text");
    await expect(label(page)).toHaveText("TEXT:");
    await expect(log(page)).toContainText("文字の挿入点を指示してください");
    const p = at(mapping, 100, 350);
    await page.mouse.click(p.x, p.y);
    await expect(log(page)).toContainText("回転角を指示してください");
    await typeCommand(page, "");
    await expect(panel(page)).toBeVisible();
    await expect(page.getByTestId("text-input-ok")).toBeVisible();
    await field(page).fill("検査 A");
    await field(page).press("Enter");
    await expect(log(page)).toContainText("文字を追加しました");
    await expect(panel(page)).toBeHidden();
    await expect(label(page)).toHaveText("コマンド:");
    expect(await entityCount(page)).toBe(before + 1);

    // 描いた文字を選ぶと、内容・高さ・スタイルが見える
    await select(page, at(mapping, 110, 360), "検査 A");
    await expect(propertyPanel(page)).toContainText("20.0 mm");
    await expect(propertyPanel(page)).toContainText("Standard");
    await expect(propertyPanel(page)).toContainText("sans-serif");

    await undo(page);
    await expect(log(page)).toContainText("元に戻しました: 文字を追加");
    expect(await entityCount(page)).toBe(before);
  });

  test("a rotation typed as a number turns the text; Esc in the panel cancels without a text", async ({ page }) => {
    const mapping = await openEditable(page);
    await setStyleHeight(page, "20");
    const before = await entityCount(page);
    await typeCommand(page, "text");
    const p = at(mapping, 100, 350);
    await page.mouse.click(p.x, p.y);
    await typeCommand(page, "90");
    await expect(panel(page)).toBeVisible();
    await field(page).fill("縦書き風");
    await field(page).press("Escape");
    await expect(panel(page)).toBeHidden();
    await expect(label(page)).toHaveText("コマンド:");
    expect(await entityCount(page)).toBe(before);
  });

  test("empty text is refused with the reason and the panel stays open", async ({ page }) => {
    const mapping = await openEditable(page);
    await setStyleHeight(page, "20");
    const before = await entityCount(page);
    await typeCommand(page, "dt");
    const p = at(mapping, 100, 350);
    await page.mouse.click(p.x, p.y);
    await typeCommand(page, "");
    await field(page).press("Enter");
    await expect(log(page)).toContainText("文字が空です");
    await expect(panel(page)).toBeVisible();
    await page.getByTestId("text-input-cancel").click();
    await expect(panel(page)).toBeHidden();
    expect(await entityCount(page)).toBe(before);
  });

  test("a refused text (only invisible characters) stays in the panel so it can be corrected; Esc works with the focus on a button too", async ({ page }) => {
    const mapping = await openEditable(page);
    await setStyleHeight(page, "20");
    const before = await entityCount(page);
    await typeCommand(page, "dt");
    const p = at(mapping, 100, 350);
    await page.mouse.click(p.x, p.y);
    await typeCommand(page, "");
    await field(page).fill("\u200b\u200b");
    await field(page).press("Enter");
    await expect(log(page)).toContainText("見えない文字だけです");
    await expect(panel(page)).toBeVisible();
    // パネルは作り直されても、入力した文字は残っている(直せる)
    await expect(field(page)).toHaveValue("\u200b\u200b");
    await field(page).fill("直した文字");
    await field(page).press("Enter");
    await expect(log(page)).toContainText("文字を追加しました");
    expect(await entityCount(page)).toBe(before + 1);

    // ボタンにフォーカスがあっても、Esc で取り消せる
    await typeCommand(page, "dt");
    await page.mouse.click(p.x, p.y + 40);
    await typeCommand(page, "");
    await page.getByTestId("text-input-ok").focus();
    await page.keyboard.press("Escape");
    await expect(panel(page)).toBeHidden();
    expect(await entityCount(page)).toBe(before + 1);
  });

  test("Japanese text typed in the panel is kept as it is", async ({ page }) => {
    const mapping = await openEditable(page);
    await setStyleHeight(page, "20");
    await drawText(page, mapping, 100, 350, "コンベヤ 全長 1,500 mm");
    await select(page, at(mapping, 110, 360), "コンベヤ 全長 1,500 mm");
  });

  test("the toolbar buttons start TEXT, MTEXT and TEXTEDIT, and open the style panel", async ({ page }) => {
    await openEditable(page);
    await toolbarButton(page, "文字").click();
    await expect(label(page)).toHaveText("TEXT:");
    await page.keyboard.press("Escape");
    await toolbarButton(page, "複数行文字").click();
    await expect(label(page)).toHaveText("MTEXT:");
    await page.keyboard.press("Escape");
    await toolbarButton(page, "文字編集").click();
    await expect(label(page)).toHaveText("TEXTEDIT:");
    await page.keyboard.press("Escape");
    await toolbarButton(page, "文字スタイル").click();
    await expect(stylePanel(page)).toBeVisible();
  });
});

test.describe("MTEXT", () => {
  test("two corners and a multiline text (Ctrl+Enter) add a boxed text that wraps at the box width", async ({ page }) => {
    const mapping = await openEditable(page);
    await setStyleHeight(page, "20");
    const before = await entityCount(page);
    await typeCommand(page, "mtext");
    await expect(label(page)).toHaveText("MTEXT:");
    const first = at(mapping, 100, 380);
    await page.mouse.click(first.x, first.y);
    await expect(log(page)).toContainText("枠の反対の角");
    const second = at(mapping, 160, 300); // 枠の幅 60mm。文字の高さ 20mm なら、約 4.6 文字分
    await page.mouse.click(second.x, second.y);
    await expect(panel(page)).toBeVisible();
    await field(page).fill("aaa bbb ccc");
    // Enter は改行(確定しない)。Ctrl+Enter で確定
    await field(page).press("Enter");
    await expect(panel(page)).toBeVisible();
    await field(page).press("Control+Enter");
    // 画面のクリックの位置は、ピクセルに丸まるので、枠の幅は、60mm に、ほぼ近い値
    await expect(log(page)).toContainText(/複数行文字を追加しました\(枠の幅 (59|60)/);
    expect(await entityCount(page)).toBe(before + 1);

    // 枠の幅 60mm・高さ 20mm なら、折り返して、3行以上(1行 24mm)。枠の左上(100,380)から下へ
    await select(page, at(mapping, 110, 360), "MTEXT");
    await expect(propertyPanel(page)).toContainText(/(59|60)\.\d mm/);

    await undo(page);
    expect(await entityCount(page)).toBe(before);
  });

  test("a box of width 0 is refused and the second corner is asked again", async ({ page }) => {
    const mapping = await openEditable(page);
    await typeCommand(page, "mt");
    const first = at(mapping, 100, 380);
    await page.mouse.click(first.x, first.y);
    await typeCommand(page, "@0,-50");
    await expect(log(page)).toContainText("枠の幅が 0");
    await expect(label(page)).toHaveText("MTEXT:");
    await page.keyboard.press("Escape");
  });
});

test.describe("TEXTEDIT", () => {
  test("a text drawn here: the panel starts with its content; the new content replaces it; one Undo brings the old one back", async ({ page }) => {
    const mapping = await openEditable(page);
    await setStyleHeight(page, "20");
    await drawText(page, mapping, 100, 350, "検査 A");
    const before = await entityCount(page);
    await typeCommand(page, "ed");
    await expect(log(page)).toContainText("内容を直す文字をクリック");
    const p = at(mapping, 110, 360);
    await page.mouse.click(p.x, p.y);
    await expect(panel(page)).toBeVisible();
    await expect(field(page)).toHaveValue("検査 A");
    await field(page).fill("検査 B");
    await field(page).press("Enter");
    await expect(log(page)).toContainText("文字を書き換えました");
    expect(await entityCount(page)).toBe(before);
    await select(page, p, "検査 B");

    await undo(page);
    await expect(log(page)).toContainText("元に戻しました: 文字を編集");
    await select(page, p, "検査 A");
  });

  test("an imported text can be edited too (the drawing's own text), and Undo restores it", async ({ page }) => {
    const mapping = await openEditable(page);
    await typeCommand(page, "textedit");
    const p = at(mapping, 150, 575); // 取り込んだ文字 REGRESSION(基準点 (100,560)、高さ 30)
    await page.mouse.click(p.x, p.y);
    await expect(panel(page)).toBeVisible();
    await expect(field(page)).toHaveValue("REGRESSION");
    await field(page).fill("CHANGED");
    await field(page).press("Enter");
    await expect(log(page)).toContainText("文字を書き換えました");
    await select(page, p, "CHANGED");
    await undo(page);
    await select(page, p, "REGRESSION");
  });

  test("clicking something that is not a text is refused with the reason", async ({ page }) => {
    const mapping = await openEditable(page);
    await typeCommand(page, "ed");
    const circle = at(mapping, 200, 300); // MACHINE の円の左端
    await page.mouse.click(circle.x, circle.y);
    await expect(log(page)).toContainText("CIRCLE は、文字編集できません");
    await expect(label(page)).toHaveText("TEXTEDIT:");
    await page.keyboard.press("Escape");
  });
});

test.describe("text styles", () => {
  test("a new style (height, italic) is used for the next text; changing the current style later does not change the text already drawn", async ({ page }) => {
    const mapping = await openEditable(page);
    await toolbarButton(page, "文字スタイル").click();
    await expect(stylePanel(page)).toBeVisible();
    await page.getByTestId("text-style-name").fill("見出し");
    await page.getByTestId("text-style-new").click();
    await expect(page.getByTestId("text-style-select")).toHaveValue("見出し");
    await page.getByTestId("text-style-height").fill("30");
    await page.getByTestId("text-style-height").press("Enter");
    await page.getByTestId("text-style-italic").check();
    await page.getByTestId("text-style-close").click();

    await drawText(page, mapping, 100, 350, "見出し A");
    await select(page, at(mapping, 110, 365), "見出し A");
    await expect(propertyPanel(page)).toContainText("見出し");
    await expect(propertyPanel(page)).toContainText("30.0 mm");
    await expect(propertyPanel(page)).toContainText("Italic");

    // 現在のスタイルを Standard に戻しても、描いた文字は変わらない
    await toolbarButton(page, "文字スタイル").click();
    await page.getByTestId("text-style-select").selectOption("Standard");
    await page.getByTestId("text-style-close").click();
    await select(page, at(mapping, 110, 365), "見出し A");
    await expect(propertyPanel(page)).toContainText("30.0 mm");
    await expect(propertyPanel(page)).toContainText("Italic");
  });

  test("bad values are refused with the reason and the style does not change; Standard cannot be deleted or renamed", async ({ page }) => {
    await openEditable(page);
    await toolbarButton(page, "文字スタイル").click();
    await page.getByTestId("text-style-height").fill("-5");
    await page.getByTestId("text-style-height").press("Enter");
    await expect(page.getByTestId("text-style-error")).toContainText("高さ");
    await expect(page.getByTestId("text-style-delete")).toBeDisabled();
    await expect(page.getByTestId("text-style-rename")).toBeDisabled();
    // 同じ名前は作れない
    await page.getByTestId("text-style-name").fill("Standard");
    await page.getByTestId("text-style-new").click();
    await expect(page.getByTestId("text-style-error")).toContainText("すでにあります");
  });

  test("the styles are kept in this browser: after opening the drawing again, the height is still there", async ({ page }) => {
    await openEditable(page);
    await setStyleHeight(page, "33");
    await openEditable(page);
    await toolbarButton(page, "文字スタイル").click();
    await expect(page.getByTestId("text-style-height")).toHaveValue("33");
  });

  test("Esc closes the style panel, but an Esc that cancels an IME conversion does not", async ({ page }) => {
    await openEditable(page);
    await toolbarButton(page, "文字スタイル").click();
    await expect(stylePanel(page)).toBeVisible();
    await page.getByTestId("text-style-name").focus();
    // 日本語の入力(IME)の変換中の Esc(isComposing)は、変換の取り消し: パネルは閉じない
    await page.getByTestId("text-style-name").evaluate((element) => {
      element.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", isComposing: true, bubbles: true, cancelable: true }));
    });
    await expect(stylePanel(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(stylePanel(page)).toBeHidden();
  });

  test("a height typed but not confirmed is kept when another value is changed right after (both changes are applied)", async ({ page }) => {
    await openEditable(page);
    await toolbarButton(page, "文字スタイル").click();
    await page.getByTestId("text-style-height").fill("44");
    // Enter を押さずに、斜体のチェックを付ける(高さの欄を離れる=確定 → 斜体の変更)
    await page.getByTestId("text-style-italic").check();
    await expect(page.getByTestId("text-style-height")).toHaveValue("44");
    await expect(page.getByTestId("text-style-italic")).toBeChecked();
    await expect(page.getByTestId("text-style-error")).toBeHidden();
    // 閉じて開き直しても、両方が残っている
    await page.getByTestId("text-style-close").click();
    await toolbarButton(page, "文字スタイル").click();
    await expect(page.getByTestId("text-style-height")).toHaveValue("44");
    await expect(page.getByTestId("text-style-italic")).toBeChecked();
  });
});
