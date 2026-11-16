// ダイナミック入力(カーソル付近の X・Y・長さ・角度の表示と、数値入力。Phase 6)のE2Eテスト。
// 入力はコマンドラインで受け、カーソル付近の表示は、打っている途中の値を映す。
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
const tooltip = (page: Page) => page.getByTestId("dynamic-input");
const row = (page: Page, name: "x" | "y" | "length" | "angle") => page.getByTestId(`dynamic-input-${name}`);
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

async function moveTo(page: Page, p: Pt): Promise<void> {
  await page.mouse.move(p.x, p.y);
}

async function expectHue(page: Page, p: Pt, color: [number, number, number], present: boolean): Promise<void> {
  await expect.poll(() => hasHueNear(page, p, color, 5), { timeout: 5_000 }).toBe(present);
}

/** 描いた線を、中点のクリックで選ぶ(コマンドが終わっているとき) */
async function selectAt(page: Page, p: Pt): Promise<void> {
  await page.mouse.click(p.x, p.y);
  await expect(propertyPanel(page)).toContainText("LINE");
}

test.describe("display near the cursor", () => {
  test("shows X, Y, length and angle (1 decimal) while a point is awaited, only then", async ({ page }) => {
    const mapping = await openEditable(page);
    await expect(tooltip(page)).toHaveCount(0); // コマンドが無いときは出ない

    await typeCommand(page, "line");
    await moveTo(page, at(mapping, 550, 50));
    // 1点目: X・Y が入力できる項目。長さ・角度は、基準点が無いので「-」
    await expect(tooltip(page)).toBeVisible();
    await expect(row(page, "x")).toContainText(/^X\s*\d+\.\d$/);
    await expect(row(page, "y")).toContainText(/^Y\s*\d+\.\d$/);
    await expect(row(page, "length")).toContainText("-");
    await expect(row(page, "angle")).toContainText("-");
    await expect(row(page, "x")).toHaveClass(/dynamic-input__row--editable/);
    await expect(row(page, "length")).toHaveClass(/dynamic-input__row--readonly/);

    // 2点目: 長さ・角度が入力できる項目になる。カーソルは基準点の真右(約0度)
    await typeCommand(page, "550,50");
    await moveTo(page, at(mapping, 650, 50));
    await expect(row(page, "length")).toHaveClass(/dynamic-input__row--editable/);
    await expect(row(page, "x")).toHaveClass(/dynamic-input__row--readonly/);
    await expect(row(page, "length")).toContainText(/長さ\s*(99|100|101)\.\d/);
    await expect(row(page, "angle")).toContainText(/角度\s*(0\.\d|359\.\d)°/);

    await page.keyboard.press("Escape");
    await expect(tooltip(page)).toHaveCount(0);
  });
});

