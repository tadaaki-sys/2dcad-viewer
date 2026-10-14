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
import type {
  CadEntity,
  CadHorizontalAlign,
  LineDash,
  CadLayer,
  CadModel,
  CadPointStyle,
  CadVerticalAlign,
  Point2D,
} from "../types/cad";
import { applyMatrix, buildInsertMatrix, IDENTITY_MATRIX, multiplyMatrices } from "../utils/matrix2d";
import type { Matrix2D } from "../utils/matrix2d";
import { computeAllEntityBounds, unionOfEntityBounds } from "../cad-view/spatial/entityBounds";
import { stripMtextFormatting } from "./mtextFormatting";
import { extractLayerStyles } from "./layerStyles";
import type { LayerStyle } from "./layerStyles";
import { normalizeDashPattern } from "../utils/lineDash";
import { THIN_LINE_WEIGHT_LIMIT } from "../utils/lineWeight";
import { tessellateSpline } from "../utils/spline";
import { ellipseFromConjugateDiameters, isReflection, isSimilarityTransform, linearBasis } from "../utils/ellipseTransform";
import { expandBulges } from "../utils/polylineBulge";

const DEFAULT_COLOR = "#ffffff";
const DEFAULT_TEXT_HEIGHT = 2.5;
// 循環参照はvisitedBlockNamesで別途検出するので、これは再帰が異常に深くなる場合だけの安全装置。
// 実際のCAD図面では、グループ化の入れ子で10〜20段になることがあり、低い上限だと配下の図形が丸ごと消える。
const MAX_INSERT_DEPTH = 64;
// 配列複写(MINSERT)1つあたりの複写数の上限と、展開後の図形総数の上限(壊れた/悪意あるファイルでメモリを使い切らないための安全装置)
const MAX_ARRAY_INSTANCES = 100_000;
const MAX_EXPANDED_ENTITIES = 3_000_000;

const MIN_WIDTH_FACTOR = 0.05;
const MAX_WIDTH_FACTOR = 10;

/** TEXTの幅係数(グループコード41)。未指定・0以下・非数は1(等幅)として扱う */
function sanitizeWidthFactor(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return 1;
  return Math.min(MAX_WIDTH_FACTOR, Math.max(MIN_WIDTH_FACTOR, value));
}

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
  // 1〜9の整数以外(未指定・小数・範囲外・非数)は左上として扱う
  const valid = attachmentPoint !== undefined && Number.isInteger(attachmentPoint) && attachmentPoint >= 1 && attachmentPoint <= 9;
  const index = (valid ? attachmentPoint : 1) - 1;
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
  return convertToCadModel(raw, { layerStyles: extractLayerStyles(text) });
}

export type ConvertOptions = {
  /** レイヤー名→線種・線の太さ。dxf-parserが読まないLAYERテーブルの値を、ByLayer解決用に渡す */
  layerStyles?: ReadonlyMap<string, LayerStyle>;
  /**
   * レイヤーのOFF(色番号が負)を無視する。DWGをLibreDWGで変換したDXFは、実際にはONのレイヤーまで
   * 一律に負で出力するため当てにならない。フリーズ(状態フラグ)は読む。
   */
  ignoreLayerOffFlag?: boolean;
};

/** ByBlockで指定された属性が継承する、直近のINSERT側で解決済みの値 */
type ByBlockStyle = {
  color: string | null;
  lineType: string | null;
  lineWeight: number | null;
  /** 直近のINSERTの有効なレイヤー。ブロック内のレイヤー"0"の図形はこのレイヤーを継承する(DXF/AutoCADの仕様) */
  layer: string | null;
};

const NO_BYBLOCK_STYLE: ByBlockStyle = { color: null, lineType: null, lineWeight: null, layer: null };

