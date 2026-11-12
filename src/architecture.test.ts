// フォルダごとの依存の向き(境界)を守るテスト。規則の説明は docs/architecture.md。
//
//   core/  CADの中核(モデル・幾何・選択・スナップ・測定・表示の座標)。画面にもファイル形式にも依存しない。
//          読み込んでよいのは core/ と types/ だけ。外部パッケージ・ブラウザの機能は使わない。
//   io/    ファイル形式の読み書き(DXF・DWG・ワーカー)。core/ と types/、決めたパッケージだけを使う。画面には依存しない。
//
// 画面(App・components・cad-view)は、どこからでも読み込まれない側なので、ここでは規則を設けない。
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(".");
const SRC = path.join(ROOT, "src");
const CORE = path.join(SRC, "core");
const IO = path.join(SRC, "io");
const TYPES = path.join(SRC, "types");
const NODE_MODULES = path.join(ROOT, "node_modules");

type LayerRule = {
  name: string;
  root: string;
  /** 相対パスで読み込んでよい場所 */
  allowedRoots: string[];
  /** 読み込んでよい外部パッケージ */
  allowedPackages: string[];
};

const CORE_RULE: LayerRule = { name: "core", root: CORE, allowedRoots: [CORE, TYPES], allowedPackages: [] };
const IO_RULE: LayerRule = {
  name: "io",
  root: IO,
  // DWG変換のWASMは、パッケージの公開範囲の外にあるため node_modules を相対パスで読み込んでいる
  allowedRoots: [IO, CORE, TYPES, NODE_MODULES],
  allowedPackages: ["dxf-parser", "@mlightcad/libredwg-web"],
};

// 画面・ブラウザに依存するもの(識別子として現れたら違反。文字列やコメントの中は数えない)
const FORBIDDEN_GLOBALS = [
  "window",
  "localStorage",
  "sessionStorage",
  "navigator",
  "HTMLElement",
  "HTMLCanvasElement",
  "CanvasRenderingContext2D",
  "Path2D",
  "requestAnimationFrame",
  "Worker",
];
// 「document」は、CADのドキュメント(CadDocument)の変数名としても使うので、ブラウザのdocumentの使い方だけを禁止する
const FORBIDDEN_PATTERNS: Array<[RegExp, string]> = [
  [/\bdocument\.(body|head|documentElement|createElement|querySelector|querySelectorAll|getElementById|addEventListener|fullscreenElement)\b/, "document(ブラウザの画面)"],
  [/\bglobalThis\.document\b/, "document(ブラウザの画面)"],
];

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** 文字列の中身を消す("window" のような、範囲選択のモード名などを、ブラウザの機能と取り違えないため) */
function stripStrings(source: string): string {
  return source.replace(/"(?:\\.|[^"\\\n])*"/g, '""').replace(/'(?:\\.|[^'\\\n])*'/g, "''").replace(/`(?:\\.|[^`\\])*`/g, "``");
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/** パッケージ名(「@scope/name/sub」→「@scope/name」、「name/sub」→「name」) */
function packageName(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

/** ソース1つ分の違反を、日本語のメッセージの一覧で返す。違反がなければ空 */
export function findBoundaryViolations(rule: LayerRule, filePath: string, source: string): string[] {
  const violations: string[] = [];
  const withoutComments = stripComments(source);

  const specifiers = [
    ...withoutComments.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*["']([^"']+)["']/g),
    ...withoutComments.matchAll(/\bnew URL\(\s*["']([^"']+)["']/g),
  ].map((match) => match[1]);
  for (const specifier of specifiers) {
    if (!specifier.startsWith(".")) {
      if (!rule.allowedPackages.includes(packageName(specifier))) violations.push(`許可されていない外部のパッケージを読み込んでいます: ${specifier}`);
      continue;
    }
    const resolved = path.resolve(path.dirname(filePath), specifier);
    if (!rule.allowedRoots.some((root) => isInside(root, resolved))) {
      violations.push(`${rule.name} から読み込めない場所を読み込んでいます: ${specifier}`);
    }
  }

  const code = stripStrings(withoutComments);
  for (const name of FORBIDDEN_GLOBALS) {
    if (new RegExp(`\\b${name}\\b`).test(code)) violations.push(`画面・ブラウザ依存の名前を使っています: ${name}`);
  }
  for (const [pattern, label] of FORBIDDEN_PATTERNS) {
    if (pattern.test(code)) violations.push(`画面・ブラウザ依存の名前を使っています: ${label}`);
  }
  return violations;
}

function listSourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listSourceFiles(full);
    // テスト(*.test.ts)とテスト用の補助(testHelpers.ts)は、規則の対象外(何でも読み込んでよい)
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name) && entry.name !== "testHelpers.ts" ? [full] : [];
  });
}

