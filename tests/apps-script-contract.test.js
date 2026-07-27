import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../apps-script/", import.meta.url);
const sheetDefinitions = {
  "系统设置": ["key", "value", "updatedAt"],
  "活动目录": ["eventId", "spreadsheetId", "sheetName", "title", "description", "status", "opensAt", "closesAt", "location", "selectionMode", "minChoices", "maxChoices", "seatMode", "seatZones", "createdAt", "updatedAt"],
  "票券索引": ["ticketNumber", "tokenDigest", "eventId", "registrationId", "status", "createdAt", "updatedAt"],
  "活动": ["eventId", "title", "description", "status", "opensAt", "closesAt", "location", "selectionMode", "minChoices", "maxChoices", "seatMode", "seatZones", "createdAt", "updatedAt"],
  "场次": ["sessionId", "eventId", "title", "speaker", "startsAt", "endsAt", "required", "capacity", "status", "createdAt", "updatedAt"],
  "座位": ["seatId", "eventId", "sessionId", "label", "zone", "status", "holderRegistrationId", "createdAt", "updatedAt"],
  "报名问题": ["questionId", "eventId", "label", "type", "required", "options", "sortOrder", "status", "createdAt", "updatedAt"],
  "参加者": ["participantId", "name", "phone", "email", "createdAt", "updatedAt"],
  "报名项目": ["registrationId", "eventId", "participantId", "ticketNumber", "status", "sessionIds", "seatChoices", "answers", "createdAt", "updatedAt"],
  "签到记录": ["checkInId", "registrationId", "eventId", "sessionId", "checkedInAt", "checkedInBy", "status"],
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
  assert.match(repository, /function\s+readRows\s*\(\s*spreadsheet\s*,\s*sheetName\s*\)/);
  assert.match(repository, /function\s+appendRow\s*\(\s*sheetName\s*,\s*row\s*\)/);
  assert.match(repository, /function\s+updateRow\s*\(\s*sheetName\s*,\s*rowNumber\s*,\s*values\s*\)/);
  for (const name of [
    "initializeRegistrySpreadsheet_",
    "initializeEventSpreadsheet_",
    "getEventCatalogEntry_",
    "getEventSpreadsheet_",
    "getTicketRouteByNumber_",
    "getTicketRouteByToken_",
    "upsertTicketRoute_",
    "digestTicketToken_"
  ]) {
    assert.match(repository, new RegExp(`function\\s+${name}\\s*\\(`));
  }
  assert.match(repository, /var\s+REGISTRY_SHEET_NAMES_\s*=/);
  assert.match(repository, /var\s+EVENT_SHEET_NAMES_\s*=/);
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
  assert.doesNotMatch(code, /parameter\.view\s*===\s*['"]staff['"]|getStaffCheckInPage|StaffCheckIn/);
  assert.match(code, /function\s+doPost\s*\(/);
  assert.match(code, /ContentService\.MimeType\.JSON/);
  assert.match(code, /NOT_IMPLEMENTED/);
  assert.doesNotMatch(code, /\.stack|error\.message|exception\.message|spreadsheetId/i);

  const parsed = JSON.parse(manifest);
  assert.equal(parsed.runtimeVersion, "V8");
  assert.ok(parsed.oauthScopes.includes("https://www.googleapis.com/auth/spreadsheets"));
  assert.deepEqual(parsed.oauthScopes, [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive"
  ]);
  assert.equal(parsed.webapp.access, "ANYONE_ANONYMOUS");
});

test("registration service validates every server-authoritative rule inside one script lock", async () => {
  const registration = await source("RegistrationService.gs");
  assert.match(registration, /function\s+createRegistration\s*\(\s*payload\s*\)/);
  const createBody = registration.match(/function\s+createRegistration\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/)?.[1] || "";
  assert.match(createBody, /withScriptLock\s*\(\s*function\s*\(\s*\)/);
  for (const helper of [
    "requireOpenEvent_",
    "validateDynamicAnswers_",
    "validateSessionSelection_",
    "validateSessionCapacity_",
    "validateDuplicateIdentity_",
    "validateSessionConflicts_",
    "selectRegistrationSeats_"
  ]) {
    assert.match(registration, new RegExp(`function\\s+${helper}\\s*\\(`));
    assert.match(createBody, new RegExp(`${helper}\\s*\\(`));
  }
  assert.match(registration, /event\.status\s*!==\s*['"]open['"]/);
  assert.match(registration, /opensAt|closesAt/);
  assert.match(registration, /selectionMode|minChoices|maxChoices|required/);
  assert.match(registration, /capacity/);
  assert.match(registration, /identityFields/);
  assert.match(registration, /startsAt|endsAt/);
  assert.match(registration, /seatMode|held|holdOwner|holdExpiresAt/);
});

test("registration writes use pending batches, activate last, and expose recovery for failed cleanup", async () => {
  const registration = await source("RegistrationService.gs");
  assert.match(registration, /selectedSessions\.map\s*\(/);
  assert.match(registration, /appendParticipantRow_/);
  assert.match(registration, /appendRegistrationRows_/);
  assert.match(registration, /getRange\(rowNumber,\s*1,\s*pendingRows\.length,\s*pendingRows\[0\]\.length\)\.setValues\(pendingRows\)/);
  assert.match(registration, /status:\s*['"]pending['"]/);
  assert.match(registration, /claimPendingRegistrationSeats_/);
  assert.match(registration, /activateRegistrationRows_/);
  assert.match(registration, /catch\s*\([^)]*\)\s*\{[\s\S]*cleanupPendingRegistration_/);
  assert.match(registration, /function\s+recoverPendingTransactions_\s*\(/);
  assert.match(registration, /status\s*===\s*['"]pending['"]\)\s*return\s+false/);
  assert.match(registration, /recoveryFailures\.length/);
  assert.match(registration, /deleteRow\s*\(/);
  assert.match(registration, /restoreSeatSnapshots_/);
  assert.match(registration, /EVT-\s*['"]?\s*\+\s*Utilities\.getUuid\(\)\.replace\(\/-\/g,\s*['"]{2}\)\.slice\(0,\s*10\)\.toUpperCase\(\)/);
  assert.match(registration, /Utilities\.getUuid\(\)\.replace\(\/-\/g,\s*['"]{2}\)\s*\+\s*Utilities\.getUuid\(\)\.replace\(\/-\/g,\s*['"]{2}\)/);
});

test("ticket lookup, cancellation, and exchange preserve privacy and historical records", async () => {
  const ticket = await source("TicketService.gs");
  for (const name of ["lookupTicket", "cancelRegistration", "exchangeSeat"]) {
    assert.match(ticket, new RegExp(`function\\s+${name}\\s*\\(\\s*payload\\s*\\)`));
  }
  assert.match(ticket, /verificationValue/);
  assert.match(ticket, /maskPrivateValue_/);
  assert.match(ticket, /maskName_/);
  assert.match(ticket, /seatExchangeEnabled/);
  assert.match(ticket, /rotateTicketToken_/);
  assert.match(ticket, /restoreExchangeSnapshots_/);
  assert.match(ticket, /appendTicketAudit_/);
  assert.match(ticket, /cleanupStaleTicketSeats_/);
  assert.match(ticket, /EXCHANGE_PENDING_CLEANUP/);
  assert.match(ticket, /SEAT_RELEASE_RETRY/);
  assert.match(ticket, /SEAT_RELEASE_RESOLVED/);
  const lookupBody = ticket.match(/function\s+lookupTicket\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/)?.[1] || "";
  assert.match(lookupBody, /withScriptLock\s*\(\s*function\s*\(\s*\)/);
  assert.match(ticket, /status\s*=\s*['"]cancelled['"]/);
  const cancelBody = ticket.match(/function\s+cancelRegistration\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/)?.[1] || "";
  assert.match(cancelBody, /withScriptLock\s*\(\s*function\s*\(\s*\)/);
  assert.match(cancelBody, /match\.status\s*=\s*['"]cancelled['"]/);
  assert.doesNotMatch(cancelBody, /deleteRow|deleteRows/);
  const exchangeBody = ticket.match(/function\s+exchangeSeat\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/)?.[1] || "";
  assert.match(exchangeBody, /withScriptLock\s*\(\s*function\s*\(\s*\)/);
  assert.match(exchangeBody, /catch\s*\([^)]*\)\s*\{[\s\S]*restoreExchangeSnapshots_/);
  assert.doesNotMatch(ticket, /sheetId|spreadsheetId|stack|rowNumber\s*:/i);
});

test("doPost uses a fixed Task 3 route allowlist and never reflects private errors", async () => {
  const code = await source("Code.gs");
  for (const action of ["listEvents", "getEvent", "createRegistration", "lookupTicket", "verifyTicket"]) {
    assert.match(code, new RegExp(`['"]${action}['"]\\s*:`));
  }
  assert.match(code, /JSON\.parse\s*\(/);
  assert.match(code, /PUBLIC_ERROR_MESSAGES/);
  assert.match(code, /Object\.prototype\.hasOwnProperty\.call\s*\(\s*PUBLIC_ROUTES/);
  assert.match(code, /ContentService\.MimeType\.JSON/);
  assert.doesNotMatch(code, /\.stack|error\.message|exception\.message|spreadsheetId/i);
});

test("public attendance service is verification-only and exposes no staff mutation surface", async () => {
  const [attendance, code] = await Promise.all([source("AttendanceService.gs"), source("Code.gs")]);
  assert.match(attendance, /function\s+verifyTicket\s*\(\s*payload\s*\)/);
  assert.match(attendance, /withScriptLock\s*\(\s*function\s*\(\s*\)/);
  assert.match(attendance, /sessionId/);
  assert.doesNotMatch(attendance, /function\s+checkIn|ATTENDANCE_STAFF_ALLOWLIST|Session\.getActiveUser|StaffCheckIn|ALREADY_CHECKED_IN/);
  assert.doesNotMatch(code, /['"]checkIn['"]\s*:/);
});
