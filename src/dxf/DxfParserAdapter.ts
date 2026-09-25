import DxfParser from "dxf-parser";
import type { IDxf, IEntity } from "dxf-parser";
import type { ILineEntity } from "dxf-parser";
import type { ILwpolylineEntity } from "dxf-parser";
import type { IPolylineEntity } from "dxf-parser";
import type { CadBounds, CadEntity, CadLayer, CadModel, Point2D } from "../types/cad";

const DEFAULT_COLOR = "#ffffff";

export function parseDxfText(text: string): CadModel {
  const parser = new DxfParser();
  const raw = parser.parseSync(text);
  if (!raw) {
    throw new Error("DXFの解析結果が空です");
  }
  return convertToCadModel(raw);
}

export function convertToCadModel(raw: IDxf): CadModel {
  const layerColorByName = buildLayerColorMap(raw);

  const modelSpaceEntities = (raw.entities ?? []).filter((entity) => !entity.inPaperSpace);

  const entities: CadEntity[] = [];
  const unsupportedBreakdown: Record<string, number> = {};
  const usedLayerNames = new Set<string>();
  let nextId = 0;

  for (const entity of modelSpaceEntities) {
    const converted = convertEntity(entity, layerColorByName, () => `e${nextId++}`);
    if (converted) {
      entities.push(converted);
      usedLayerNames.add(converted.layer);
    } else {
      const type = entity.type ?? "UNKNOWN";
      unsupportedBreakdown[type] = (unsupportedBreakdown[type] ?? 0) + 1;
    }
  }

  const layers = buildLayers(raw, layerColorByName, usedLayerNames);

  const totalEntityCount = modelSpaceEntities.length;
  const supportedEntityCount = entities.length;
  const unsupportedEntityCount = totalEntityCount - supportedEntityCount;

  return {
    entities,
    layers,
    bounds: computeBounds(entities),
    stats: { totalEntityCount, supportedEntityCount, unsupportedEntityCount, unsupportedBreakdown },
  };
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

function resolveEntityColor(entity: IEntity, layerColorByName: Map<string, string>): string {
  const colorIndex = entity.colorIndex;
  const isExplicitColor = colorIndex !== undefined && colorIndex !== 0 && colorIndex !== 256;
  if (isExplicitColor && entity.color !== undefined) {
    return toHexColor(entity.color);
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
  nextId: () => string,
): CadEntity | null {
  const layer = entity.layer ?? "0";
  const color = resolveEntityColor(entity, layerColorByName);

  if (entity.type === "LINE") {
    const line = entity as ILineEntity;
    const [start, end] = line.vertices ?? [];
    if (!start || !end) return null;
    return {
      id: nextId(),
      type: "LINE",
      layer,
      color,
      start: toPoint2D(start),
      end: toPoint2D(end),
    };
  }

  if (entity.type === "LWPOLYLINE" || entity.type === "POLYLINE") {
    const poly = entity as ILwpolylineEntity | IPolylineEntity;
    const vertices = (poly.vertices ?? []).map(toPoint2D);
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