test.describe("typing length and angle", () => {
  test("length, Tab, angle, Enter draws a line of that length at that angle", async ({ page }) => {
    const mapping = await openEditable(page);
    const before = await entityCount(page);
    await typeCommand(page, "line");
    await typeCommand(page, "550,50");
    await moveTo(page, at(mapping, 550, 200)); // カーソルは、入力とは関係ない場所へ

    await input(page).focus();
    await page.keyboard.type("120");
    await expect(row(page, "length")).toHaveAttribute("data-state", "typing");
    await expect(row(page, "length")).toContainText("120"); // 打っている途中の値が映る
    await page.keyboard.press("Tab");
    await expect(row(page, "length")).toHaveAttribute("data-state", "locked");
    await expect(row(page, "length")).toContainText("120.0");
    await expect(row(page, "angle")).toHaveClass(/dynamic-input__row--active/);
    await expect(input(page)).toBeFocused(); // Tabで、入力欄から外れない
    await expect(input(page)).toHaveValue("");

    await page.keyboard.type("30");
    await expect(row(page, "angle")).toHaveAttribute("data-state", "typing");
    // 打った値が、ゴム紐に反映される(始点(550,50)から、30度・長さ120の線: 中点 (602,80))
    await expectHue(page, at(mapping, 601.95, 80), WHITE, true);

    await page.keyboard.press("Enter");
    await expect(log(page)).toContainText("長さ 120.0, 角度 30.0°");
    expect(await entityCount(page)).toBe(before); // まだ描きかけ(次の点を待っている)
    await page.keyboard.press("Escape"); // 終了して、描いた分を確定
    expect(await entityCount(page)).toBe(before + 1);

    await selectAt(page, at(mapping, 601.95, 80));
    await expect(propertyPanel(page)).toContainText("120.0 mm"); // 長さ
    await expect(propertyPanel(page)).toContainText("653.9 mm, 110.0 mm"); // 終点: 550+120cos30, 50+120sin30
  });

  test("only the length typed: the direction of the cursor is used; only the angle: the cursor's length", async ({ page }) => {
    const mapping = await openEditable(page);
    await typeCommand(page, "line");
    await typeCommand(page, "550,50");
    await moveTo(page, at(mapping, 700, 50)); // 真右
    await input(page).focus();
    await page.keyboard.type("100");
    await page.keyboard.press("Enter");
    await expect(log(page)).toContainText("長さ 100.0");

    // 次の点(基準は (650,50) 付近)で、角度だけを打つ
    await moveTo(page, at(mapping, 650, 110)); // 基準点の真上、長さ約60
    await input(page).focus();
    await page.keyboard.press("Tab"); // 長さは打たずに、角度へ
    await page.keyboard.type("0");
    await page.keyboard.press("Enter");
    await expect(log(page)).toContainText("角度 0.0°");
    await page.keyboard.press("Escape");

    // 2本の線ができている。1本目は長さ100(中点 (600,50))、2本目は真右へ、カーソルの長さ(約60)
    await selectAt(page, at(mapping, 600, 50));
    await expect(propertyPanel(page)).toContainText("100.0 mm");
  });

  test("a bad length is refused with the reason and the command keeps waiting", async ({ page }) => {
    const mapping = await openEditable(page);
    const before = await entityCount(page);
    await typeCommand(page, "line");
    await typeCommand(page, "550,50");
    await moveTo(page, at(mapping, 650, 50));
    await input(page).focus();
    await page.keyboard.type("-5");
    await page.keyboard.press("Enter");
    await expect(log(page)).toContainText("長さは0以上の数値で入力してください");
    expect(await entityCount(page)).toBe(before); // 何も追加されず、同じ段階のまま待つ(入力欄は、これまでどおり Enter で空になる)
    await expect(tooltip(page)).toBeVisible();
    await page.keyboard.type("80");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    expect(await entityCount(page)).toBe(before + 1);
  });

  test("an angle may be negative or larger than 360: it is folded into 0 - 360", async ({ page }) => {
    const mapping = await openEditable(page);
    await typeCommand(page, "line");
    await typeCommand(page, "550,300");
    await moveTo(page, at(mapping, 600, 300));
    await input(page).focus();
    await page.keyboard.type("100");
    await page.keyboard.press("Tab");
    await page.keyboard.type("-90"); // 真下
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    await selectAt(page, at(mapping, 550, 250));
    await expect(propertyPanel(page)).toContainText("550.0 mm, 200.0 mm"); // 終点
  });
});

test.describe("typing X and Y", () => {
  test("X, Tab, Y, Enter gives the first point; an untyped one follows the cursor", async ({ page }) => {
    const mapping = await openEditable(page);
    await typeCommand(page, "line");
    await moveTo(page, at(mapping, 300, 350));
    await input(page).focus();
    await page.keyboard.type("550");
    await page.keyboard.press("Tab");
    await expect(row(page, "x")).toHaveAttribute("data-state", "locked");
    await expect(row(page, "y")).toHaveClass(/dynamic-input__row--active/);
    await page.keyboard.type("50");
    await page.keyboard.press("Enter");
    await expect(log(page)).toContainText("X 550.0, Y 50.0");
    // 2点目へ進み、1点目が基準になる(長さ・角度が入力できる)
    await expect(row(page, "length")).toHaveClass(/dynamic-input__row--editable/);
    await moveTo(page, at(mapping, 650, 50));
    await input(page).focus();
    await page.keyboard.type("100");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    await selectAt(page, at(mapping, 600, 50));
    await expect(propertyPanel(page)).toContainText("100.0 mm");
    await expect(propertyPanel(page)).toContainText("550.0 mm, 50.0 mm");
  });

  test("with only X typed, Y follows the cursor", async ({ page }) => {
    const mapping = await openEditable(page);
    await typeCommand(page, "id");
    await moveTo(page, at(mapping, 300, 350));
    await input(page).focus();
    await page.keyboard.type("550");
    await page.keyboard.press("Enter");
    await expect(log(page)).toContainText(/X = 550\.0, Y = (349|350|351)\.\d/);
  });
});

