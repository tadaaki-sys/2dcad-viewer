// フォルダごとの依存の向き(境界)を守るテスト。規則の説明は docs/architecture.md。
//
//   core/   CADの中核。読み込んでよいのは core/ と types/ だけ。ブラウザの機能もNodeの機能も使わない。
//   io/     ファイル形式の読み書き(ワーカーの中の処理を含む)。io/・core/・types/ と、決めたパッケージだけを使う。
//           画面(DOM)は使わない。ワーカーで使える機能(TextDecoder、WebAssemblyなど)は使ってよい。
//   types/  共通の型。型の宣言だけを置き、types/ 以外は読み込まない。
//
// 検査には TypeScript 自身を使う(文字の検索ではないので、コメント・文字列・変数名に惑わされない)。
//   - 依存の向き: 構文解析で import・export・動的import・型のimport・new URL(...) を取り出して調べる
//   - ブラウザの機能: core と types は「ブラウザの型を含めない」設定で、io は「ワーカーの型だけ」の設定で型チェックする。
//     使ってはいけない機能(window・document・Canvasなど)を使うと、TypeScriptが「見つからない」として検出する
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(".");
const SRC = path.join(ROOT, "src");
const CORE = path.join(SRC, "core");
const IO = path.join(SRC, "io");
const TYPES = path.join(SRC, "types");
/** DWG変換のWASMは、パッケージの公開範囲の外にあるため、このフォルダだけは相対パスで読み込んでよい(io のみ) */
const LIBREDWG_WASM = path.join(ROOT, "node_modules", "@mlightcad", "libredwg-web", "wasm");

export type LayerRule = {
  name: string;
  root: string;
  /** 相対パスで読み込んでよい場所 */
  allowedRoots: string[];
  /** 読み込んでよい外部パッケージ */
  allowedPackages: string[];
  /** 型の宣言だけを許す(値・関数・クラスを置かない、読み込みも型だけ) */
  typesOnly?: boolean;
};

const CORE_RULE: LayerRule = { name: "core", root: CORE, allowedRoots: [CORE, TYPES], allowedPackages: [] };
const IO_RULE: LayerRule = {
  name: "io",
  root: IO,
  allowedRoots: [IO, CORE, TYPES, LIBREDWG_WASM],
  allowedPackages: ["dxf-parser", "@mlightcad/libredwg-web"],
};
const TYPES_RULE: LayerRule = { name: "types", root: TYPES, allowedRoots: [TYPES], allowedPackages: [], typesOnly: true };

/** rootの中か(rootそのものを含む)。「..cache.ts」のような、..で始まるだけの名前は中として扱う */
function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  if (relative === "") return true;
  if (path.isAbsolute(relative)) return false;
  return relative !== ".." && !relative.startsWith(`..${path.sep}`);
}

