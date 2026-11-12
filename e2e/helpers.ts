import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

export type Pt = { x: number; y: number };

/** ファイル選択欄に図面(DXFの文字列)を渡して開く。図面が表示されるまで待つ */
export async function openDrawing(page: Page, fileName: string, dxfText: string): Promise<void> {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: fileName, mimeType: "application/dxf", buffer: Buffer.from(dxfText, "utf8") });
  // 開発サーバーの初回起動は準備に時間がかかるので、待ち時間を長めにする
  await expect(page.locator(".status-bar")).toContainText(fileName, { timeout: 30_000 });
  await expect(page.locator("canvas")).toBeVisible();
  // 描画が始まるまで少し待つ
  await page.waitForTimeout(150);
}

const COORDS_PATTERN = /X:\s*(-?[\d.]+)\s*mm\s+Y:\s*(-?[\d.]+)\s*mm/;

async function readCoords(page: Page): Promise<Pt | null> {
  const text = await page.locator(".status-bar__coords").innerText();
  const match = COORDS_PATTERN.exec(text);
  return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
}

/** マウスを動かして、ステータスバーの座標表示が落ち着くのを待ってから読む(表示は0.1mm単位) */
export async function hoverAndRead(page: Page, point: Pt): Promise<Pt> {
  await page.mouse.move(point.x, point.y);
  await page.waitForTimeout(60);
  let previous: Pt | null = null;
  for (let i = 0; i < 20; i++) {
    const current = await readCoords(page);
    if (current && previous && current.x === previous.x && current.y === previous.y) return current;
    previous = current;
    await page.waitForTimeout(40);
  }
  if (!previous) throw new Error("座標表示を読み取れませんでした");
  return previous;
}

export type Mapping = {
  /** 画面1pxあたりのワールド座標(mm) */
  mmPerPx: number;
  /** ワールド座標(mm) → ページ上の座標(px) */
  toPage: (world: Pt) => Pt;
};

/** キャンバス上の2点にマウスを置いて座標表示を読み、ワールド→画面の対応を求める(拡大率を内部から直接読まないための方法) */
export async function calibrate(page: Page): Promise<Mapping> {
  const box = await page.locator("canvas").boundingBox();
  if (!box) throw new Error("canvasが見つかりません");
  const p1 = { x: box.x + box.width * 0.3, y: box.y + box.height * 0.3 };
  const p2 = { x: box.x + box.width * 0.7, y: box.y + box.height * 0.7 };
  const w1 = await hoverAndRead(page, p1);
  const w2 = await hoverAndRead(page, p2);
  const sx = (p2.x - p1.x) / (w2.x - w1.x); // px / mm
  const sy = (p2.y - p1.y) / (w2.y - w1.y); // 画面のYは下向きなので負になる
  return {
    mmPerPx: 1 / sx,
    toPage: (world) => ({ x: p1.x + (world.x - w1.x) * sx, y: p1.y + (world.y - w1.y) * sy }),
  };
}

/** キャンバスの指定位置(ページ座標)の周囲に、指定色に近い画素があるか。線が描かれているかの確認に使う */
export async function hasColorNear(page: Page, at: Pt, color: [number, number, number], radiusPx = 3, tolerance = 40): Promise<boolean> {
  return page.evaluate(
    ({ at, color, radiusPx, tolerance }) => {
      const canvas = document.querySelector("canvas") as HTMLCanvasElement;
      const rect = canvas.getBoundingClientRect();
      const ratio = canvas.width / rect.width;
      const cx = Math.round((at.x - rect.left) * ratio);
      const cy = Math.round((at.y - rect.top) * ratio);
      const r = Math.round(radiusPx * ratio);
      const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
      const data = ctx.getImageData(Math.max(0, cx - r), Math.max(0, cy - r), 2 * r + 1, 2 * r + 1).data;
      for (let i = 0; i < data.length; i += 4) {
        if (
          Math.abs(data[i] - color[0]) <= tolerance &&
          Math.abs(data[i + 1] - color[1]) <= tolerance &&
          Math.abs(data[i + 2] - color[2]) <= tolerance
        ) {
          return true;
        }
      }
      return false;
    },
    { at, color, radiusPx, tolerance },
  );
}

/**
 * キャンバスの指定位置の周囲に、指定した色と「同じ色相」の画素があるか。
 * 細い線が画素の境目に重なると、2列に薄く(約半分の明るさで)描かれるため、明るさではなく色の比率で比べる
 * (最も強い成分を1に直して、指定色と各成分の差が tolerance 以内。ただし、暗すぎる画素は無視する)。
 */
export async function hasHueNear(page: Page, at: Pt, color: [number, number, number], radiusPx = 4, tolerance = 0.25): Promise<boolean> {
  return page.evaluate(
    ({ at, color, radiusPx, tolerance }) => {
      const canvas = document.querySelector("canvas") as HTMLCanvasElement;
      const rect = canvas.getBoundingClientRect();
      const ratio = canvas.width / rect.width;
      const cx = Math.round((at.x - rect.left) * ratio);
      const cy = Math.round((at.y - rect.top) * ratio);
      const r = Math.round(radiusPx * ratio);
      const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
      const data = ctx.getImageData(Math.max(0, cx - r), Math.max(0, cy - r), 2 * r + 1, 2 * r + 1).data;
      const targetMax = Math.max(...color);
      const target = color.map((c) => c / targetMax);
      for (let i = 0; i < data.length; i += 4) {
        const max = Math.max(data[i], data[i + 1], data[i + 2]);
        if (max < 90) continue;
        if (
          Math.abs(data[i] / max - target[0]) <= tolerance &&
          Math.abs(data[i + 1] / max - target[1]) <= tolerance &&
          Math.abs(data[i + 2] / max - target[2]) <= tolerance
        ) {
          return true;
        }
      }
      return false;
    },
    { at, color, radiusPx, tolerance },
  );
}

/** キャンバス全体で、黒以外の画素がいくつあるか */
export async function countNonBlackPixels(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector("canvas") as HTMLCanvasElement;
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] + data[i + 1] + data[i + 2] > 30) count++;
    return count;
  });
}

export const propertyPanel = (page: Page) => page.locator(".property-panel");
export const measurementPanel = (page: Page) => page.locator(".measurement-panel");