test.describe("keyboard", () => {
  test("a digit key typed without focus in the command line moves to it and starts typing", async ({ page }) => {
    const mapping = await openEditable(page);
    await toolbarButton(page, "線").click(); // ボタンを押したあと、入力欄にはフォーカスが無い
    await moveTo(page, at(mapping, 400, 300));
    await expect(input(page)).not.toBeFocused();
    await page.keyboard.press("5"); // フォーカスの無い状態で、数字キー
    await page.keyboard.press("0");
    await expect(input(page)).toBeFocused();
    await expect(input(page)).toHaveValue("50");
    await expect(row(page, "x")).toHaveAttribute("data-state", "typing");
    await expect(row(page, "x")).toContainText("50");
    await page.keyboard.press("Escape");
  });

  test("Shift+Tab goes back to the previous field; a value typed for the field is kept when coming back", async ({ page }) => {
    const mapping = await openEditable(page);
    await typeCommand(page, "line");
    await typeCommand(page, "550,50");
    await moveTo(page, at(mapping, 650, 50));
    await input(page).focus();
    await page.keyboard.type("70");
    await page.keyboard.press("Tab");
    await expect(row(page, "angle")).toHaveClass(/dynamic-input__row--active/);
    await page.keyboard.press("Shift+Tab");
    await expect(row(page, "length")).toHaveClass(/dynamic-input__row--active/);
    await expect(row(page, "length")).toContainText("70.0"); // 確定した値は残っている
  });

  test("clicking a point while a length is locked gives the point the rubber band shows (the click decides the direction); the values are then dropped", async ({ page }) => {
    const mapping = await openEditable(page);
    await typeCommand(page, "line");
    await typeCommand(page, "550,50");
    await moveTo(page, at(mapping, 650, 90)); // 始点から約108mm、約22度の向き
    await input(page).focus();
    await page.keyboard.type("70");
    await page.keyboard.press("Tab");
    await page.mouse.click(at(mapping, 650, 90).x, at(mapping, 650, 90).y);
    // 次の点の段階に進み、確定した値は消えている(古い値が残らない)
    await expect(row(page, "length")).toHaveAttribute("data-state", "live");
    await expect(row(page, "length")).toHaveClass(/dynamic-input__row--active/);
    await expect(input(page)).toHaveValue("");
    await page.keyboard.press("Escape");
    // 描かれた線の長さは、確定した 70(クリックした点までの約108ではない)。中点は (582,63) 付近
    await selectAt(page, at(mapping, 582.5, 63));
    await expect(propertyPanel(page)).toContainText("70.0 mm");
  });

  test("coordinates, keywords and an empty Enter still work as before", async ({ page }) => {
    const mapping = await openEditable(page);
    const before = await entityCount(page);
    await typeCommand(page, "line");
    await typeCommand(page, "550,50");
    await typeCommand(page, "@100,0");
    await typeCommand(page, "@0,40");
    await typeCommand(page, "u"); // 1点戻す
    await typeCommand(page, ""); // 終了
    await expect(log(page)).toContainText("1本の線を追加しました");
    expect(await entityCount(page)).toBe(before + 1);
    void mapping;
  });
});

