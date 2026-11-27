import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { EditOutcome } from "../app/document/editing";
import type { StyleProperty } from "../app/document/propertyEditing";
import { BY_LAYER } from "../core/layer/entityStyle";
import { canHaveLineDash, canHaveLineWeight } from "../core/layer/layerRules";
import { geometryFieldsOf, geometryValueOf } from "../core/geometry/propertyGeometry";
import type { GeometryField } from "../core/geometry/propertyGeometry";
import { BYLAYER_COLOR, BYLAYER_LINETYPE, BYLAYER_LINEWEIGHT, followsLayer } from "../core/style/byLayer";
import { CONTINUOUS, lineTypeKeyOf } from "../core/style/lineTypes";
import { STANDARD_LINE_WEIGHTS, lineWeightLabel } from "../core/style/lineWeight";
import type { CadEntity, CadLayer, CadLineType } from "../types/cad";

export type PropertyEditorProps = {
  /** 選択のうち、編集できる図形 */
  entities: readonly CadEntity[];
  layers: readonly CadLayer[];
  lineTypes: readonly CadLineType[];
  onSetStyle: (ids: readonly string[], change: StyleProperty) => EditOutcome;
  onSetGeometry: (id: string, field: GeometryField, value: number) => EditOutcome;
  onMoveToLayer: (layer: string) => EditOutcome;
};

const GEOMETRY_LABELS: Record<GeometryField, string> = {
  startX: "Start X",
  startY: "Start Y",
  endX: "End X",
  endY: "End Y",
  centerX: "Center X",
  centerY: "Center Y",
  radius: "Radius",
  startAngle: "Start Angle (°)",
  endAngle: "End Angle (°)",
  positionX: "Position X",
  positionY: "Position Y",
  height: "Text Height",
  rotation: "Rotation (°)",
};

/** すべての図形で同じ値なら、その値。違えば undefined */
function common<T>(entities: readonly CadEntity[], pick: (entity: CadEntity) => T): T | undefined {
  const first = pick(entities[0]);
  return entities.every((entity) => pick(entity) === first) ? first : undefined;
}

const lineTypeOf = (entity: CadEntity): string => (followsLayer(entity, BYLAYER_LINETYPE) ? BY_LAYER : entity.type === "TEXT" || entity.lineDash === undefined ? CONTINUOUS : entity.lineDash.name);
const lineWeightOf = (entity: CadEntity): string => (followsLayer(entity, BYLAYER_LINEWEIGHT) ? BY_LAYER : entity.type === "TEXT" || entity.type === "POINT" || entity.lineWeight === undefined ? "" : String(entity.lineWeight));

/** 数値の表示(有効数字12桁で、誤差の尾を取る) */
const display = (value: number): string => String(Number(value.toPrecision(12)));

/** 色の入力。選び終わったとき(ブラウザの change)に1回だけ反映する(選んでいる途中の色ごとに、Undo の段階を作らない) */
function ColorInput({ color, onCommit }: { color: string; onCommit: (color: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const commit = useRef(onCommit);
  useEffect(() => {
    commit.current = onCommit;
  });
  useEffect(() => {
    const input = ref.current;
    if (input === null) return;
    const handler = () => commit.current(input.value);
    input.addEventListener("change", handler);
    return () => input.removeEventListener("change", handler);
    // key={color} で、色が変わるたびに、input が作り直される。新しい要素にも、リスナーを付け直す
  }, [color]);
  // key で、反映後の色に作り直す(拒否されたとき、元の色に戻す)
  return <input key={color} ref={ref} type="color" className="property-editor__color" data-testid="property-color" aria-label="色" defaultValue={color} />;
}

function NumberField({ field, value, onCommit }: { field: GeometryField; value: number; onCommit: (field: GeometryField, value: number | null) => void }) {
  // 反映後・Undo 後の値に、入力欄を作り直す
  const shown = display(value);
  return (
    <input
      key={shown}
      type="text"
      className="property-editor__input"
      data-testid={`property-geometry-${field}`}
      aria-label={GEOMETRY_LABELS[field]}
      defaultValue={shown}
      onBlur={(event) => {
        if (event.target.value.trim() !== shown) onCommit(field, event.target.value.trim() === "" ? null : Number(event.target.value));
      }}
      onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Enter" && !event.nativeEvent.isComposing && event.keyCode !== 229) event.currentTarget.blur();
      }}
    />
  );
}

/**
 * プロパティの編集(選択した、編集できる図形): レイヤー・色・線種・線の太さ・線種尺度(複数選択でも)と、1つ選んだときの座標・半径・角度など。
 * 値の確認と図面への適用は、core/layer/entityStyle.ts・core/geometry/propertyGeometry.ts・app/document/propertyEditing.ts(ここは、表示と入力だけ)。
 */