/** パッケージ名(「@scope/name/sub」→「@scope/name」、「name/sub」→「name」) */
function packageName(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

/** テスト用のファイル(テスト本体、テスト補助、回帰テスト、E2E)か。本番のコードから読み込んではいけない */
function isTestOnly(target: string): boolean {
  const base = path.basename(target);
  return (
    /\.test(\.(ts|tsx))?$/.test(base) ||
    /^testHelpers(\.(ts|tsx))?$/.test(base) ||
    isInside(path.join(SRC, "regression"), target) ||
    isInside(path.join(ROOT, "e2e"), target)
  );
}

type Dependency = { specifier: string | null; kind: string; typeOnly: boolean; line: number };

/** ソースから、読み込み(依存)をすべて取り出す。specifierがnullなら、文字の決まらない動的import */
function collectDependencies(fileName: string, source: string): Dependency[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const dependencies: Dependency[] = [];
  const lineOf = (node: ts.Node) => file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
  const literalText = (node: ts.Node | undefined) =>
    node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null;

  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node)) {
      const typeOnly = Boolean(node.importClause?.isTypeOnly);
      dependencies.push({ specifier: literalText(node.moduleSpecifier), kind: "import", typeOnly, line: lineOf(node) });
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      dependencies.push({ specifier: literalText(node.moduleSpecifier), kind: "export from", typeOnly: node.isTypeOnly, line: lineOf(node) });
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      dependencies.push({ specifier: literalText(node.moduleReference.expression), kind: "import =", typeOnly: node.isTypeOnly, line: lineOf(node) });
    } else if (ts.isImportTypeNode(node)) {
      const argument = ts.isLiteralTypeNode(node.argument) ? literalText(node.argument.literal) : null;
      dependencies.push({ specifier: argument, kind: "import type", typeOnly: true, line: lineOf(node) });
    } else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        dependencies.push({ specifier: literalText(node.arguments[0]), kind: "dynamic import", typeOnly: false, line: lineOf(node) });
      } else if (ts.isIdentifier(node.expression) && node.expression.text === "require") {
        dependencies.push({ specifier: literalText(node.arguments[0]), kind: "require", typeOnly: false, line: lineOf(node) });
      }
    } else if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "URL") {
      // new URL("…", import.meta.url) は、ファイルの読み込み(ワーカーやWASM)
      const second = node.arguments?.[1];
      if (second && second.getText(file) === "import.meta.url") {
        dependencies.push({ specifier: literalText(node.arguments?.[0]), kind: "new URL", typeOnly: false, line: lineOf(node) });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return dependencies;
}

/** 型の宣言だけのファイルか(値・関数・クラス・列挙型・実行される文が無い) */
function nonTypeStatements(fileName: string, source: string): string[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  return file.statements
    .filter(
      (statement) =>
        !ts.isTypeAliasDeclaration(statement) &&
        !ts.isInterfaceDeclaration(statement) &&
        !(ts.isImportDeclaration(statement) && statement.importClause?.isTypeOnly) &&
        !(ts.isExportDeclaration(statement) && statement.isTypeOnly),
    )
    .map((statement) => `${file.getLineAndCharacterOfPosition(statement.getStart(file)).line + 1}行目: ${ts.SyntaxKind[statement.kind]}`);
}

/** ソース1つ分の依存の違反を、日本語のメッセージの一覧で返す。違反がなければ空 */
export function findBoundaryViolations(rule: LayerRule, filePath: string, source: string): string[] {
  const violations: string[] = [];
  for (const dependency of collectDependencies(filePath, source)) {
    const where = `${dependency.line}行目 ${dependency.kind}`;
    if (dependency.specifier === null) {
      violations.push(`${where}: 読み込む先が文字で決まっていません(文字列で直接書いてください)`);
      continue;
    }
    if (rule.typesOnly && !dependency.typeOnly) {
      violations.push(`${where}: ${rule.name} では、型の読み込み(import type)だけが使えます: ${dependency.specifier}`);
    }
    if (!dependency.specifier.startsWith(".")) {
      if (!rule.allowedPackages.includes(packageName(dependency.specifier))) {
        violations.push(`${where}: 許可されていない外部のパッケージです: ${dependency.specifier}`);
      }
      continue;
    }
    const resolved = path.resolve(path.dirname(filePath), dependency.specifier);
    if (isTestOnly(resolved)) {
      violations.push(`${where}: 本番のコードから、テスト用のファイルは読み込めません: ${dependency.specifier}`);
    } else if (!rule.allowedRoots.some((root) => isInside(root, resolved))) {
      violations.push(`${where}: ${rule.name} から読み込めない場所です: ${dependency.specifier}`);
    }
  }
  if (rule.typesOnly) {
    for (const statement of nonTypeStatements(filePath, source)) violations.push(`${statement}: ${rule.name} には型の宣言だけを置きます`);
  }
  return violations;
}

/** 規則の対象のファイル(テスト本体とテスト補助を除く) */
function listSourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listSourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) && !isTestOnly(full) ? [full] : [];
  });
}

function violationsIn(rule: LayerRule): string[] {
  const files = listSourceFiles(rule.root);
  expect(files.length).toBeGreaterThan(0);
  return files.flatMap((file) => findBoundaryViolations(rule, file, fs.readFileSync(file, "utf8")).map((v) => `${path.relative(SRC, file)} ${v}`));
}

/**
 * 指定した型の環境(lib)だけで型チェックし、エラーの一覧を返す。
 * ブラウザの型を含めないので、window・document・Canvas などを使うと「見つからない」エラーになる。
 */
function typeCheckWithLibs(rootFiles: string[], libs: string[]): string[] {
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: libs,
    types: [],
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    allowImportingTsExtensions: true,
  };
  const program = ts.createProgram(rootFiles, options);
  return ts
    .getPreEmitDiagnostics(program)
    .filter((diagnostic) => diagnostic.file && isInside(SRC, path.resolve(diagnostic.file.fileName)))
    .map((diagnostic) => {
      const { line } = diagnostic.file!.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
      return `${path.relative(SRC, path.resolve(diagnostic.file!.fileName))}:${line + 1} ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`;
    });
}

const ES_ONLY = ["lib.es2023.d.ts"];
const ES_AND_WORKER = ["lib.es2023.d.ts", "lib.webworker.d.ts"];

describe("dependency boundaries", () => {
  it("core imports only core and types", () => {
    expect(violationsIn(CORE_RULE)).toEqual([]);
  });

  it("io imports only io, core, types and its file-format packages", () => {
    expect(violationsIn(IO_RULE)).toEqual([]);
  });

  it("types contains only type declarations and imports only types", () => {
    expect(violationsIn(TYPES_RULE)).toEqual([]);
  });
});

describe("browser and runtime features (checked by TypeScript with restricted libraries)", () => {
  it("core and types type-check with plain ECMAScript only (no browser, no Node)", () => {
    expect(typeCheckWithLibs([...listSourceFiles(CORE), ...listSourceFiles(TYPES)], ES_ONLY)).toEqual([]);
  }, 60_000);

  it("io type-checks with ECMAScript and the web worker environment only (no DOM)", () => {
    expect(typeCheckWithLibs(listSourceFiles(IO), ES_AND_WORKER)).toEqual([]);
  }, 60_000);
});

