// src/desktop/shared/appErrors.test.ts
import { describe, expect, it } from "bun:test";
import { CodedError, errorCodeOf } from "./appErrors.ts";

describe("errorCodeOf", () => {
  it("findet den Code auch hinter Electrons Praefix", () => {
    const ueberIpc = new Error(
      `Error invoking remote method 'archive:import': Error: ${new CodedError("archiveImportBusy").message}`,
    );
    expect(errorCodeOf(ueberIpc)).toBe("archiveImportBusy");
  });

  it("liefert null fuer gewoehnliche und unbekannte Fehler", () => {
    expect(errorCodeOf(new Error("ENOENT"))).toBeNull();
    expect(errorCodeOf(new Error("US_ERR:gibtEsNicht"))).toBeNull();
    expect(errorCodeOf("US_ERR:repairBusy")).toBe("repairBusy");
  });
});
