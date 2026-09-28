import DxfParser from "dxf-parser";
import type { IBlock, IDxf, IEntity, IInsertEntity } from "dxf-parser";
import type { ILineEntity } from "dxf-parser";
import type { ILwpolylineEntity } from "dxf-parser";
import type { IPolylineEntity } from "dxf-parser";
import type { CadBounds, CadEntity, CadLayer, CadModel, Point2D } from "../types/cad";
import { applyMatrix, buildInsertMatrix, IDENTITY_MATRIX, multiplyMatrices } from "../utils/matrix2d";
import type { Matrix2D } from "../utils/matrix2d";

const DEFAULT_COLOR = "#ffffff";
// ブロックが自分自身(直接/間接)を参照する循環定義に対する安全装置。通常のDXFでは数段でネストが終わる。
const MAX_INSERT_DEPTH = 12;

export function parseDxfText(text: string): CadModel {
  const parser = new DxfParser();
  const raw = parser.parseSync(text);
  if (!raw) {
    throw new Error("DXFの解析結果が空です");
  }
  return convertToCadModel(raw);
}

type ConversionContext = {
  raw: IDxf;
  layerColorByName: Map<string, string>;
  entities: CadEntity[];
  usedLayerNames: Set<string>;
  unsupportedBreakdown: Record<string, number>;
  totalEntityCount: number;
  nextId: number;
};

export function convertToCadModel(raw: IDxf): CadModel {
  const layerColorByName = buildLayerColorMap(raw);
  const modelSpaceEntities = (raw.entities ?? []).filter((entity) => !entity.inPaperSpace);

  const context: ConversionContext = {
    raw,
    layerColorByName,
    entities: [],
    usedLayerNames: new Set(),
    unsupportedBreakdown: {},
    totalEntityCount: 0,
    nextId: 0,
  };

  walkEntities(modelSpaceEntities, IDENTITY_MATRIX, null, new Set(), 0, context);

  const layers = buildLayers(raw, layerColorByName, context.usedLayerNames);
  const supportedEntityCount = context.entities.length;
  const unsupportedEntityCount = context.totalEntityCount - supportedEntityCount;

  return {
    entities: context.entities,
    layers,
    bounds: computeBounds(context.entities),
    stats: {
      totalEntityCount: context.totalEntityCount,
      supportedEntityCount,
      unsupportedEntityCount,
      unsupportedBreakdown: context.unsupportedBreakdown,
    },
  };
}

/**
 * Entity一覧を順に処理する。INSERTはBLOCK定義の中身をワールド座標へ変換して再帰的に展開し、
 * それ以外はそのまま変換する。matrixはこの呼び出し階層が乗っているローカル→ワールド変換。
 */
function walkEntities(
  entities: IEntity[],
  matrix: Matrix2D,
  byBlockColor: string | null,
  visitedBlockNames: ReadonlySet<string>,
  depth: number,
  context: ConversionContext,
): void {
  for (const entity of entities) {
    if (entity.type === "INSERT") {
      expandInsert(entity as IInsertEntity, matrix, byBlockColor, visitedBlockNames, depth, context);
      continue;
    }

    context.totalEntityCount++;
    const converted = convertEntity(entity, context.layerColorByName, matrix, byBlockColor, () => `e${context.nextId++}`);
    if (converted) {
      context.entities.push(converted);
      context.usedLayerNames.add(converted.layer);
    } else {
      const type = entity.type ?? "UNKNOWN";
      context.unsupportedBreakdown[type] = (context.unsupportedBreakdown[type] ?? 0) + 1;
    }
  }
}

function expandInsert(
  insert: IInsertEntity,
  parentMatrix: Matrix2D,
  parentByBlockColor: string | null,
  visitedBlockNames: ReadonlySet<string>,
  depth: number,
  context: ConversionContext,
): void {
  const block: IBlock | undefined = context.raw.blocks?.[insert.name];
  const isCyclic = block !== undefined && visitedBlockNames.has(insert.name);

  if (!block || depth >= MAX_INSERT_DEPTH || isCyclic) {
    // 参照先BLOCKが見つからない/循環参照/ネスト過多の場合も、件数としては無視せず未対応集計に残す
    context.totalEntityCount++;
    context.unsupportedBreakdown.INSERT = (context.unsupportedBreakdown.INSERT ?? 0) + 1;
    return;
  }

  const nextVisited = new Set(visitedBlockNames);
  nextVisited.add(insert.name);

  const insertColor = resolveEntityColor(insert, context.layerColorByName, parentByBlockColor);
  const rotationRadians = ((insert.rotation ?? 0) * Math.PI) / 180;
  const scaleX = insert.xScale ?? 1;
  const scaleY = insert.yScale ?? 1;
  const insertPosition = insert.position ? toPoint2D(insert.position) : { x: 0, y: 0 };
  const blockBasePoint = block.position ? toPoint2D(block.position) : { x: 0, y: 0 };
  const columnCount = insert.columnCount ?? 1;
  const rowCount = insert.rowCount ?? 1;
  const columnSpacing = insert.columnSpacing ?? 0;
  const rowSpacing = insert.rowSpacing ?? 0;
  const cos = Math.cos(rotationRadians);
  const sin = Math.sin(rotationRadians);

  for (let row = 0; row < rowCount; row++) {
    for (let col = 0; col < columnCount; col++) {
      // 配列複写(MINSERT)のオフセットは、挿入自身の回転方向に沿って加算する
      const dx = col * columnSpacing;
      const dy = row * rowSpacing;
      const copyPosition: Point2D = {
        x: insertPosition.x + cos * dx - sin * dy,
        y: insertPosition.y + sin * dx + cos * dy,
      };
      const localMatrix = buildInsertMatrix({
        insertPosition: copyPosition,
        rotationRadians,
        scaleX,
        scaleY,
        blockBasePoint,
      });
      const worldMatrix = multiplyMatrices(parentMatrix, localMatrix);
      walkEntities(block.entities ?? [], worldMatrix, insertColor, nextVisited, depth + 1, context);
    }
  }
}

