import { describe, expect, it } from "vitest";
import { stripObjectsSection } from "./stripObjectsSection";
import { parseDxfText } from "./DxfParserAdapter";

const toBytes = (lines: string[], eol = "\n") => new TextEncoder().encode(lines.join(eol) + eol);
const toText = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

const header = ["0", "SECTION", "2", "ENTITIES", "0", "LINE", "8", "0", "10", "0", "20", "0", "11", "1", "21", "0", "0", "ENDSEC"];
const objects = ["0", "SECTION", "2", "OBJECTS", "0", "SPATIAL_INDEX", "5", "ABC", "0", "GROUP", "0", "ENDSEC"];
const footer = ["0", "EOF"];

describe("stripObjectsSection", () => {
  it("removes the OBJECTS section and keeps everything else", () => {
    const result = toText(stripObjectsSection(toBytes([...header, ...objects, ...footer])));
    expect(result).toBe([...header, ...footer].join("\n") + "\n");
  });

  it("handles padded group codes and CRLF line endings", () => {
    const padded = (lines: string[]) => lines.map((line, i) => (i % 2 === 0 ? line.padStart(3) : line));
    const input = toBytes([...padded(header), ...padded(objects), ...padded(footer)], "\r\n");
    const text = toText(stripObjectsSection(input));
    expect(text).not.toContain("OBJECTS");
    expect(text).not.toContain("SPATIAL_INDEX");
    expect(text).toContain("ENTITIES");
    expect(text).toContain("EOF");
  });

  it("works when OBJECTS is in the middle and when it comes before other sections", () => {
    const tail = ["0", "SECTION", "2", "THUMBNAILIMAGE", "0", "ENDSEC"];
    const result = toText(stripObjectsSection(toBytes([...objects, ...header, ...tail, ...footer])));
    expect(result).toBe([...header, ...tail, ...footer].join("\n") + "\n");
  });

  it("does not treat the word OBJECTS inside other sections' values as the section", () => {
    const entities = ["0", "SECTION", "2", "ENTITIES", "0", "TEXT", "1", "OBJECTS", "0", "ENDSEC", ...footer];
    const input = toBytes(entities);
    expect(toText(stripObjectsSection(input))).toBe(toText(input));
  });

  it("returns the input unchanged when there is no OBJECTS section or it is not closed", () => {
    const noObjects = toBytes([...header, ...footer]);
    expect(stripObjectsSection(noObjects)).toBe(noObjects);
    const unclosed = toBytes(["0", "SECTION", "2", "OBJECTS", "0", "GROUP"]);
    expect(stripObjectsSection(unclosed)).toBe(unclosed);
  });

  it("still yields a DXF the parser accepts", () => {
    const stripped = toText(stripObjectsSection(toBytes([...header, ...objects, ...footer])));
    expect(parseDxfText(stripped).entities).toHaveLength(1);
  });
});
