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

/**
 * 線種の破線パターン。patternは[線,空き,線,空き,...]の偶数個で、長さはワールド座標系
 * ($LTSCALEと図形ごとの線種尺度を反映済み)。長さ0の「線」は点を表す。無ければ実線。
 * 同じ線種・尺度の図形は同じオブジェクトを共有する(keyが同じ)。
 */
export type LineDash = {
  key: string;
  name: string;
  pattern: number[];
};

export type CadLine = {
  id: string;
  type: "LINE";
  layer: string;
  color: string;
  lineDash?: LineDash;
  start: Point2D;
  end: Point2D;
};

export type CadPolyline = {
  id: string;
  type: "LWPOLYLINE" | "POLYLINE";
  layer: string;
  color: string;
  lineDash?: LineDash;
  vertices: Point2D[];
  closed: boolean;
};

export type CadCircle = {
  id: string;
  type: "CIRCLE";
  layer: string;
  color: string;
  lineDash?: LineDash;
  center: Point2D;
  radius: number;
};

/** startAngle/endAngleはラジアン、+X軸からCCW方向(DXFの角度系と同じ数学的な向き) */
export type CadArc = {
  id: string;
  type: "ARC";
  layer: string;
  color: string;
  lineDash?: LineDash;
  center: Point2D;
  radius: number;
  startAngle: number;
  endAngle: number;
};

export type CadHorizontalAlign = "left" | "center" | "right";
export type CadVerticalAlign = "top" | "middle" | "bottom" | "baseline";

/**
 * rotationはラジアン、+X軸からCCW方向(DXFの角度系と同じ数学的な向き)。textは複数行の場合\nを含む。
 * widthFactorは文字の横幅の倍率(DXFのTEXT幅係数)。CADは枠に収めるために0.4〜1.7などへ変えるので無視できない。省略時は1。
 */
export type CadText = {
  id: string;
  type: "TEXT";
  layer: string;
  color: string;
  position: Point2D;
  text: string;
  height: number;
  widthFactor?: number;
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
  lineDash?: LineDash;
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
  lineDash?: LineDash;
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
