import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../apps-script/", import.meta.url);
const sheetDefinitions = {
  "系统设置": ["key", "value", "updatedAt"],
  "活动": ["eventId", "title", "description", "status", "opensAt", "closesAt", "location", "selectionMode", "minChoices", "maxChoices", "seatMode", "seatZones", "createdAt", "updatedAt"],
  "场次": ["sessionId", "eventId", "title", "speaker", "startsAt", "endsAt", "required", "capacity", "status", "createdAt", "updatedAt"],
  "座位": ["seatId", "eventId", "sessionId", "label", "zone", "status", "holderRegistrationId", "createdAt", "updatedAt"],
  "报名问题": ["questionId", "eventId", "label", "type", "required", "options", "sortOrder", "status", "createdAt", "updatedAt"],
  "参加者": ["participantId", "name", "phone", "email", "createdAt", "updatedAt"],
  "报名项目": ["registrationId", "eventId", "participantId", "ticketNumber", "status", "sessionIds", "seatChoices", "answers", "createdAt", "updatedAt"],
  "签到记录": ["checkInId", "registrationId", "eventId", "checkedInAt", "checkedInBy", "status"],
  "操作记录": ["auditId", "action", "entityType", "entityId", "actor", "details", "createdAt"]
};

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function source(name) {
  return readFile(new URL(name, root), "utf8");
}

test("Apps Script repository declares every private sheet with explicit headers", async () => {
  const repository = await source("Repository.gs");
  for (const [sheetName, headers] of Object.entries(sheetDefinitions)) {
    const exactArray = headers.map((header) => `['\"]${escapeRegex(header)}['\"]`).join("\\s*,\\s*");
    assert.match(repository, new RegExp(`['\"]${escapeRegex(sheetName)}['\"]\\s*:\\s*\\[\\s*${exactArray}\\s*\\]`));
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
  assert.match(repository, /function\s+hasExactHeaderRow_\s*\(/);
  assert.match(repository, /insertRowsBefore\(1\s*,\s*1\)/);
  assert.match(repository, /headers\.every\(/);
  assert.match(repository, /function\s+addSampleDraftEventIfEmpty_\s*\(/);
  assert.match(repository, /openById\(spreadsheetId\)/);
  assert.match(repository, /setProperty\(ACTIVE_SPREADSHEET_ID/);
  assert.doesNotMatch(repository, /deleteSheet|deleteRows|clear\(|clearContent\(|deleteRow/);
  assert.doesNotMatch(repository, /["'][A-Za-z0-9_-]{30,}["']/);
  assert.doesNotMatch(repository, /password|allowlist|secret/i);

  const appendBody = repository.match(/function\s+appendRow\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/)?.[1] || "";
  const updateBody = repository.match(/function\s+updateRow\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/)?.[1] || "";
  assert.doesNotMatch(`${appendBody}\n${updateBody}`, /initializeSpreadsheet_|addSampleDraftEventIfEmpty_/);
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
  assert.deepEqual(parsed.oauthScopes, ["https://www.googleapis.com/auth/spreadsheets"]);
  assert.equal(parsed.webapp.access, "ANYONE_ANONYMOUS");
});
