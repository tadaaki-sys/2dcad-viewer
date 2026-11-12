# フォルダの役割と依存の向き

2D CAD Viewer を本格的な 2D CAD へ段階的に広げるための、フォルダの役割と規則です(Phase 1c で整理)。
規則は自動テスト `src/architecture.test.ts` で確認しています。違反すると `npm test` が失敗します。

## 全体の形

```
画面(React)  App.tsx / components/ / cad-view/
     │  使う
     ▼
io/  ファイル形式の読み書き(DXF・DWG・ワーカー)
     │  使う
     ▼
core/  CADの中核(モデル・幾何・選択・スナップ・測定・表示の座標)
     │  使う
     ▼
types/  共通の型(CadEntity など)
```

**矢印の向きにだけ、読み込んでよい**のが原則です。下の層は、上の層を知りません。

## 各フォルダの役割

| フォルダ | 役割 | 読み込んでよいもの |
|---|---|---|
| `src/core/` | CAD の中核。画面にも、ファイル形式にも依存しない。 | `core/`、`types/` だけ。外部パッケージ、ブラウザの機能(`window`、Canvas など)は使わない。 |
| `src/io/` | ファイル形式の読み書き。DXF・DWG の解析、元データの保持、ワーカー。 | `io/`、`core/`、`types/`、決めたパッケージ(`dxf-parser`、`@mlightcad/libredwg-web`)。画面は読み込まない。 |
| `src/types/` | 共通の型。 | なし(型だけ)。 |
| `src/cad-view/`、`src/components/`、`App.tsx`、`src/hooks/`、`src/utils/format.ts` | 画面(React と Canvas の描画)。 | すべて。ほかの層からは読み込まれない。 |
| `src/regression/`、`e2e/`、`*.test.ts` | テスト。 | すべて(規則の対象外)。 |

## `core/` の中身

| フォルダ | 内容 |
|---|---|
| `core/model/` | ドキュメントモデル(図形の一覧、ID、レイヤー)、描画用モデルとの変換 |
| `core/geometry/` | 幾何(距離、交点、行列、スプライン、ポリラインの膨らみ、楕円の変換、図形の頂点と線分) |
| `core/style/` | 線種(破線のパターン)、線の太さ |
| `core/spatial/` | 空間索引(図形の範囲、格子) |
| `core/selection/` | 選択(クリック、窓、交差) |
| `core/snap/` | スナップ(端点、中点、交点、最近点) |
| `core/measurement/` | 測定 |
| `core/view/` | 表示の拡大と位置(カメラ) |

これから作るもの(予定): `core/commands/`(コマンド、Phase 2)、`core/history/`(Undo/Redo、Phase 3)。

## `io/` の中身

| フォルダ | 内容 |
|---|---|
| `io/dxf/` | DXF の解析(`DxfParserAdapter`)、文字コード、レイヤーの表、DWG→DXF の変換、ワーカー、元データの索引と差分の適用(保存の土台) |

## 新しいコードを置く場所の決め方

1. 画面に関係なく、CAD としての計算や状態の変更か → `core/`
2. ファイル形式(DXF、DWG、将来の独自形式・PDF)に関わるか → `io/`
3. 画面の部品や、マウス・キーボードの扱いか → 画面の側(今は `cad-view/`、`components/`)

迷ったら、下の層(`core/`)に置けないかを先に考えます。下の層に置いたほうが、テストしやすく、壊れにくくなります。

## まだ整理していないもの(後の Phase で行う)

- 画面の側(`cad-view/`、`components/`)は、今の場所のままです。画面を作り直す Phase で、`render/`(描画)と `ui/`(React の部品)に分ける予定です。
- `core/model/convert.ts` は、範囲の計算を引数で受け取っています(Phase 1a で coreの外にあったため)。Phase 1c で同じ `core/` に移ったので、直接呼ぶ形に簡単にできます(処理を変えないため、今はそのまま)。
