export type Point2D = {
  x: number;
  y: number;
};

export type DocumentInfo = {
  fileName: string;
  fileSizeBytes: number;
};

export type CadLayer = {
  name: string;
  color: string;
  visible: boolean;
};

export type CadLine = {
  id: string;
  type: "LINE";
  layer: string;
  color: string;
  start: Point2D;
  end: Point2D;
};

export type CadPolyline = {
  id: string;
  type: "LWPOLYLINE" | "POLYLINE";
  layer: string;
  color: string;
  vertices: Point2D[];
  closed: boolean;
};

export type CadCircle = {
  id: string;
  type: "CIRCLE";
  layer: string;
  color: string;
  center: Point2D;
  radius: number;
};

/** startAngle/endAngleはラジアン、+X軸からCCW方向(DXFの角度系と同じ数学的な向き) */
export type CadArc = {
  id: string;
  type: "ARC";
  layer: string;
  color: string;
  center: Point2D;
  radius: number;
  startAngle: number;
  endAngle: number;
};

export type CadHorizontalAlign = "left" | "center" | "right";
export type CadVerticalAlign = "top" | "middle" | "bottom" | "baseline";

/** rotationはラジアン、+X軸からCCW方向(DXFの角度系と同じ数学的な向き)。textは複数行の場合\nを含む */
export type CadText = {
  id: string;
  type: "TEXT";
  layer: string;
  color: string;
  position: Point2D;
  text: string;
  height: number;
  rotation: number;
  horizontalAlign: CadHorizontalAlign;
  verticalAlign: CadVerticalAlign;
};

/**
 * rotationはメジャー軸の向き(ラジアン、+X軸からCCW方向)。
 * startParam/endParamはDXFの楕円パラメータ角(ラジアン)で、非全周の場合は楕円弧になる。
 */
export type CadEllipse = {
  id: string;
  type: "ELLIPSE";
  layer: string;
  color: string;
  center: Point2D;
  majorRadius: number;
  minorRadius: number;
  rotation: number;
  startParam: number;
  endParam: number;
};

/** pointsはスプライン曲線を折れ線に近似した点列(変換行列適用済みのワールド座標) */
export type CadSpline = {
  id: string;
  type: "SPLINE";
  layer: string;
  color: string;
  points: Point2D[];
  closed: boolean;
};

export type CadEntity = CadLine | CadPolyline | CadCircle | CadArc | CadText | CadEllipse | CadSpline;

export type CadBounds = {
  min: Point2D;
  max: Point2D;
};

export type CadModelStats = {
  totalEntityCount: number;
  supportedEntityCount: number;
  unsupportedEntityCount: number;
  unsupportedBreakdown: Record<string, number>;
};

export type CadModel = {
  entities: CadEntity[];
  /** entities[i]のバウンディングボックス [minX,minY,maxX,maxY] を4要素ずつ並べたもの(選択・描画の絞り込み用) */
  entityBounds: Float64Array;
  layers: CadLayer[];
  bounds: CadBounds | null;
  stats: CadModelStats;
};

export type Measurement = {
  id: string;
  pointA: Point2D;
  pointB: Point2D;
};
