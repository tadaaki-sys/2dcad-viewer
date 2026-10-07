import DxfParser from "dxf-parser";
import type { IBlock, IDxf, IEntity, IInsertEntity } from "dxf-parser";
import type { ILineEntity } from "dxf-parser";
import type { ILwpolylineEntity } from "dxf-parser";
import type { IPolylineEntity } from "dxf-parser";
import type { ICircleEntity } from "dxf-parser";
import type { IArcEntity } from "dxf-parser";
import type { ITextEntity } from "dxf-parser";
import type { IMtextEntity } from "dxf-parser";
import type { IEllipseEntity } from "dxf-parser";
import type { ISplineEntity } from "dxf-parser";
import type { CadEntity, CadHorizontalAlign, LineDash, CadLayer, CadModel, CadVerticalAlign, Point2D } from "../types/cad";
import { applyMatrix, buildInsertMatrix, IDENTITY_MATRIX, multiplyMatrices } from "../utils/matrix2d";
import type { Matrix2D } from "../utils/matrix2d";
import { computeAllEntityBounds, unionOfEntityBounds } from "../cad-view/spatial/entityBounds";
import { stripMtextFormatting } from "./mtextFormatting";
import { extractLayerLineTypes } from "./layerLineTypes";
import { normalizeDashPattern } from "../utils/lineDash";
import { tessellateSpline } from "../utils/spline";

const DEFAULT_COLOR = "#ffffff";
const DEFAULT_TEXT_HEIGHT = 2.5;
// 循環参照はvisitedBlockNamesで別途検出するので、これは再帰が異常に深くなる場合だけの安全装置。
// 実際のCAD図面では、グループ化の入れ子で10〜20段になることがあり、低い上限だと配下の図形が丸ごと消える。
const MAX_INSERT_DEPTH = 64;

function alignFromTextHalign(halign: number | undefined): CadHorizontalAlign {
  if (halign === 2) return "right";
  if (halign === 1 || halign === 3 || halign === 4 || halign === 5) return "center";
  return "left";
}

function alignFromTextValign(valign: number | undefined): CadVerticalAlign {
  if (valign === 1) return "bottom";
  if (valign === 2) return "middle";
  if (valign === 3) return "top";
  return "baseline";
}

const MTEXT_ATTACHMENT_HORIZONTAL: CadHorizontalAlign[] = ["left", "center", "right"];
const MTEXT_ATTACHMENT_VERTICAL: CadVerticalAlign[] = ["top", "middle", "bottom"];

/** MTEXTのattachmentPoint(1〜9、左上から右下へ3x3)を水平/垂直の配置に変換する */
function alignFromMtextAttachment(attachmentPoint: number | undefined): {
  horizontalAlign: CadHorizontalAlign;
  verticalAlign: CadVerticalAlign;
} {
  const index = Math.min(9, Math.max(1, attachmentPoint ?? 1)) - 1;
  return {
    horizontalAlign: MTEXT_ATTACHMENT_HORIZONTAL[index % 3],
    verticalAlign: MTEXT_ATTACHMENT_VERTICAL[Math.floor(index / 3)],
  };
}

export function parseDxfText(text: string): CadModel {
  const parser = new DxfParser();
  const raw = parser.parseSync(text);
  if (!raw) {
    throw new Error("DXFの解析結果が空です");
  }
  return convertToCadModel(raw, { layerLineTypes: extractLayerLineTypes(text) });
}

export type ConvertOptions = {
  /** レイヤー名→線種名。dxf-parserが読まないLAYERテーブルの線種を、ByLayer解決用に渡す */
  layerLineTypes?: ReadonlyMap<string, string>;
};

/** ByBlockで指定された属性が継承する、直近のINSERT側で解決済みの値 */
type ByBlockStyle = { color: string | null; lineType: string | null };

const NO_BYBLOCK_STYLE: ByBlockStyle = { color: null, lineType: null };

type ConversionContext = {
  raw: IDxf;
  layerColorByName: Map<string, string>;
  layerLineTypeByName: ReadonlyMap<string, string>;
  /** 線種名(大文字)→DXFのLTYPE要素列 */
  lineTypePatterns: Map<string, number[]>;
  ltScale: number;
  /** 線種名と尺度ごとの破線。同じものは同じオブジェクトを返す(nullは実線扱い) */
  dashCache: Map<string, LineDash | null>;
  entities: CadEntity[];
  usedLayerNames: Set<string>;
  unsupportedBreakdown: Record<string, number>;
  totalEntityCount: number;
  nextId: number;
};

