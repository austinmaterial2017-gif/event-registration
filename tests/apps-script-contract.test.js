import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../apps-script/", import.meta.url);
const sheetNames = ["系统设置", "活动", "场次", "座位", "报名问题", "参加者", "报名项目", "签到记录", "操作记录"];

async function source(name) {
  return readFile(new URL(name, root), "utf8");
}

test("Apps Script repository declares every private sheet with explicit headers", async () => {
  const repository = await source("Repository.gs");
  for (const sheetName of sheetNames) {
    assert.match(repository, new RegExp(`['\"]${sheetName}['\"]\\s*:`));
  }
  assert.match(repository, /var\s+SHEET_DEFINITIONS\s*=/);
  assert.match(repository, /function\s+setupSystem\s*\(/);
  assert.match(repository, /function\s+getConfiguredSpreadsheet\s*\(/);
  assert.match(repository, /function\s+setActiveSpreadsheet\s*\(\s*spreadsheetId\s*\)/);
  assert.match(repository, /function\s+withScriptLock\s*\(\s*callback\s*\)/);
  assert.match(repository, /function\s+readRows\s*\(\s*sheetName\s*\)/);
  assert.match(repository, /function\s+appendRow\s*\(\s*sheetName\s*,\s*row\s*\)/);
  assert.match(repository, /function\s+updateRow\s*\(\s*sheetName\s*,\s*rowNumber\s*,\s*values\s*\)/);
});

test("repository uses script properties and script locks while preserving existing data", async () => {
  const repository = await source("Repository.gs");
  assert.match(repository, /PropertiesService\.getScriptProperties\(\)/);
  assert.match(repository, /LockService\.getScriptLock\(\)/);
  assert.match(repository, /lock\.waitLock\(/);
  assert.match(repository, /lock\.releaseLock\(/);
  assert.match(repository, /ACTIVE_SPREADSHEET_ID/);
  assert.match(repository, /ADMIN_SETTINGS/);
  assert.match(repository, /getLastRow\(\)\s*===\s*0/);
  assert.match(repository, /getLastRow\(\)\s*<=\s*1/);
  assert.match(repository, /openById\(spreadsheetId\)/);
  assert.match(repository, /setProperty\(ACTIVE_SPREADSHEET_ID/);
  assert.doesNotMatch(repository, /deleteSheet|deleteRows|clear\(|clearContent\(|deleteRow/);
  assert.doesNotMatch(repository, /["'][A-Za-z0-9_-]{30,}["']/);
  assert.doesNotMatch(repository, /password|allowlist|secret/i);
});

test("routing shells return safe public envelopes and the manifest has V8 scopes", async () => {
  const [code, manifest] = await Promise.all([source("Code.gs"), source("appsscript.json")]);
  assert.match(code, /function\s+doGet\s*\(/);
  assert.match(code, /function\s+doPost\s*\(/);
  assert.match(code, /ContentService\.MimeType\.JSON/);
  assert.match(code, /NOT_IMPLEMENTED/);
  assert.doesNotMatch(code, /\.stack|error\.message|exception\.message|spreadsheetId/i);

  const parsed = JSON.parse(manifest);
  assert.equal(parsed.runtimeVersion, "V8");
  assert.ok(parsed.oauthScopes.includes("https://www.googleapis.com/auth/spreadsheets"));
  assert.ok(parsed.oauthScopes.includes("https://www.googleapis.com/auth/script.scriptapp"));
  assert.equal(parsed.webapp.access, "ANYONE_ANONYMOUS");
});
