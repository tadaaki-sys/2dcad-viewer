// 回帰テスト用の見本DXF。実図面は使わず、座標・レイヤーとも架空の値で組み立てる(コミットしてよい)。
// 図面の単位はmm。E2Eテスト(e2e/)からも同じ図面を読み込む。

export type LayerDef = { name: string; color: number; flags?: number; lineType?: string };
export type DxfParts = {
  header?: string[];
  layers?: LayerDef[];
  lineTypes?: boolean;
  blocks?: string[][];
  entities: string[][];
};

const s = (n: number) => String(n);

export function dxfDocument(parts: DxfParts): string {
  const lines: string[] = [];
  if (parts.header?.length) lines.push("0", "SECTION", "2", "HEADER", ...parts.header, "0", "ENDSEC");

  lines.push("0", "SECTION", "2", "TABLES");
  if (parts.lineTypes) {
    lines.push(
      "0", "TABLE", "2", "LTYPE", "70", "2",
      "0", "LTYPE", "2", "CONTINUOUS", "70", "0", "3", "Solid line", "72", "65", "73", "0", "40", "0",
      "0", "LTYPE", "2", "DASHED", "70", "0", "3", "Dashed", "72", "65", "73", "2", "40", "30", "49", "20", "49", "-10",
      "0", "ENDTAB",
    );
  }
  if (parts.layers?.length) {
    lines.push("0", "TABLE", "2", "LAYER", "70", s(parts.layers.length));
    for (const layer of parts.layers) {
      lines.push("0", "LAYER", "2", layer.name, "70", s(layer.flags ?? 0), "62", s(layer.color), "6", layer.lineType ?? "CONTINUOUS");
    }
    lines.push("0", "ENDTAB");
  }
  lines.push("0", "ENDSEC");

  if (parts.blocks?.length) {
    lines.push("0", "SECTION", "2", "BLOCKS");
    for (const block of parts.blocks) lines.push(...block);
    lines.push("0", "ENDSEC");
  }

  lines.push("0", "SECTION", "2", "ENTITIES");
  for (const entity of parts.entities) lines.push(...entity);
  lines.push("0", "ENDSEC", "0", "EOF");
  return lines.join("\n");
}

export function block(name: string, entities: string[][]): string[] {
  return [
    "0", "BLOCK", "8", "0", "2", name, "70", "0", "10", "0", "20", "0", "30", "0",
    ...entities.flat(),
    "0", "ENDBLK", "8", "0",
  ];
}

export const line = (layer: string, x0: number, y0: number, x1: number, y1: number, extra: string[] = []): string[] => [
  "0", "LINE", "8", layer, ...extra, "10", s(x0), "20", s(y0), "11", s(x1), "21", s(y1),
];

export const circle = (layer: string, x: number, y: number, r: number): string[] => [
  "0", "CIRCLE", "8", layer, "10", s(x), "20", s(y), "40", s(r),
];

export const arc = (layer: string, x: number, y: number, r: number, startDeg: number, endDeg: number): string[] => [
  "0", "ARC", "8", layer, "10", s(x), "20", s(y), "40", s(r), "50", s(startDeg), "51", s(endDeg),
];

/** pointsの各要素は[x, y]または[x, y, bulge]。bulgeはその頂点から次の頂点への円弧 */
export const lwpolyline = (layer: string, points: Array<[number, number, number?]>, closed: boolean): string[] => [
  "0", "LWPOLYLINE", "8", layer, "90", s(points.length), "70", closed ? "1" : "0",
  ...points.flatMap(([x, y, bulge]) => ["10", s(x), "20", s(y), ...(bulge ? ["42", s(bulge)] : [])]),
];

export const ellipse = (layer: string, x: number, y: number, majorX: number, majorY: number, ratio: number): string[] => [
  "0", "ELLIPSE", "8", layer, "10", s(x), "20", s(y), "11", s(majorX), "21", s(majorY), "40", s(ratio),
];

export const text = (layer: string, x: number, y: number, height: number, value: string, extra: string[] = []): string[] => [
  "0", "TEXT", "8", layer, "10", s(x), "20", s(y), "40", s(height), "1", value, ...extra,
];

export const mtext = (layer: string, x: number, y: number, height: number, value: string): string[] => [
  "0", "MTEXT", "8", layer, "10", s(x), "20", s(y), "40", s(height), "71", "1", "1", value,
];

export const point = (layer: string, x: number, y: number): string[] => ["0", "POINT", "8", layer, "10", s(x), "20", s(y), "30", "0"];

/** 2次ベジェ(制御点3、クランプノット) */
export const spline = (layer: string, p0: [number, number], p1: [number, number], p2: [number, number]): string[] => [
  "0", "SPLINE", "8", layer, "70", "8", "71", "2", "72", "6", "73", "3",
  "40", "0", "40", "0", "40", "0", "40", "1", "40", "1", "40", "1",
  "10", s(p0[0]), "20", s(p0[1]), "10", s(p1[0]), "20", s(p1[1]), "10", s(p2[0]), "20", s(p2[1]),
];

