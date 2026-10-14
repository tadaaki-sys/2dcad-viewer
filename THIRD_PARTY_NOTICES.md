# 第三者ライセンス一覧(THIRD_PARTY_NOTICES)

2D CAD Viewer が配布物(ビルド後の `dist`)に含める、または開発に使う第三者ソフトウェアのライセンス一覧です。
調査日: 2026-10-14 / 対象: `package.json` に記載の依存関係と、インストール済みの全パッケージ(52個)

> この文書は技術的な調査の記録で、法的な助言ではありません。社外への提供や商用化の前には、専門家(弁理士・弁護士)に確認してください。

## 1. 配布物に含まれるもの

| ライブラリ | バージョン | ライセンス | 利用目的 | 配布物での位置 |
|---|---|---|---|---|
| @mlightcad/libredwg-web(中身は GNU LibreDWG 0.13.3) | 0.7.14 | **GPL-3.0**(LibreDWG 本体は GPL-3.0 以降) | DWG を DXF へ変換する | `dist/assets/libredwg-web-*.wasm`(約9.5MB)と、JavaScript の接続部分(ワーカーに同梱) |
| dxf-parser | 1.1.2 | MIT | DXF の解析 | ワーカーに同梱 |
| loglevel | 1.9.2 | MIT | dxf-parser が使うログ出力 | ワーカーに同梱 |
| react | 19.3.0 | MIT | 画面の描画 | メインの JavaScript に同梱 |
| react-dom | 19.3.0 | MIT | 画面の描画 | メインの JavaScript に同梱 |
| scheduler | 0.28.0 | MIT | React の内部部品 | メインの JavaScript に同梱 |

LGPL・AGPL のライブラリはありません。ライセンスが不明のライブラリもありません。

## 2. GPL-3.0 のライブラリについて(要注意)

- 対象: `@mlightcad/libredwg-web` 0.7.14(WASM に組み込まれた GNU LibreDWG 0.13.3)
- 著作権: LibreDWG の著作権は Free Software Foundation(FSF)にあります。`@mlightcad/libredwg-web` のラッパーは MLight Lee 氏によるものです。
- 入手先:
  - https://github.com/mlightcad/libredwg-web (リポジトリに `COPYING` があります)
  - https://www.gnu.org/software/libredwg/
  - ライセンス全文: https://www.gnu.org/licenses/gpl-3.0.html
- LibreDWG に商用ライセンスや二重ライセンスがあるという情報は、見つかっていません。
- 注意:
  - npm パッケージ `@mlightcad/libredwg-web` には LICENSE ファイルが入っておらず、`package.json` に `GPL-3.0` と書かれているだけです。ライセンス全文は上のリポジトリで確認してください。
  - WASM に含まれる LibreDWG 以外の部品(Emscripten の実行部分など)のライセンスは、バイナリからは確認できていません。**要確認**。
  - 本プロジェクトでの使い方: DWG ファイルを入力として渡し、DXF ファイルを受け取るだけの、狭い受け渡しです(`src/dxf/dwgToDxf.ts` の1か所に集約)。

### 社内利用での扱い

- 自社の社員だけが使う範囲では、GPL の「配布」の義務は発生しないと一般に考えられています。
- ただし、Netlify の公開 URL にアクセスした人は誰でも WASM をダウンロードできます。社内利用に限るなら、URL を社外に出さない、またはアクセスを制限してください。

### 社外へ提供する場合に注意すること

- GPL-3.0 の WASM をソフトウェアと一緒に配布すると、そのソースコード(対応するソース)を提供する義務が生じます。
- 自社のコードが WASM と一体のプログラムと見なされる場合、自社コードにも GPL が及ぶ可能性があります。判断が必要です。
- 商用化するなら、DWG の変換部分(`src/dxf/dwgToDxf.ts`)を、ライセンス上の問題がないものに差し替える必要があります。候補は次のとおりです。
  - Open Design Alliance の SDK(商用の年間契約)
  - DWG を扱わない版(DXF のみ。配布物は MIT のライブラリだけになります)
- DXF のみの版は、DWG に関わる依存(`@mlightcad/libredwg-web`)とファイル(`dwgToDxf.ts`、`dwgFormat.ts`、WASM)を取り除けば作れます。

## 3. MIT ライセンスのライブラリ(著作権表示と許諾文)

MIT ライセンスは、ソフトウェアのすべての複製物に、下記の著作権表示と許諾文を含めることを条件としています。社外へ提供する場合は、この節を同梱してください。

### dxf-parser

```
The MIT License (MIT)

Copyright (c) 2015 GDS Storefront Estimating

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

### loglevel

```
Copyright (c) 2013 Tim Perry

Permission is hereby granted, free of charge, to any person
obtaining a copy of this software and associated documentation
files (the "Software"), to deal in the Software without
restriction, including without limitation the rights to use,
copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the
Software is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
OTHER DEALINGS IN THE SOFTWARE.
```

### react / react-dom / scheduler

3つとも同じ文面です。

```
MIT License

Copyright (c) Meta Platforms, Inc. and affiliates.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 4. 開発時だけ使うもの(配布物には含まれません)

Vite、TypeScript、Vitest、oxlint、`@vitejs/plugin-react`、`@types/*` などと、それらが使う部品(合計46個)です。ライセンスの内訳は次のとおりです。

| ライセンス | 数(配布物の6個を除く、全体では52個) |
|---|---|
| MIT | 38 |
| Apache-2.0 | 3 |
| ISC | 2 |
| BSD-3-Clause | 1 |
| MPL-2.0 | 2(`lightningcss`、CSS のビルド用。配布物には含まれません) |

これらは配布物に入らないため、利用者への表示義務はありません。ただし、開発環境を社外に渡す場合は、各パッケージのライセンスを確認してください。

## 5. この文書の更新方法

依存関係(`package.json` の `dependencies`)を追加・更新したら、次を確認して、この文書を更新してください。

1. `npm ls --omit=dev --all` で、配布物に含まれるパッケージを確認する。
2. 各パッケージの `node_modules/<名前>/package.json` の `license` と、LICENSE ファイルを確認する。
3. GPL・LGPL・AGPL・ライセンス不明のものが増えていないか確認する。増えていたら、使い続けてよいか判断する。

## 6. その他

- 顧客の図面(DWG・DXF・PDF)は、リポジトリにもコミット履歴にも入っていません(`.gitignore` で除外、2026-10-14 に確認)。
- このプロジェクト自体(自社コード)には、LICENSE ファイルを付けていません。社内利用の間は、権利は自社に帰属します。社外へ提供する前に、方針を決めてください。
