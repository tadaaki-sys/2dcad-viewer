// CAD Core(src/core)の依存の境界を守るテスト。
// coreは「画面にも、DXFにも依存しない」。読み込んでよいのは、coreの中、src/types(型だけ)、src/utils(純粋な計算)だけ。
// React・DOM・dxf-parser・cad-view・components・dxf などを読み込むと、このテストが失敗する。
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve("src");
const CORE = path.join(SRC, "core");
const ALLOWED_ROOTS = [CORE, path.join(SRC, "types"), path.join(SRC, "utils")];

// 画面・ブラウザに依存するもの(識別子の単語として現れたら違反)
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

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/** ソース1つ分の違反を、日本語のメッセージの一覧で返す。違反がなければ空 */
export function findBoundaryViolations(filePath: string, source: string): string[] {
  const violations: string[] = [];
  const code = stripComments(source);

  for (const match of code.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*["']([^"']+)["']/g)) {
    const specifier = match[1];
    if (!specifier.startsWith(".")) {
      violations.push(`外部のパッケージを読み込んでいます: ${specifier}`);
      continue;
    }
    const resolved = path.resolve(path.dirname(filePath), specifier);
    if (!ALLOWED_ROOTS.some((root) => isInside(root, resolved))) {
      violations.push(`coreの外(許可されていない場所)を読み込んでいます: ${specifier}`);
    }
  }

  for (const name of FORBIDDEN_GLOBALS) {
    if (new RegExp(`\\b${name}\\b`).test(code)) violations.push(`画面・ブラウザ依存の名前を使っています: ${name}`);
  }
  return violations;
}

function listSourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listSourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

describe("src/core dependency boundary", () => {
  it("core source files import nothing outside core / types / utils and use no browser globals", () => {
    const files = listSourceFiles(CORE);
    expect(files.length).toBeGreaterThan(0);
    const problems = files.flatMap((file) => findBoundaryViolations(file, fs.readFileSync(file, "utf8")).map((v) => `${path.relative(SRC, file)}: ${v}`));
    expect(problems).toEqual([]);
  });
});

describe("findBoundaryViolations (the checker itself)", () => {
  const file = path.join(CORE, "model", "sample.ts");

  it("accepts imports inside core, types and utils", () => {
    const source = `import { a } from "./ids";\nimport type { B } from "../../types/cad";\nimport { c } from "../../utils/geometry";`;
    expect(findBoundaryViolations(file, source)).toEqual([]);
  });

  it("rejects external packages", () => {
    expect(findBoundaryViolations(file, `import React from "react";`)).toHaveLength(1);
    expect(findBoundaryViolations(file, `import DxfParser from "dxf-parser";`)).toHaveLength(1);
    expect(findBoundaryViolations(file, `const m = await import("@mlightcad/libredwg-web");`)).toHaveLength(1);
  });

  it("rejects relative imports of cad-view, dxf and components", () => {
    expect(findBoundaryViolations(file, `import { x } from "../../cad-view/spatial/entityBounds";`)).toHaveLength(1);
    expect(findBoundaryViolations(file, `import { y } from "../../dxf/DxfParserAdapter";`)).toHaveLength(1);
    expect(findBoundaryViolations(file, `import { z } from "../../components/Toolbar";`)).toHaveLength(1);
  });

  it("rejects browser globals but ignores them in comments", () => {
    expect(findBoundaryViolations(file, `const w = window.innerWidth;`)).toHaveLength(1);
    expect(findBoundaryViolations(file, `const p = new Path2D();`)).toHaveLength(1);
    expect(findBoundaryViolations(file, `// window や Path2D を使わない\n/* localStorage */\nconst ok = 1;`)).toEqual([]);
  });
});