export type InsertOptions = { sx?: number; sy?: number; rotation?: number; cols?: number; rows?: number; dx?: number; dy?: number };

export const insert = (layer: string, name: string, x: number, y: number, o: InsertOptions = {}): string[] => [
  "0", "INSERT", "8", layer, "2", name, "10", s(x), "20", s(y),
  ...(o.sx !== undefined ? ["41", s(o.sx)] : []),
  ...(o.sy !== undefined ? ["42", s(o.sy)] : []),
  ...(o.rotation !== undefined ? ["50", s(o.rotation)] : []),
  ...(o.cols !== undefined ? ["70", s(o.cols)] : []),
  ...(o.rows !== undefined ? ["71", s(o.rows)] : []),
  ...(o.dx !== undefined ? ["44", s(o.dx)] : []),
  ...(o.dy !== undefined ? ["45", s(o.dy)] : []),
];

export const dimension = (layer: string, blockName: string): string[] => [
  "0", "DIMENSION", "8", layer, "2", blockName, "70", "0", "10", "0", "20", "0", "11", "500", "21", "20",
];

// ---------------------------------------------------------------------------------------------
// 見本図面
// ---------------------------------------------------------------------------------------------

/**
 * 工場レイアウト風の総合見本(1000 x 600 mm)。E2Eの操作位置もこの座標を前提にしている。
 * 外枠WALL、設備MACHINE(円・円弧・楕円)、ブロックUNIT(通常・鏡像・配列)、注記NOTE、点、
 * 破線・太線、スプライン、ポリラインの円弧(bulge)、寸法、OFF/フリーズのレイヤーを含む。
 */
export function factoryLayoutDxf(): string {
  return dxfDocument({
    header: ["9", "$PDMODE", "70", "35", "9", "$PDSIZE", "40", "20"],
    lineTypes: true,
    layers: [
      { name: "0", color: 7 },
      { name: "WALL", color: 1 },
      { name: "MACHINE", color: 3 },
      { name: "NOTE", color: 2 },
      { name: "DIM", color: 4 },
      { name: "GUIDE", color: 5, lineType: "DASHED" },
      { name: "HIDDEN_OFF", color: -6 },
      { name: "FROZEN", color: 6, flags: 1 },
    ],
    blocks: [
      block("UNIT", [line("0", 0, 0, 100, 0), circle("0", 50, 50, 20)]),
      block("*D1", [line("DIM", 0, 0, 500, 0, ["62", "0"]), mtext("DIM", 250, 10, 20, "500")]),
    ],
    entities: [
      lwpolyline("WALL", [[0, 0], [1000, 0], [1000, 600], [0, 600]], true),
      circle("MACHINE", 300, 300, 100),
      arc("MACHINE", 700, 300, 100, 0, 180),
      ellipse("MACHINE", 500, 150, 80, 0, 0.5),
      line("MACHINE", 100, 100, 500, 100, ["370", "50"]),
      line("GUIDE", 0, 450, 1000, 450),
      lwpolyline("MACHINE", [[150, 520, 0.5], [350, 520]], false),
      spline("MACHINE", [600, 450], [700, 550], [800, 450]),
      text("NOTE", 100, 560, 30, "REGRESSION"),
      mtext("NOTE", 450, 580, 20, "MTEXT note"),
      point("MACHINE", 500, 500),
      insert("MACHINE", "UNIT", 800, 450),
      insert("MACHINE", "UNIT", 950, 450, { sx: -1 }),
      insert("MACHINE", "UNIT", 700, 100, { cols: 2, rows: 2, dx: 120, dy: 80 }),
      dimension("DIM", "*D1"),
      line("HIDDEN_OFF", 0, 700, 1000, 700),
      line("FROZEN", 0, 800, 1000, 800),
    ],
  });
}

/** 最小の図面(線1本)。読み込みの基本確認用 */
export function smallDxf(): string {
  return dxfDocument({ layers: [{ name: "0", color: 7 }], entities: [line("0", 0, 0, 100, 50)] });
}

/** 未対応の図形(SOLID)を含む図面。未対応の件数が数えられ、ほかの図形は表示されること */
export function unsupportedDxf(): string {
  return dxfDocument({
    layers: [{ name: "0", color: 7 }],
    entities: [line("0", 0, 0, 100, 0), ["0", "SOLID", "8", "0", "10", "0", "20", "0", "11", "10", "21", "0", "12", "10", "22", "10", "13", "0", "23", "10"]],
  });
}

/** ブロックが深く入れ子になった図面(深さ n)。展開の深さ上限で消えないこと */
export function nestedBlocksDxf(depth: number): string {
  const blocks: string[][] = [block("B0", [line("0", 0, 0, 10, 0)])];
  for (let i = 1; i <= depth; i++) blocks.push(block(`B${i}`, [insert("0", `B${i - 1}`, 1, 0)]));
  return dxfDocument({ layers: [{ name: "0", color: 7 }], blocks, entities: [insert("0", `B${depth}`, 0, 0)] });
}
