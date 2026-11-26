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
  /** レイヤーの線種名(線種表にある名前)。無ければ実線(CONTINUOUS)。Phase 17 */
  lineType?: string;
  /** レイヤーの線の太さ(1/100mm)。無ければ既定(細線)。Phase 17 */
  lineWeight?: number;
};

/** 線種の定義。elements は DXF の LTYPE と同じ要素列(正=線、負=空き、0=点)。長さは図面の単位(mm)で、全体の線種尺度(ltScale)を掛ける前の値 */
export type CadLineType = {
  name: string;
  elements: readonly number[];
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
  /** 線の太さ(1/100mm)。0.27mmを超える太線の場合だけ保持し、省略時は細線(1px)として描く */
  lineWeight?: number;
  start: Point2D;
  end: Point2D;
};

export type CadPolyline = {
  id: string;
  type: "LWPOLYLINE" | "POLYLINE";
  layer: string;
  color: string;
  lineDash?: LineDash;
  /** 線の太さ(1/100mm)。0.27mmを超える太線の場合だけ保持し、省略時は細線(1px)として描く */
  lineWeight?: number;
  vertices: Point2D[];
  closed: boolean;
};

export type CadCircle = {
  id: string;
  type: "CIRCLE";
  layer: string;
  color: string;
  lineDash?: LineDash;
  /** 線の太さ(1/100mm)。0.27mmを超える太線の場合だけ保持し、省略時は細線(1px)として描く */
  lineWeight?: number;
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
  /** 線の太さ(1/100mm)。0.27mmを超える太線の場合だけ保持し、省略時は細線(1px)として描く */
  lineWeight?: number;
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
 *
 * 次の属性は、すべて任意(取り込んだ文字には付かない)。新しく描いた文字が、描いたときの文字スタイルの値をコピーして持つ:
 * fontFamilyはCSSのフォント名(省略時はsans-serif)、italicは斜体、styleNameは描いたときのスタイル名(記録だけ)。
 * MTEXT(複数行文字)は、isMText が true で、boxWidth(枠の幅[mm])で折り返す。枠の幅を持たない文字は、改行(\n)だけで分ける。
 * 基準点(position)は、水平・垂直の配置に応じた、枠(または文字の外形)の位置。
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
  fontFamily?: string;
  italic?: boolean;
  boxWidth?: number;
  isMText?: boolean;
  styleName?: string;
};

export type CadDimensionKind = "linear" | "aligned" | "radius" | "diameter" | "angular";
export type CadDimensionUnit = "mm" | "cm" | "m";

/**
 * 寸法の見た目の値(描いたときの寸法スタイルから、そのままコピーしたもの。スタイルを後で変えても、描いた寸法は変わらない)。
 * 長さの単位は、図面の単位(mm)。
 */
export type CadDimensionValues = {
  textHeight: number;
  arrowSize: number;
  /** 長さの小数桁 */
  decimals: number;
  /** 角度の小数桁 */
  angleDecimals: number;
  /** 長さを表示する単位(図面の値を、この単位に換算して表示する) */
  unit: CadDimensionUnit;
  /** 数値のあとに、単位(mm など)を付けるか */
  showUnit: boolean;
  /** 寸法補助線の、図形からの間隔(起点と、補助線の始まりとの間) */
  extensionOffset: number;
};

/**
 * 図形の上の位置(寸法が関連付ける点)。線: start・end・mid。円弧: start・end・mid・center。円: center。
 * 折れ線: vertex(頂点の番号)。whole は、図形そのもの(半径・直径の円・円弧、角度の線)。
 */
export type DimensionAnchor =
  | { kind: "start" }
  | { kind: "end" }
  | { kind: "mid" }
  | { kind: "center" }
  | { kind: "vertex"; index: number }
  | { kind: "whole" };

/** どの定義点(または円・線)を、関連付けているか。p1・p2・p3 = 点、figure = 半径・直径の円・円弧、line1・line2 = 角度の2本の線 */
export type DimensionRefSlot = "p1" | "p2" | "p3" | "figure" | "line1" | "line2";

/**
 * 寸法の参照(Phase 16)。参照している図形の ID と、その図形の上の位置。
 * 参照した図形が変わると、寸法は、この参照から、測る点を計算し直す(追従する)。
 * broken が true のとき、参照は切れている(図形が削除された・位置が無くなった)。最後の位置のまま、警告として赤で表示する。
 */
export type DimensionRef = {
  slot: DimensionRefSlot;
  id: string;
  anchor: DimensionAnchor;
  broken?: true;
};

/**
 * 寸法。線・矢印・数値は、図形として持たず、定義点とスタイルの値から、表示のたびに計算する(測定値が古くならない)。
 * - linear  : 水平・垂直(rotation = 寸法線の向き。0 = 水平、π/2 = 垂直)。p1・p2 = 寸法補助線の起点、position = 寸法線が通る点
 * - aligned : p1・p2 を結ぶ向きに平行な寸法。p1・p2 = 起点、position = 寸法線が通る点
 * - radius  : p1 = 中心、p2 = 円周上の点(半径を決める)、position = 文字の側の点(中心から見た向きで、矢印の位置が決まる)
 * - diameter: radius と同じ(直径線は、中心を通る)
 * - angular : p1 = 頂点、p2 = 1本目の腕の上の点、p3 = 2本目の腕の上の点、position = 寸法の弧が通る点(弧の側を決める)
 * 色・レイヤーは、他の図形と同じ。線種は lineDash。
 */
