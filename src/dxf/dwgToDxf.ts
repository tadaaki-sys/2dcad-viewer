// パッケージのexportsは本体(wrapper)しか公開していないため、WASMのglueコードと.wasmは相対パスで直接参照する。
// 変換はブラウザ(Web Worker)内のWASMだけで完結し、DWGの中身は外部へ送信されない。
import createModule from "../../node_modules/@mlightcad/libredwg-web/wasm/libredwg-web.js";

const DWG_WASM_URL = new URL("../../node_modules/@mlightcad/libredwg-web/wasm/libredwg-web.wasm", import.meta.url).href;

// LibreDWGのエラーコードは、この値以上が致命的(出力できない)で、未満は警告(出力は有効)として扱われる。
const LIBREDWG_ERR_CRITICAL = 128;

const INPUT_FILE_NAME = "input.dwg";
const OUTPUT_FILE_NAME = "output.dxf";

export class DwgConversionError extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.name = "DwgConversionError";
    this.code = code;
  }
}

/** DWGのバイナリをLibreDWG(WASM)でDXFテキストのバイト列へ変換する。 */
export async function convertDwgToDxfBuffer(dwgBuffer: ArrayBuffer): Promise<ArrayBuffer> {
  const wasm = await createModule({
    locateFile: (fileName: string) => (fileName.endsWith(".wasm") ? DWG_WASM_URL : fileName),
  });

  try {
    wasm.FS.writeFile(INPUT_FILE_NAME, new Uint8Array(dwgBuffer));

    let errorCode: number;
    try {
      errorCode = wasm.dwg_write_dxf(INPUT_FILE_NAME, OUTPUT_FILE_NAME);
    } catch (cause) {
      throw new DwgConversionError(-1, `DWG変換中にWASMが異常終了しました: ${String(cause)}`);
    }

    const hasOutput = wasm.FS.analyzePath(OUTPUT_FILE_NAME, false).exists;
    if (errorCode >= LIBREDWG_ERR_CRITICAL || !hasOutput) {
      throw new DwgConversionError(errorCode, `DWGをDXFへ変換できませんでした(エラーコード ${errorCode})`);
    }
    if (errorCode !== 0) {
      console.warn("[dwgToDxf] LibreDWG reported non-critical warnings", { errorCode });
    }

    const output = wasm.FS.readFile(OUTPUT_FILE_NAME);
    return output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength) as ArrayBuffer;
  } finally {
    for (const name of [INPUT_FILE_NAME, OUTPUT_FILE_NAME]) {
      if (wasm.FS.analyzePath(name, false).exists) wasm.FS.unlink(name);
    }
  }
}