describe("the checkers themselves", () => {
  const coreFile = path.join(CORE, "model", "sample.ts");
  const ioFile = path.join(IO, "dxf", "sample.ts");
  const typesFile = path.join(TYPES, "sample.ts");
  const coreViolations = (source: string) => findBoundaryViolations(CORE_RULE, coreFile, source);

  it("accepts imports inside core and types for core", () => {
    const source = `import { a } from "./ids";\nimport type { B } from "../../types/cad";\nimport { c } from "../geometry/geometry";\nexport * from "./convert";`;
    expect(coreViolations(source)).toEqual([]);
  });

  it("rejects utils, cad-view, io, components and every package for core, in every import form", () => {
    expect(coreViolations(`import { f } from "../../utils/format";`)).toHaveLength(1);
    expect(coreViolations(`import { x } from "../../cad-view/renderer/CanvasRenderer";`)).toHaveLength(1);
    expect(coreViolations(`import { y } from "../../io/dxf/DxfParserAdapter";`)).toHaveLength(1);
    expect(coreViolations(`export { Toolbar } from "../../components/Toolbar";`)).toHaveLength(1);
    expect(coreViolations(`import React from "react";`)).toHaveLength(1);
    expect(coreViolations("const ui = await import(`../../components/Toolbar`);")).toHaveLength(1);
    expect(coreViolations(`type T = typeof import("../../components/Toolbar");`)).toHaveLength(1);
    expect(coreViolations(`const marker = "//"; const ui = import("../../components/Toolbar");`)).toHaveLength(1);
  });

  it("rejects dynamic imports whose target is not written as a literal", () => {
    expect(coreViolations(`const target = "../../components/Toolbar";\nconst ui = await import(target);`)).toHaveLength(1);
  });

  it("does not treat imports written inside strings or comments as dependencies", () => {
    expect(coreViolations("const example = `import React from \"react\"`;\n// import x from \"react\";")).toEqual([]);
  });

  it("rejects production code that imports test-only files", () => {
    expect(coreViolations(`import { encode } from "../../io/dxf/testHelpers";`)).toHaveLength(1);
    expect(coreViolations(`import { x } from "./document.test";`)).toHaveLength(1);
    expect(coreViolations(`import { factoryLayoutDxf } from "../../regression/fixtures";`)).toHaveLength(1);
  });

  it("allows only the WASM folder of node_modules for io, not the rest", () => {
    const ok = [
      `import DxfParser from "dxf-parser";`,
      `import createModule from "../../../node_modules/@mlightcad/libredwg-web/wasm/libredwg-web.js";`,
      `const url = new URL("../../../node_modules/@mlightcad/libredwg-web/wasm/libredwg-web.wasm", import.meta.url);`,
      `import { applyMatrix } from "../../core/geometry/matrix2d";`,
    ].join("\n");
    expect(findBoundaryViolations(IO_RULE, ioFile, ok)).toEqual([]);
    expect(findBoundaryViolations(IO_RULE, ioFile, `import React from "../../../node_modules/react/index.js";`)).toHaveLength(1);
    expect(findBoundaryViolations(IO_RULE, ioFile, `import { CadCanvas } from "../../cad-view/CadCanvas";`)).toHaveLength(1);
  });

  it("allows only type declarations and type imports in types, so it cannot be a bridge to other layers", () => {
    expect(findBoundaryViolations(TYPES_RULE, typesFile, `import type { A } from "./cad";\nexport type B = A;\nexport interface C { x: number }`)).toEqual([]);
    expect(findBoundaryViolations(TYPES_RULE, typesFile, `export { Toolbar } from "../components/Toolbar";`).length).toBeGreaterThan(0);
    expect(findBoundaryViolations(TYPES_RULE, typesFile, `export const value = 1;`)).toHaveLength(1);
  });

  it("treats a file name that only starts with '..' as inside the folder", () => {
    expect(coreViolations(`import { a } from "./..cache";`)).toEqual([]);
  });

  it("detects browser features through type checking, without being fooled by names, strings or templates", () => {
    const dir = fs.mkdtempSync(path.join(CORE, ".tmp-arch-"));
    try {
      const write = (name: string, body: string) => {
        const file = path.join(dir, name);
        fs.writeFileSync(file, body);
        return file;
      };
      const violating = [
        write("a.ts", `export const c = document["createElement"]("canvas");`),
        write("b.ts", `export const e = document.getElementsByTagName("canvas");`),
        write("c.ts", `export const s = globalThis["localStorage"];`),
        write("d.ts", "export const t = `${window.innerWidth}`;"),
        write("e.ts", `export const ctx: CanvasRenderingContext2D | null = null;`),
      ];
      const fine = write("f.ts", `const document = { head: 1 };\nexport const options = { window: 10, mode: "window" as const, d: document.head };\nexport const pattern = /window/;`);
      for (const file of violating) expect(typeCheckWithLibs([file], ES_ONLY).length, path.basename(file)).toBeGreaterThan(0);
      expect(typeCheckWithLibs([fine], ES_ONLY)).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