export type CadDimension = {
  id: string;
  type: "DIMENSION";
  layer: string;
  color: string;
  lineDash?: LineDash;
  /** 線の太さは持たない(他の図形と同じ書き方で参照できるよう、未指定として宣言) */
  lineWeight?: undefined;
  kind: CadDimensionKind;
  p1: Point2D;
  p2: Point2D;
  p3?: Point2D;
  position: Point2D;
  rotation?: number;
  values: CadDimensionValues;
  /** 描いたときのスタイル名(記録だけ) */
  styleName?: string;
  /** 関連付けている図形(Phase 16)。無いか空なら、連動しない寸法(Phase 15 までの寸法) */
  refs?: readonly DimensionRef[];
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
  /** 線の太さ(1/100mm)。0.27mmを超える太線の場合だけ保持し、省略時は細線(1px)として描く */
  lineWeight?: number;
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
  /** 線の太さ(1/100mm)。0.27mmを超える太線の場合だけ保持し、省略時は細線(1px)として描く */
  lineWeight?: number;
  points: Point2D[];
  closed: boolean;
};

/** 点。見た目(点・十字・円など)と大きさは図面全体の設定(CadModel.pointStyle)に従い、図形ごとの線種・線幅は持たない */
export type CadPoint = {
  id: string;
  type: "POINT";
  layer: string;
  color: string;
  // 他の図形と同じ書き方でプロパティを参照できるよう、未指定として宣言しておく
  lineDash?: undefined;
  lineWeight?: undefined;
  position: Point2D;
};

/** 点の表示設定。modeはDXFの$PDMODE(0=点,1=非表示,2=+,3=×,4=縦線。+32で円、+64で四角を重ねる)、sizeは$PDSIZE */
export type CadPointStyle = {
  mode: number;
  size: number;
};

/**
 * 2次元の変換行列 [a, b, c, d, e, f]。点 (x, y) を、(a·x + c·y + e, b·x + d·y + f) に移す(DXF・SVG・Canvas の行列と同じ並び)。
 * 移動・回転は、a=d=cosθ、b=-c=sinθ、(e, f)=移動量 の形(長さと形を変えない)。
 * 一様な拡大縮小は、これに倍率 s を掛けた形(a=d=s·cosθ、b=-c=s·sinθ)。鏡像は、向きを反転する形(a=-d、b=c)。
 * 非一様な拡大縮小・せん断は扱わない。
 */
export type Affine2D = readonly [number, number, number, number, number, number];

/**
 * 元データ(DXFの記録)との対応。「この図形は、取り込んだ図形 id の元の記録に、変換 matrix を施したもの」という意味。
 * 取り込んだ図形を移動・回転・複写したときに付く。保存の Phase が、元の記録(円弧つきのポリラインやスプラインを含む)に、
 * 同じ変換を直接適用して書くために持つ(折れ線に展開した点列から作り直すと、形が変わるため)。
 * - 取り込んだ図形そのものを動かしたとき: id はその図形自身。複写では、複写もとの(取り込んだ)図形の id
 * - matrix は、元の記録の座標から、いまの座標への変換(動かすたびに合成する)
 * 新しく描いた図形(元データに記録が無いもの)には付かない。
 */
export type SourceRecord = {
  id: string;
  matrix: Affine2D;
  /**
   * true なら、頂点などが個別に動いて(STRETCH)、形が matrix だけでは表せないことを表す(Phase 10)。
   * 保存では、matrix を元の記録に適用するのではなく、いまの形で、元の記録を置き換えて書く。
   * (取り込んだ折れ線は、円弧の膨らみが展開済みの点列なので、頂点を動かした結果は、元の記録の頂点と対応しない)
   *
   * 注意(保存の Phase): matrix は、鏡像・拡大縮小を含みうる。図形の種類ごとの規則で、元の記録に適用すること。
   * 特に、文字(TEXT)は、鏡像でも反転させない(挿入点を matrix で変換し、向きは変えず、高さに倍率を掛ける)。
   * 円弧は、鏡像で始点・終点の角度を入れ替え、ポリラインの bulge は、鏡像で符号を反転する。
   */
  reshaped?: boolean;
};

/**
 * ByLayer の印(ビット。Phase 17): 立っている属性は、レイヤーの設定に従う(レイヤーの設定を変えると、図形も追従する)。
 * 図形の color・lineDash・lineWeight は、従うべき値を解決済みで持っている(描画はこれをそのまま使う)。
 * 印が無い(0)属性は、図形自身の指定(ByObject)で、レイヤーが変わっても動かない。
 * ビットの値は core/style/byLayer.ts(BYLAYER_COLOR=1・BYLAYER_LINETYPE=2・BYLAYER_LINEWEIGHT=4)。
 */

/** すべての図形が持てる、任意の項目 */
/** lineTypeScale: 図形ごとの線種尺度(DXF の 48)。1 以外のときだけ持つ。破線が無い(実線の)間も失わないために、破線とは別に持つ */
export type EntityExtras = { sourceRecord?: SourceRecord; byLayer?: number; lineTypeScale?: number };

export type CadEntity = (CadLine | CadPolyline | CadCircle | CadArc | CadText | CadEllipse | CadSpline | CadPoint | CadDimension) & EntityExtras;

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
  /** 線種表(取り込んだ図面の LTYPE。標準の線種との合成はドキュメント側)。省略時は取り込んだ線種なし */
  lineTypes?: CadLineType[];
  /** 全体の線種尺度($LTSCALE)。省略時は 1 */
  ltScale?: number;
  /** 点(POINT)の表示設定。省略時は点(PDMODE 0)として扱う */
  pointStyle?: CadPointStyle;
  bounds: CadBounds | null;
  stats: CadModelStats;
};

export type Measurement = {
  id: string;
  pointA: Point2D;
  pointB: Point2D;
};
