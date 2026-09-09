import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

test("bundle repository exposes dedicated-sheet initialization without changing ordinary definitions", async () => {
  const context = vm.createContext({ Object, Array, String, Number, JSON });
  const repository = await readFile(new URL("../apps-script/Repository.gs", import.meta.url), "utf8");
  vm.runInContext(repository, context);
  const ordinaryDefinitions = JSON.stringify(context.SHEET_DEFINITIONS);

  assert.equal(typeof context.initializeBundleSpreadsheet_, "function");
  assert.equal(JSON.stringify(context.SHEET_DEFINITIONS), ordinaryDefinitions);
});
