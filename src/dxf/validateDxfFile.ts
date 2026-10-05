const BINARY_DXF_SENTINEL = "AutoCAD Binary DXF";
const SUPPORTED_EXTENSIONS = [".dxf", ".dwg"];

export type DxfValidationResult = { valid: true } | { valid: false; reason: "extension" | "binary" };

export async function validateDxfFile(file: File): Promise<DxfValidationResult> {
  const lowerCaseName = file.name.toLowerCase();
  if (!SUPPORTED_EXTENSIONS.some((extension) => lowerCaseName.endsWith(extension))) {
    return { valid: false, reason: "extension" };
  }

  const header = await file.slice(0, BINARY_DXF_SENTINEL.length).text();
  if (header === BINARY_DXF_SENTINEL) {
    return { valid: false, reason: "binary" };
  }

  return { valid: true };
}
