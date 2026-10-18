import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("assisted installer launch", () => {
  it("launches the installed executable directly instead of a localized shortcut", () => {
    const template = readFileSync("assets/installer.nsh", "utf8");
    expect(template).toContain('StrCpy $launchLink "$INSTDIR\\Pianpian.exe"');
    expect(template).not.toContain("$newStartMenuLink");
  });
});