export function PropertyEditor({ entities, layers, lineTypes, onSetStyle, onSetGeometry, onMoveToLayer }: PropertyEditorProps) {
  const [result, setResult] = useState<EditOutcome | null>(null);
  // 断られた入力が、欄に残らないように、断られたとき、入力欄を作り直す(図形の値と、表示を食い違わせない)
  const [revision, setRevision] = useState(0);
  if (entities.length === 0) return null;
  const ids = entities.map((entity) => entity.id);
  const run = (outcome: EditOutcome) => {
    setResult(outcome);
    if (!outcome.ok) setRevision((r) => r + 1);
  };

  const layer = common(entities, (e) => e.layer);
  const colorByLayer = common(entities, (e) => followsLayer(e, BYLAYER_COLOR));
  const color = common(entities, (e) => e.color) ?? entities[0].color;
  const dashEntities = entities.filter(canHaveLineDash);
  const weightEntities = entities.filter(canHaveLineWeight);
  const lineType = dashEntities.length > 0 ? common(dashEntities, lineTypeOf) : undefined;
  const lineWeight = weightEntities.length > 0 ? common(weightEntities, lineWeightOf) : undefined;
  const single = entities.length === 1 ? entities[0] : null;
  const fields = single === null ? [] : geometryFieldsOf(single);
  const scaleOf = (e: CadEntity) => (typeof e.lineTypeScale === "number" ? e.lineTypeScale : 1);
  const scale = dashEntities.length > 0 ? common(dashEntities, scaleOf) : undefined;

  return (
    <div className="property-editor" data-testid="property-editor">
      <div className="property-panel__section-title">Edit</div>
      <label className="property-editor__row">
        <span>Layer</span>
        <select data-testid="property-layer" value={layer ?? ""} onChange={(event) => event.target.value !== "" && run(onMoveToLayer(event.target.value))}>
          {layer === undefined && <option value="">(複数)</option>}
          {layers.map((l) => (
            <option key={l.name} value={l.name}>
              {l.name}
            </option>
          ))}
        </select>
      </label>
      <div className="property-editor__row">
        <span>Color</span>
        <span className="property-editor__controls">
          <ColorInput color={color} onCommit={(value) => run(onSetStyle(ids, { kind: "color", value }))} />
          <button type="button" data-testid="property-color-bylayer" disabled={colorByLayer === true} onClick={() => run(onSetStyle(ids, { kind: "color", value: BY_LAYER }))}>
            ByLayer
          </button>
        </span>
      </div>
      {dashEntities.length > 0 && (
        <label className="property-editor__row">
          <span>Linetype</span>
          <select data-testid="property-linetype" value={lineType ?? ""} onChange={(event) => event.target.value !== "" && run(onSetStyle(dashEntities.map((e) => e.id), { kind: "lineType", value: event.target.value }))}>
            {lineType === undefined && <option value="">(複数)</option>}
            <option value={BY_LAYER}>ByLayer</option>
            {lineTypes.map((t) => (
              <option key={t.name} value={t.name}>
                {t.name}
              </option>
            ))}
            {lineType !== undefined && lineType !== BY_LAYER && !lineTypes.some((t) => lineTypeKeyOf(t.name) === lineTypeKeyOf(lineType)) && <option value={lineType}>{lineType}</option>}
          </select>
        </label>
      )}
      {weightEntities.length > 0 && (
        <label className="property-editor__row">
          <span>Lineweight</span>
          <select
            data-testid="property-lineweight"
            value={lineWeight ?? "mixed"}
            onChange={(event) => {
              const v = event.target.value;
              if (v === "mixed") return;
              run(onSetStyle(weightEntities.map((e) => e.id), { kind: "lineWeight", value: v === BY_LAYER ? BY_LAYER : v === "" ? null : Number(v) }));
            }}
          >
            {lineWeight === undefined && <option value="mixed">(複数)</option>}
            <option value={BY_LAYER}>ByLayer</option>
            <option value="">既定</option>
            {STANDARD_LINE_WEIGHTS.map((w) => (
              <option key={w} value={String(w)}>
                {lineWeightLabel(w)}
              </option>
            ))}
            {lineWeight !== undefined && lineWeight !== "" && lineWeight !== BY_LAYER && !STANDARD_LINE_WEIGHTS.includes(Number(lineWeight)) && <option value={lineWeight}>{lineWeightLabel(Number(lineWeight))}</option>}
          </select>
        </label>
      )}
      {dashEntities.length > 0 && (
        <div className="property-editor__row">
          <span>Linetype Scale</span>
          <input
            key={`${String(scale)}:${revision}`}
            type="text"
            className="property-editor__input"
            data-testid="property-ltscale"
            aria-label="線種尺度"
            defaultValue={scale === undefined ? "" : display(scale)}
            placeholder={scale === undefined ? "(複数)" : ""}
            onBlur={(event) => {
              const text = event.target.value.trim();
              if (text === "" || (scale !== undefined && text === display(scale))) return;
              run(onSetStyle(dashEntities.map((e) => e.id), { kind: "lineTypeScale", value: Number(text) }));
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing && event.keyCode !== 229) event.currentTarget.blur();
            }}
          />
        </div>
      )}
      {single !== null &&
        fields.map((field) => {
          const value = geometryValueOf(single, field);
          return value === null ? null : (
            <div key={field} className="property-editor__row">
              <span>{GEOMETRY_LABELS[field]}</span>
              <NumberField key={`${single.id}:${field}:${revision}`} field={field} value={value} onCommit={(f, v) => run(v === null || !Number.isFinite(v) ? { ok: false, message: "数値で入力してください" } : onSetGeometry(single.id, f, v))} />
            </div>
          );
        })}
      {result !== null && (
        <div className={result.ok ? "property-editor__result" : "property-editor__result property-editor__result--error"} role={result.ok ? "status" : "alert"} data-testid="property-editor-result">
          {result.message}
        </div>
      )}
    </div>
  );
}