function buildLayerColorMap(raw: IDxf): Map<string, string> {
  const map = new Map<string, string>();
  const rawLayers = raw.tables?.layer?.layers ?? {};
  for (const [name, layer] of Object.entries(rawLayers)) {
    map.set(name, layer.color !== undefined ? toHexColor(layer.color) : DEFAULT_COLOR);
  }
  return map;
}

function buildLayers(raw: IDxf, layerColorByName: Map<string, string>, usedLayerNames: Set<string>): CadLayer[] {
  const rawLayerNames = Object.keys(raw.tables?.layer?.layers ?? {});
  const allLayerNames = new Set([...rawLayerNames, ...usedLayerNames]);

  const layers: CadLayer[] = Array.from(allLayerNames).map((name) => ({
    name,
    color: layerColorByName.get(name) ?? DEFAULT_COLOR,
    visible: true,
  }));
  return layers.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Entity自身の色を解決する。colorIndex 0(ByBlock)の場合は、
 * それを含むINSERT側で解決された色(byBlockColor)を優先して使う。
 */
function resolveEntityColor(
  entity: IEntity,
  layerColorByName: Map<string, string>,
  byBlockColor: string | null = null,
): string {
  const colorIndex = entity.colorIndex;
  const isExplicitColor = colorIndex !== undefined && colorIndex !== 0 && colorIndex !== 256;
  if (isExplicitColor && entity.color !== undefined) {
    return toHexColor(entity.color);
  }
  if (colorIndex === 0 && byBlockColor) {
    return byBlockColor;
  }
  return layerColorByName.get(entity.layer) ?? DEFAULT_COLOR;
}

function toHexColor(decimalColor: number): string {
  const clamped = Math.max(0, Math.min(0xffffff, Math.round(decimalColor)));
  return `#${clamped.toString(16).padStart(6, "0")}`;
}

function toPoint2D(point: { x: number; y: number }): Point2D {
  return { x: point.x, y: point.y };
}

function convertEntity(
  entity: IEntity,
  layerColorByName: Map<string, string>,
  matrix: Matrix2D,
  byBlockColor: string | null,
  nextId: () => string,
): CadEntity | null {
  const layer = entity.layer ?? "0";
  const color = resolveEntityColor(entity, layerColorByName, byBlockColor);

  if (entity.type === "LINE") {
    const line = entity as ILineEntity;
    const [start, end] = line.vertices ?? [];
    if (!start || !end) return null;
    return {
      id: nextId(),
      type: "LINE",
      layer,
      color,
      start: applyMatrix(toPoint2D(start), matrix),
      end: applyMatrix(toPoint2D(end), matrix),
    };
  }

  if (entity.type === "LWPOLYLINE" || entity.type === "POLYLINE") {
    const poly = entity as ILwpolylineEntity | IPolylineEntity;
    const vertices = (poly.vertices ?? []).map((vertex) => applyMatrix(toPoint2D(vertex), matrix));
    if (vertices.length < 2) return null;
    return {
      id: nextId(),
      type: entity.type,
      layer,
      color,
      vertices,
      closed: Boolean(poly.shape),
    };
  }

  return null;
}

function computeBounds(entities: CadEntity[]): CadBounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let found = false;

  for (const entity of entities) {
    const points = entity.type === "LINE" ? [entity.start, entity.end] : entity.vertices;
    for (const point of points) {
      found = true;
      if (point.x < minX) minX = point.x;
      if (point.y < minY) minY = point.y;
      if (point.x > maxX) maxX = point.x;
      if (point.y > maxY) maxY = point.y;
    }
  }

  return found ? { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } } : null;
}