type ConversionContext = {
  raw: IDxf;
  layerColorByName: Map<string, string>;
  layerStyleByName: ReadonlyMap<string, LayerStyle>;
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
    layerStyleByName: options.layerStyles ?? new Map(),
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

  const layers = buildLayers(raw, layerColorByName, context.usedLayerNames, context.layerStyleByName, options.ignoreLayerOffFlag === true);
  const supportedEntityCount = context.entities.length;
  const unsupportedEntityCount = context.totalEntityCount - supportedEntityCount;

  const entityBounds = computeAllEntityBounds(context.entities);

  return {
    entities: context.entities,
    entityBounds,
    layers,
    pointStyle: readPointStyle(raw),
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
  for (const rawEntity of entities) {
    // グループコード60(非表示)が立っている図形は描かない
    if (rawEntity.visible === false) continue;
    if (context.totalEntityCount > MAX_EXPANDED_ENTITIES) {
      throw new Error(`ブロックの展開後の図形数が上限(${MAX_EXPANDED_ENTITIES.toLocaleString()}個)を超えました。図面が壊れているか、非常に大きすぎる可能性があります。`);
    }
    // ブロック内のレイヤー"0"は、そのブロックを挿入したINSERTのレイヤーになる
    const entity = byBlock.layer !== null && rawEntity.layer === "0" ? { ...rawEntity, layer: byBlock.layer } : rawEntity;

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
      if (converted.type !== "TEXT" && converted.type !== "POINT") {
        const lineTypeName = resolveLineTypeName(entity, context.layerStyleByName, byBlock.lineType);
        const dash = resolveLineDash(lineTypeName, entity.lineTypeScale, context);
        if (dash) converted.lineDash = dash;
        const weight = resolveLineWeight(entity, context.layerStyleByName, byBlock.lineWeight);
        if (weight !== null && weight > THIN_LINE_WEIGHT_LIMIT) converted.lineWeight = weight;
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
    lineweight: dimension.lineweight,
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
    lineType: resolveLineTypeName(insert, context.layerStyleByName, parentByBlock.lineType),
    lineWeight: resolveLineWeight(insert, context.layerStyleByName, parentByBlock.lineWeight),
    layer: insert.layer ?? parentByBlock.layer,
  };
  const rotationRadians = finiteOr(insert.rotation, 0) * Math.PI / 180;
  const scaleX = finiteOr(insert.xScale, 1);
  const scaleY = finiteOr(insert.yScale, 1);
  const insertPosition = insert.position ? toPoint2D(insert.position) : { x: 0, y: 0 };
  const blockBasePoint = block.position ? toPoint2D(block.position) : { x: 0, y: 0 };
  const columnCount = positiveInteger(insert.columnCount);
  const rowCount = positiveInteger(insert.rowCount);
  const columnSpacing = finiteOr(insert.columnSpacing, 0);
  const rowSpacing = finiteOr(insert.rowSpacing, 0);
  if (columnCount * rowCount > MAX_ARRAY_INSTANCES) {
    context.totalEntityCount++;
    context.unsupportedBreakdown.INSERT = (context.unsupportedBreakdown.INSERT ?? 0) + 1;
    return;
  }
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

/** 図面を開いた時点でそのレイヤーを非表示にするか。レイヤー表に無い(図形だけが参照している)レイヤーは表示する */
function isLayerHidden(style: LayerStyle | undefined, ignoreLayerOffFlag: boolean): boolean {
  if (!style) return false;
  return style.frozen || (style.off && !ignoreLayerOffFlag);
}

/** 点の表示設定($PDMODE/$PDSIZE)。未指定・不正値は、CADの既定(点・サイズ0)にする */
function readPointStyle(raw: IDxf): CadPointStyle {
  const mode = raw.header?.["$PDMODE"];
  const size = raw.header?.["$PDSIZE"];
  return {
    mode: typeof mode === "number" && Number.isFinite(mode) ? Math.trunc(mode) : 0,
    size: typeof size === "number" && Number.isFinite(size) ? size : 0,
  };
}

/**
 * 図形の線種名を解決する。ByLayer(または未指定)ならレイヤーの線種、
 * ByBlockなら属するINSERT側で解決された線種(byBlockLineType)を使う。
 */
function resolveLineTypeName(
  entity: IEntity,
  layerStyleByName: ReadonlyMap<string, LayerStyle>,
  byBlockLineType: string | null,
): string | null {
  const own = entity.lineType?.trim();
  const upper = own?.toUpperCase();
  if (!own || upper === "BYLAYER") return layerStyleByName.get(entity.layer)?.lineType ?? null;
  if (upper === "BYBLOCK") return byBlockLineType;
  return own;
}

// DXFのグループコード370の特殊値(dxf-parserのコメントは-1/-2の意味が逆だが、DXF仕様はこちら)
const LINEWEIGHT_BY_BLOCK = -2;
const LINEWEIGHT_DEFAULT = -3;

/**
 * 図形の線の太さ(1/100mm)を解決する。数値の指定が最優先、ByBlockは属するINSERT側、
 * 未指定とByLayerはレイヤーの値を使う。既定値(-3)や解決できない場合はnull(細線扱い)。
 */
function resolveLineWeight(
  entity: IEntity,
  layerStyleByName: ReadonlyMap<string, LayerStyle>,
  byBlockLineWeight: number | null,
): number | null {
  const own = entity.lineweight;
  if (own !== undefined && own >= 0) return own;
  if (own === LINEWEIGHT_BY_BLOCK) return byBlockLineWeight;
  if (own === LINEWEIGHT_DEFAULT) return null;

  const layerWeight = layerStyleByName.get(entity.layer)?.lineWeight;
  return layerWeight !== undefined && layerWeight !== null && layerWeight >= 0 ? layerWeight : null;
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

function buildLayers(
  raw: IDxf,
  layerColorByName: Map<string, string>,
  usedLayerNames: Set<string>,
  layerStyleByName: ReadonlyMap<string, LayerStyle>,
  ignoreLayerOffFlag: boolean,
): CadLayer[] {
  const rawLayerNames = Object.keys(raw.tables?.layer?.layers ?? {});
  const allLayerNames = new Set([...rawLayerNames, ...usedLayerNames]);

  const layers: CadLayer[] = Array.from(allLayerNames).map((name) => ({
    name,
    color: layerColorByName.get(name) ?? DEFAULT_COLOR,
    // 図面を開いた時点で、CADでOFF・フリーズされているレイヤーは非表示にしておく(レイヤー一覧のチェックで表示できる)
    visible: !isLayerHidden(layerStyleByName.get(name), ignoreLayerOffFlag),
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
  // 色番号に対応するRGBが無い場合(番号が無い/256=ByLayer)にentity.colorがあれば、それはtrue color(420)。
  // ByBlock(0)はdxf-parserが仮の値0を入れるので、0以外ならtrue colorとみなす。
  const isExplicitColor =
    colorIndex === undefined ||
    (colorIndex === 256 && entity.color !== undefined) ||
    (colorIndex === 0 && entity.color !== undefined && entity.color !== 0) ||
    (colorIndex !== 0 && colorIndex !== 256);
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

function finiteOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}

/** 配列複写の行数/列数。未指定・非数・0以下は1、小数は切り捨て */
function positiveInteger(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value >= 1 ? Math.floor(value) : 1;
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
    const rawVertices = poly.vertices ?? [];
    if (rawVertices.length < 2) return null;
    const closed = Boolean(poly.shape);
    // 円弧区間(bulge)は、行列を掛ける前のローカル座標で折れ線へ展開する
    const vertices = expandBulges(rawVertices, closed).map((point) => applyMatrix(point, matrix));
    return {
      id: nextId(),
      type: entity.type,
      layer,
      color,
      vertices,
      closed,
    };
  }

  if (entity.type === "CIRCLE" || entity.type === "ARC") {
    const shape = entity as ICircleEntity | IArcEntity;
    if (!shape.center || !Number.isFinite(shape.radius)) return null;

    if (!(shape.radius > 0)) return null;
    const center = applyMatrix(toPoint2D(shape.center), matrix);
    const arc = entity as IArcEntity;
    const startAngle = entity.type === "ARC" ? arc.startAngle : 0;
    const endAngle = entity.type === "ARC" ? arc.endAngle : Math.PI * 2;

    if (!isSimilarityTransform(matrix)) {
      // 非一様拡大縮小・せん断を受けた円/弧は楕円(弧)になる。共役半径から厳密な楕円へ直す
      const { lx, ly } = linearBasis(matrix);
      const ellipse = ellipseFromConjugateDiameters(
        { x: shape.radius * lx.x, y: shape.radius * lx.y },
        { x: shape.radius * ly.x, y: shape.radius * ly.y },
        startAngle,
        endAngle,
      );
      if (!ellipse) return null;
      return { id: nextId(), type: "ELLIPSE", layer, color, center, ...ellipse };
    }

    // 相似変換の倍率は基底ベクトルの長さ。行列式の平方根だと、極端に大きな縮尺でオーバーフローする
    const radius = shape.radius * Math.hypot(matrix.a, matrix.b);
    if (!(radius > 0) || !Number.isFinite(radius) || !Number.isFinite(center.x + center.y)) return null;
    if (entity.type === "CIRCLE") {
      return { id: nextId(), type: "CIRCLE", layer, color, center, radius };
    }

    // 角度そのものではなく方向ベクトルを変換する(鏡像では角度の足し算では合わず、向きも逆になる)
    const directionAngle = (angle: number) => {
      const v = transformVector({ x: Math.cos(angle), y: Math.sin(angle) }, matrix);
      return Math.atan2(v.y, v.x);
    };
    const mappedStart = directionAngle(startAngle);
    const mappedEnd = directionAngle(endAngle);
    const mirrored = isReflection(matrix);
    return {
      id: nextId(),
      type: "ARC",
      layer,
      color,
      center,
      radius,
      startAngle: mirrored ? mappedEnd : mappedStart,
      endAngle: mirrored ? mappedStart : mappedEnd,
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
      widthFactor: sanitizeWidthFactor(text.xScale),
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
    // majorAxisEndPoint(11,21)は中心からの相対ベクトルなので、平行移動を含まない線形変換のみを適用する。
    // メジャー軸とマイナー軸(メジャー軸を90度回転してaxisRatio倍)を変換したものは共役半径になり、
    // 非一様拡大縮小・せん断・鏡像の後でも厳密な楕円(弧)の標準形へ直せる。
    const majorVector = transformVector(toPoint2D(ellipse.majorAxisEndPoint), matrix);
    const minorVector = transformVector(
      { x: -ellipse.majorAxisEndPoint.y * ellipse.axisRatio, y: ellipse.majorAxisEndPoint.x * ellipse.axisRatio },
      matrix,
    );
    const params = ellipseFromConjugateDiameters(majorVector, minorVector, ellipse.startAngle ?? 0, ellipse.endAngle ?? Math.PI * 2);
    if (!params) return null;

    return { id: nextId(), type: "ELLIPSE", layer, color, center, ...params };
  }

  if (entity.type === "POINT") {
    const point = entity as IEntity & { position?: { x: number; y: number } };
    if (!point.position) return null;
    const position = applyMatrix(toPoint2D(point.position), matrix);
    if (!Number.isFinite(position.x + position.y)) return null;
    return { id: nextId(), type: "POINT", layer, color, position };
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