test.describe("Codex review fixes (Phase 6)", () => {
  test("an unreadable value on Tab is not locked: the text stays, the field does not move, and the earlier value is not used by mistake", async ({ page }) => {
    const mapping = await openEditable(page);
    const before = await entityCount(page);
    await typeCommand(page, "line");
    await typeCommand(page, "550,50");
    await moveTo(page, at(mapping, 650, 50));
    await input(page).focus();
    await page.keyboard.type("100");
    await page.keyboard.press("Tab"); // 長さ100を確定し、角度へ
    await page.keyboard.press("Tab"); // 空のTabで、長さへ戻る
    await expect(row(page, "length")).toHaveClass(/dynamic-input__row--active/);
    await page.keyboard.type("-5");
    await page.keyboard.press("Tab"); // 読み取れない値
    await expect(log(page)).toContainText("長さは0以上の数値で入力してください");
    await expect(input(page)).toHaveValue("-5"); // 文字は残る(直せる)
    await expect(row(page, "length")).toHaveClass(/dynamic-input__row--active/); // 項目は動かない
    await expect(row(page, "length")).toHaveAttribute("data-state", "typing");
    // 直して Enter: 直した値(30)が使われる
    await input(page).fill("30");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    expect(await entityCount(page)).toBe(before + 1);
    await selectAt(page, at(mapping, 565, 50));
    await expect(propertyPanel(page)).toContainText("30.0 mm");
  });

  test("the display-only fields follow the point made from the typed values (they agree with the rubber band)", async ({ page }) => {
    const mapping = await openEditable(page);
    await typeCommand(page, "line");
    await typeCommand(page, "550,50");
    await moveTo(page, at(mapping, 700, 300)); // 入力とは関係ない場所
    await input(page).focus();
    await page.keyboard.type("100");
    await page.keyboard.press("Tab");
    await page.keyboard.type("90");
    // 基準点 (550,50) から真上へ100 -> (550,150)。表示専用の X・Y も、カーソルの値ではなく、この点
    await expect(row(page, "x")).toContainText("550.0");
    await expect(row(page, "y")).toContainText("150.0");
    await expect(row(page, "x")).toHaveClass(/dynamic-input__row--readonly/);
    await page.keyboard.press("Escape");
  });

  test("Esc, and a keyword that moves the command forward, drop the typed and locked values", async ({ page }) => {
    const mapping = await openEditable(page);
    await typeCommand(page, "line");
    await typeCommand(page, "550,50");
    await typeCommand(page, "@100,0");
    await moveTo(page, at(mapping, 700, 60));
    await input(page).focus();
    await page.keyboard.type("70");
    await page.keyboard.press("Tab");
    await expect(row(page, "length")).toHaveAttribute("data-state", "locked");
    // 「1点戻す」で、段階が変わる -> 古い値は消える
    await typeCommand(page, "u");
    await expect(row(page, "length")).toHaveAttribute("data-state", "live");
    await expect(row(page, "length")).toHaveClass(/dynamic-input__row--active/);

    await page.keyboard.type("40");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Escape");
    await expect(tooltip(page)).toHaveCount(0);
    // 新しいコマンドでは、前の値が残っていない
    await typeCommand(page, "line");
    await typeCommand(page, "600,100");
    await moveTo(page, at(mapping, 700, 100));
    await expect(row(page, "length")).toHaveAttribute("data-state", "live");
    await expect(row(page, "angle")).toHaveAttribute("data-state", "live");
    await page.keyboard.press("Escape");
  });

  test("with the cursor outside the drawing, a value that needs the cursor is refused with the reason; typing both values works", async ({ page }) => {
    const mapping = await openEditable(page);
    const before = await entityCount(page);
    await typeCommand(page, "line");
    await typeCommand(page, "550,50");
    await moveTo(page, at(mapping, 650, 50));
    await page.mouse.move(400, 10); // ツールバーの上(図面の外)
    await input(page).focus();
    await page.keyboard.type("50");
    await page.keyboard.press("Enter");
    await expect(log(page)).toContainText("カーソルを図面の上に置くか");
    expect(await entityCount(page)).toBe(before);
    // 長さと角度の両方なら、カーソルが無くても指示できる
    await page.keyboard.type("50");
    await page.keyboard.press("Tab");
    await page.keyboard.type("90");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    expect(await entityCount(page)).toBe(before + 1);
  });
});

test.describe("circle radius", () => {
  test("a radius is typed as a plain number (and the preview follows it); D asks for a diameter", async ({ page }) => {
    const mapping = await openEditable(page);
    const before = await entityCount(page);
    await typeCommand(page, "circle");
    await typeCommand(page, "100,300");
    // 長さだけの欄(半径)。数値を打つと、その半径の円がゴム紐で見える
    await moveTo(page, at(mapping, 300, 500));
    await expect(row(page, "length")).toBeVisible();
    await expect(row(page, "angle")).toHaveCount(0);
    await input(page).focus();
    await page.keyboard.type("60");
    await expectHue(page, at(mapping, 100, 360), WHITE, true);
    await page.keyboard.press("Enter");
    await expect(log(page)).toContainText("円を追加しました(半径 60.0)");
    expect(await entityCount(page)).toBe(before + 1);

    await typeCommand(page, "circle");
    await typeCommand(page, "100,100");
    await typeCommand(page, "d");
    await expect(row(page, "length")).toBeVisible();
    await typeCommand(page, "100");
    await expect(log(page)).toContainText("円を追加しました(半径 50.0)");
  });
});
