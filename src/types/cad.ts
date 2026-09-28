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

export type CadEntity = CadLine | CadPolyline | CadCircle | CadArc;

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
  layers: CadLayer[];
  bounds: CadBounds | null;
  stats: CadModelStats;
};

export type Measurement = {
  id: string;
  pointA: Point2D;
  pointB: Point2D;
};