export function convertToCadModel(raw: IDxf, options: ConvertOptions = {}): CadModel {
  const layerColorByName = buildLayerColorMap(raw);
  const modelSpaceEntities = (raw.entities ?? []).filter((entity) => !entity.inPaperSpace);

  const context: ConversionContext = {
    raw,
    layerColorByName,
    layerLineTypeByName: options.layerLineTypes ?? new Map(),
    lineTypePatterns: buildLineTypePatternMap(raw),
    ltScale: readLineTypeScale(raw),
    dashCache: new Map(),
    entities: [],
    usedLayerNames: new Set(),
    unsupportedBreakdown: {},
    totalEntityCount: 0,
    nextId: 0,
  };

  walkEntities(modelSpaceEntities, IDENTITY_MATRIX, NO_BYBLOCK_STYLE, new Set(), 0, context);

  const layers = buildLayers(raw, layerColorByName, context.usedLayerNames);
  const supportedEntityCount = context.entities.length;
  const unsupportedEntityCount = context.totalEntityCount - supportedEntityCount;

  const entityBounds = computeAllEntityBounds(context.entities);

  return {
    entities: context.entities,
    entityBounds,
    layers,
    bounds: unionOfEntityBounds(entityBounds),
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
  byBlock: ByBlockStyle,
  visitedBlockNames: ReadonlySet<string>,
  depth: number,
  context: ConversionContext,
): void {
  for (const entity of entities) {
    if (entity.type === "INSERT") {
      expandInsert(entity as IInsertEntity, matrix, byBlock, visitedBlockNames, depth, context);
      continue;
    }

    // DIMENSIONの寸法線・矢印・数値は、名前付きの匿名ブロック(*Dn)に描画済みの図形として入っている
    if (entity.type === "DIMENSION") {
      const blockName = (entity as IEntity & { block?: string }).block;
      if (blockName && context.raw.blocks?.[blockName]) {
        expandInsert(dimensionAsInsert(entity, blockName), matrix, byBlock, visitedBlockNames, depth, context);
        continue;
      }
    }

    context.totalEntityCount++;
    const converted = convertEntity(entity, context.layerColorByName, matrix, byBlock.color, () => `e${context.nextId++}`);
    if (converted) {
      if (converted.type !== "TEXT") {
        const lineTypeName = resolveLineTypeName(entity, context.layerLineTypeByName, byBlock.lineType);
        const dash = resolveLineDash(lineTypeName, entity.lineTypeScale, context);
        if (dash) converted.lineDash = dash;
      }
      context.entities.push(converted);
      context.usedLayerNames.add(converted.layer);
    } else {
      const type = entity.type ?? "UNKNOWN";
      context.unsupportedBreakdown[type] = (context.unsupportedBreakdown[type] ?? 0) + 1;
    }
  }
}

/** DIMENSIONを、その描画ブロックを原点・等倍・回転なしで挿入するINSERTとして扱う(色・線種のByBlockは寸法自身の指定を継承する) */
function dimensionAsInsert(dimension: IEntity, blockName: string): IInsertEntity {
  return {
    type: "INSERT",
    name: blockName,
    layer: dimension.layer,
    colorIndex: dimension.colorIndex,
    color: dimension.color,
    lineType: dimension.lineType,
    position: { x: 0, y: 0, z: 0 },
    xScale: 1,
    yScale: 1,
    zScale: 1,
    rotation: 0,
    columnCount: 1,
    rowCount: 1,
    columnSpacing: 0,
    rowSpacing: 0,
  } as unknown as IInsertEntity;
}

function expandInsert(
  insert: IInsertEntity,
  parentMatrix: Matrix2D,
  parentByBlock: ByBlockStyle,
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

  const insertByBlock: ByBlockStyle = {
    color: resolveEntityColor(insert, context.layerColorByName, parentByBlock.color),
    lineType: resolveLineTypeName(insert, context.layerLineTypeByName, parentByBlock.lineType),
  };
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
      walkEntities(block.entities ?? [], worldMatrix, insertByBlock, nextVisited, depth + 1, context);
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

function buildLineTypePatternMap(raw: IDxf): Map<string, number[]> {
  const map = new Map<string, number[]>();
  for (const [name, lineType] of Object.entries(raw.tables?.lineType?.lineTypes ?? {})) {
    // dxf-parserの型はstring[]だが、実際にはグループコード49の数値が入る
    if (lineType.pattern) map.set(name.toUpperCase(), lineType.pattern.map(Number));
  }
  return map;
}

/** $LTSCALE(全体の線種尺度)。未指定や不正値は1 */
function readLineTypeScale(raw: IDxf): number {
  const value = raw.header?.["$LTSCALE"];
  return typeof value === "number" && value > 0 && Number.isFinite(value) ? value : 1;
}

/**
 * 図形の線種名を解決する。ByLayer(または未指定)ならレイヤーの線種、
 * ByBlockなら属するINSERT側で解決された線種(byBlockLineType)を使う。
 */
function resolveLineTypeName(
  entity: IEntity,
  layerLineTypeByName: ReadonlyMap<string, string>,
  byBlockLineType: string | null,
): string | null {
  const own = entity.lineType?.trim();
  const upper = own?.toUpperCase();
  if (!own || upper === "BYLAYER") return layerLineTypeByName.get(entity.layer) ?? null;
  if (upper === "BYBLOCK") return byBlockLineType;
  return own;
}

/** 線種名から破線パターンを得る。実線・未定義の線種はundefined。AutoCAD同様、INSERTの拡大率には影響されない */
function resolveLineDash(name: string | null, entityScale: number | undefined, context: ConversionContext): LineDash | undefined {
  if (!name) return undefined;
  const upper = name.toUpperCase();
  if (upper === "CONTINUOUS") return undefined;

  const scale = context.ltScale * (entityScale !== undefined && entityScale > 0 ? entityScale : 1);
  const key = `${upper}@${scale}`;
  let dash = context.dashCache.get(key);
  if (dash === undefined) {
    const elements = context.lineTypePatterns.get(upper);
    const pattern = elements ? normalizeDashPattern(elements, scale) : null;
    dash = pattern ? { key, name, pattern } : null;
    context.dashCache.set(key, dash);
  }
  return dash ?? undefined;
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

/** ベクトル(向きと長さのみ)にmatrixの線形部分だけを適用する(平行移動は無視) */
function transformVector(v: Point2D, m: Matrix2D): Point2D {
  return { x: m.a * v.x + m.c * v.y, y: m.b * v.x + m.d * v.y };
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

  if (entity.type === "CIRCLE" || entity.type === "ARC") {
    const shape = entity as ICircleEntity | IArcEntity;
    if (!shape.center || !Number.isFinite(shape.radius)) return null;

    const center = applyMatrix(toPoint2D(shape.center), matrix);
    // 非一様スケール(X/Yで倍率が異なる)の場合、真円/真弧は表現できないため
    // 面積を保つ幾何平均を半径の近似スケールとして使う(ブロックが不均一縮尺で参照されるケースへの実用的な妥協)
    const scaleFactor = Math.sqrt(Math.abs(matrix.a * matrix.d - matrix.b * matrix.c));
    const radius = shape.radius * scaleFactor;
    if (!(radius > 0)) return null;

    if (entity.type === "CIRCLE") {
      return { id: nextId(), type: "CIRCLE", layer, color, center, radius };
    }

    const arc = entity as IArcEntity;
    const rotationOffset = Math.atan2(matrix.b, matrix.a);
    return {
      id: nextId(),
      type: "ARC",
      layer,
      color,
      center,
      radius,
      startAngle: arc.startAngle + rotationOffset,
      endAngle: arc.endAngle + rotationOffset,
    };
  }

  if (entity.type === "TEXT") {
    const text = entity as ITextEntity;
    if (!text.startPoint || !text.text) return null;

    const scaleFactor = Math.sqrt(Math.abs(matrix.a * matrix.d - matrix.b * matrix.c));
    const rotationOffset = Math.atan2(matrix.b, matrix.a);
    // 第2整列点(11,21)は水平/垂直の整列指定(72/73)が既定(0)以外の場合のみ意味を持つ(DXF仕様)
    const usesSecondPoint = (text.halign !== undefined && text.halign !== 0) || (text.valign !== undefined && text.valign !== 0);
    const rawPosition = usesSecondPoint && text.endPoint ? text.endPoint : text.startPoint;
    const height = (Number.isFinite(text.textHeight) && text.textHeight > 0 ? text.textHeight : DEFAULT_TEXT_HEIGHT) * scaleFactor;

    return {
      id: nextId(),
      type: "TEXT",
      layer,
      color,
      position: applyMatrix(toPoint2D(rawPosition), matrix),
      text: stripMtextFormatting(text.text),
      height,
      rotation: ((text.rotation ?? 0) * Math.PI) / 180 + rotationOffset,
      horizontalAlign: alignFromTextHalign(text.halign),
      verticalAlign: alignFromTextValign(text.valign),
    };
  }

  if (entity.type === "MTEXT") {
    const mtext = entity as IMtextEntity;
    if (!mtext.position || !mtext.text) return null;

    const scaleFactor = Math.sqrt(Math.abs(matrix.a * matrix.d - matrix.b * matrix.c));
    const rotationOffset = Math.atan2(matrix.b, matrix.a);
    // rotation(50)が無い場合、directionVector(11)から回転角を求める(DXF仕様上どちらか一方が使われる)
    const rotationDegrees =
      mtext.rotation ??
      (mtext.directionVector ? (Math.atan2(mtext.directionVector.y, mtext.directionVector.x) * 180) / Math.PI : 0);
    const height = (Number.isFinite(mtext.height) && mtext.height > 0 ? mtext.height : DEFAULT_TEXT_HEIGHT) * scaleFactor;
    const { horizontalAlign, verticalAlign } = alignFromMtextAttachment(mtext.attachmentPoint);

    return {
      id: nextId(),
      type: "TEXT",
      layer,
      color,
      position: applyMatrix(toPoint2D(mtext.position), matrix),
      text: stripMtextFormatting(mtext.text),
      height,
      rotation: (rotationDegrees * Math.PI) / 180 + rotationOffset,
      horizontalAlign,
      verticalAlign,
    };
  }

  if (entity.type === "ELLIPSE") {
    const ellipse = entity as IEllipseEntity;
    if (!ellipse.center || !ellipse.majorAxisEndPoint || !Number.isFinite(ellipse.axisRatio)) return null;

    const center = applyMatrix(toPoint2D(ellipse.center), matrix);
    // majorAxisEndPoint(11,21)は中心からの相対ベクトルなので、平行移動を含まない線形変換のみを適用する
    const majorVector = transformVector(toPoint2D(ellipse.majorAxisEndPoint), matrix);
    const majorRadius = Math.hypot(majorVector.x, majorVector.y);
    if (!(majorRadius > 0)) return null;

    // マイナー軸ベクトル(メジャー軸を90度回転してaxisRatio倍)も同様に線形変換する。
    // 非一様スケールの場合、変換後は厳密には直交しなくなるが(せん断)、実用上は近似として許容する。
    const localMinorVector: Point2D = {
      x: -ellipse.majorAxisEndPoint.y * ellipse.axisRatio,
      y: ellipse.majorAxisEndPoint.x * ellipse.axisRatio,
    };
    const minorVector = transformVector(localMinorVector, matrix);
    const minorRadius = Math.hypot(minorVector.x, minorVector.y);

    return {
      id: nextId(),
      type: "ELLIPSE",
      layer,
      color,
      center,
      majorRadius,
      minorRadius,
      rotation: Math.atan2(majorVector.y, majorVector.x),
      startParam: ellipse.startAngle ?? 0,
      endParam: ellipse.endAngle ?? Math.PI * 2,
    };
  }

  if (entity.type === "SPLINE") {
    const spline = entity as ISplineEntity;
    // 非有理B-スプラインはアフィン変換に対して不変なので、制御点/フィットポイントを先に変換してから評価してよい
    const transformAll = (points: Array<{ x: number; y: number }> | undefined) =>
      points?.map((point) => applyMatrix(toPoint2D(point), matrix));
    const points = tessellateSpline({
      controlPoints: transformAll(spline.controlPoints),
      fitPoints: transformAll(spline.fitPoints),
      knots: spline.knotValues,
      degree: spline.degreeOfSplineCurve,
    });
    if (!points) return null;
    return { id: nextId(), type: "SPLINE", layer, color, points, closed: Boolean(spline.closed) };
  }

  return null;
}