function violationsIn(rule: LayerRule): string[] {
  const files = listSourceFiles(rule.root);
  expect(files.length).toBeGreaterThan(0);
  return files.flatMap((file) => findBoundaryViolations(rule, file, fs.readFileSync(file, "utf8")).map((v) => `${path.relative(SRC, file)}: ${v}`));
}

describe("dependency boundaries", () => {
  it("core imports only core and types, and uses no browser features", () => {
    expect(violationsIn(CORE_RULE)).toEqual([]);
  });

  it("io imports only io, core, types and its file-format packages, and does not depend on the screen", () => {
    expect(violationsIn(IO_RULE)).toEqual([]);
  });
});

describe("findBoundaryViolations (the checker itself)", () => {
  const coreFile = path.join(CORE, "model", "sample.ts");
  const ioFile = path.join(IO, "dxf", "sample.ts");

  it("accepts imports inside core and types for core", () => {
    const source = `import { a } from "./ids";\nimport type { B } from "../../types/cad";\nimport { c } from "../geometry/geometry";`;
    expect(findBoundaryViolations(CORE_RULE, coreFile, source)).toEqual([]);
  });

  it("rejects utils, cad-view, io, components and every package for core", () => {
    expect(findBoundaryViolations(CORE_RULE, coreFile, `import { f } from "../../utils/format";`)).toHaveLength(1);
    expect(findBoundaryViolations(CORE_RULE, coreFile, `import { x } from "../../cad-view/renderer/CanvasRenderer";`)).toHaveLength(1);
    expect(findBoundaryViolations(CORE_RULE, coreFile, `import { y } from "../../io/dxf/DxfParserAdapter";`)).toHaveLength(1);
    expect(findBoundaryViolations(CORE_RULE, coreFile, `import { z } from "../../components/Toolbar";`)).toHaveLength(1);
    expect(findBoundaryViolations(CORE_RULE, coreFile, `import React from "react";`)).toHaveLength(1);
    expect(findBoundaryViolations(CORE_RULE, coreFile, `import DxfParser from "dxf-parser";`)).toHaveLength(1);
  });

  it("accepts the file-format packages, core and node_modules paths for io, but not the screen", () => {
    const ok = [
      `import DxfParser from "dxf-parser";`,
      `import type { IDxf } from "dxf-parser";`,
      `import createModule from "../../../node_modules/@mlightcad/libredwg-web/wasm/libredwg-web.js";`,
      `const url = new URL("../../../node_modules/@mlightcad/libredwg-web/wasm/libredwg-web.wasm", import.meta.url);`,
      `import { applyMatrix } from "../../core/geometry/matrix2d";`,
      `import type { CadModel } from "../../types/cad";`,
    ].join("\n");
    expect(findBoundaryViolations(IO_RULE, ioFile, ok)).toEqual([]);
    expect(findBoundaryViolations(IO_RULE, ioFile, `import React from "react";`)).toHaveLength(1);
    expect(findBoundaryViolations(IO_RULE, ioFile, `import { CadCanvas } from "../../cad-view/CadCanvas";`)).toHaveLength(1);
    expect(findBoundaryViolations(IO_RULE, ioFile, `import { Toolbar } from "../../components/Toolbar";`)).toHaveLength(1);
    expect(findBoundaryViolations(IO_RULE, ioFile, `import { formatMm } from "../../utils/format";`)).toHaveLength(1);
  });

  it("rejects browser globals but ignores them in comments and strings", () => {
    expect(findBoundaryViolations(CORE_RULE, coreFile, `const w = window.innerWidth;`)).toHaveLength(1);
    expect(findBoundaryViolations(CORE_RULE, coreFile, `const p = new Path2D();`)).toHaveLength(1);
    expect(findBoundaryViolations(CORE_RULE, coreFile, `const e = document.body;`)).toHaveLength(1);
    expect(findBoundaryViolations(CORE_RULE, coreFile, `const c = document.querySelector("canvas");`)).toHaveLength(1);
    // CADのドキュメントを表す変数名の document は、問題ない
    expect(findBoundaryViolations(CORE_RULE, coreFile, `const n = document.entities.length + document.layers.length;`)).toEqual([]);
    expect(findBoundaryViolations(CORE_RULE, coreFile, `// window や Path2D を使わない\n/* localStorage */\nconst ok = 1;`)).toEqual([]);
    expect(findBoundaryViolations(CORE_RULE, coreFile, `type Mode = "window" | "crossing";\nconst m: Mode = 'window';`)).toEqual([]);
  });
});
