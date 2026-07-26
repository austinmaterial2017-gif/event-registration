import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

test("attendance schema migration inserts sessionId without turning the old header into data", async () => {
  const legacyHeader = ["checkInId", "registrationId", "eventId", "checkedInAt", "checkedInBy", "status"];
  const existing = ["c1", "r1", "e1", "2026-08-16T09:30:00.000Z", "staff@example.com", "checked_in"];
  const sheet = {
    rows: [legacyHeader.slice(), existing.slice()],
    getName: () => "签到记录",
    getLastRow() { return this.rows.length; },
    getRange(row, column, rowCount, columnCount) {
      return {
        getValues: () => Array.from({ length: rowCount }, (_, y) =>
          Array.from({ length: columnCount }, (_, x) => sheet.rows[row - 1 + y]?.[column - 1 + x] ?? "")),
        setValues: (values) => values.forEach((source, y) =>
          source.forEach((value, x) => { sheet.rows[row - 1 + y][column - 1 + x] = value; }))
      };
    },
    insertColumnAfter(column) {
      this.rows.forEach((row) => row.splice(column, 0, ""));
    },
    insertRowsBefore() {
      throw new Error("legacy attendance header must be migrated in place");
    }
  };
  const context = vm.createContext({ Date, JSON, Object, Array, String, Number, Error });
  const source = await readFile(new URL("../apps-script/Repository.gs", import.meta.url), "utf8");
  vm.runInContext(source, context);
  context.ensureHeaders_(sheet, Array.from(context.SHEET_DEFINITIONS["签到记录"]));

  assert.deepEqual(sheet.rows[0], ["checkInId", "registrationId", "eventId", "sessionId", "checkedInAt", "checkedInBy", "status"]);
  assert.deepEqual(sheet.rows[1], ["c1", "r1", "e1", "", "2026-08-16T09:30:00.000Z", "staff@example.com", "checked_in"]);
  assert.equal(sheet.rows.length, 2);
});

test("the configured spreadsheet can be opened before the shared settings sheet is initialized", async () => {
  const spreadsheet = {
    getSheetByName: () => null
  };
  const context = vm.createContext({
    Date, JSON, Object, Array, String, Number, Error,
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => key === "ACTIVE_SPREADSHEET_ID" ? "bootstrap-sheet" : null
      })
    },
    SpreadsheetApp: {
      openById: (spreadsheetId) => {
        assert.equal(spreadsheetId, "bootstrap-sheet");
        return spreadsheet;
      }
    }
  });
  const source = await readFile(new URL("../apps-script/Repository.gs", import.meta.url), "utf8");
  vm.runInContext(source, context);

  const registry = context.getRegistrySpreadsheet_();
  assert.equal(context.getConfiguredSpreadsheet(registry), spreadsheet);
});
