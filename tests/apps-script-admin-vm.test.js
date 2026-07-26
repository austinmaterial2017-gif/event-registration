import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";

const staffScriptRoot = new URL("../staff-apps-script/", import.meta.url);
const publicScriptRoot = new URL("../apps-script/", import.meta.url);
const switchProbeSecret = "test-switch-probe-secret-with-32-bytes";

const headers = {
  "系统设置": ["key", "value", "updatedAt"],
  "活动": ["eventId", "title", "description", "status", "opensAt", "closesAt", "location", "selectionMode", "minChoices", "maxChoices", "seatMode", "seatZones", "createdAt", "updatedAt"],
  "场次": ["sessionId", "eventId", "title", "speaker", "startsAt", "endsAt", "required", "capacity", "status", "createdAt", "updatedAt"],
  "座位": ["seatId", "eventId", "sessionId", "label", "zone", "status", "holderRegistrationId", "createdAt", "updatedAt"],
  "报名问题": ["questionId", "eventId", "label", "type", "required", "options", "sortOrder", "status", "createdAt", "updatedAt"],
  "参加者": ["participantId", "name", "phone", "email", "createdAt", "updatedAt"],
  "报名项目": ["registrationId", "eventId", "participantId", "ticketNumber", "status", "sessionIds", "seatChoices", "answers", "createdAt", "updatedAt"],
  "签到记录": ["checkInId", "registrationId", "eventId", "sessionId", "checkedInAt", "checkedInBy", "status"],
  "操作记录": ["auditId", "action", "entityType", "entityId", "actor", "details", "createdAt"]
};

class FakeSheet {
  constructor(name, records = []) {
    this.name = name;
    this.rows = [headers[name], ...records.map((record) => headers[name].map((key) => record[key] ?? ""))];
    this.writeCount = 0;
    this.writeAttemptCount = 0;
    this.writeErrorsByAttempt = new Map();
    this.afterWriteCallbacks = [];
    this.afterReadCallbacks = [];
  }

  failNextWrite(error = new Error(`injected ${this.name} write failure`)) {
    this.failWriteOnAttempt(this.writeAttemptCount + 1, error);
  }
  failWriteOnAttempt(attempt, error = new Error(`injected ${this.name} write failure`)) {
    this.writeErrorsByAttempt.set(attempt, error);
  }
  consumeWriteFailure() {
    this.writeAttemptCount += 1;
    const error = this.writeErrorsByAttempt.get(this.writeAttemptCount);
    this.writeErrorsByAttempt.delete(this.writeAttemptCount);
    if (error) throw error;
  }
  afterNextWrite(callback) {
    this.afterWriteCallbacks.push(callback);
  }
  afterNextRead(callback) {
    this.afterReadCallbacks.push(callback);
  }
  notifyWrite() {
    const callback = this.afterWriteCallbacks.shift();
    if (callback) callback();
  }
  notifyRead() {
    const callback = this.afterReadCallbacks.shift();
    if (callback) callback();
  }
  getName() { return this.name; }
  getLastRow() { return this.rows.length; }
  getLastColumn() { return headers[this.name].length; }
  appendRow(values) {
    this.consumeWriteFailure();
    this.writeCount += 1;
    this.rows.push([...values]);
    this.notifyWrite();
  }
  getRange(row, column, rowCount, columnCount) {
    return {
      getValues: () => {
        const values = Array.from({ length: rowCount }, (_, y) =>
          Array.from({ length: columnCount }, (_, x) => this.rows[row - 1 + y]?.[column - 1 + x] ?? ""));
        this.notifyRead();
        return values;
      },
      setValues: (values) => {
        this.consumeWriteFailure();
        this.writeCount += 1;
        values.forEach((source, y) => {
          const target = this.rows[row - 1 + y] || [];
          source.forEach((value, x) => { target[column - 1 + x] = value; });
          this.rows[row - 1 + y] = target;
        });
        this.notifyWrite();
      }
    };
  }
}

function baseRows() {
  return {
    "系统设置": [],
    "活动": [{
      eventId: "event-1", title: "Ideas Forum", description: "Private notes stay private",
      status: "open", opensAt: "2026-08-01T00:00:00Z", closesAt: "2026-08-15T00:00:00Z",
      location: "Main Hall", selectionMode: "free", minChoices: 1, maxChoices: 2,
      seatMode: "self", seatZones: JSON.stringify(["A"]), createdAt: "2026-07-01T00:00:00Z",
      updatedAt: "2026-07-01T00:00:00Z"
    }],
    "场次": [{
      sessionId: "session-1", eventId: "event-1", title: "Opening", speaker: "Dr Lin",
      startsAt: "2026-08-16T09:00:00Z", endsAt: "2026-08-16T10:00:00Z",
      required: true, capacity: 50, status: "open",
      createdAt: "2026-07-01T00:00:00Z", updatedAt: "2026-07-01T00:00:00Z"
    }],
    "座位": [
      {
        seatId: "seat-old", eventId: "event-1", sessionId: "session-1", label: "A-01",
        zone: "A", status: "registered", holderRegistrationId: "registration-1",
        createdAt: "2026-07-01T00:00:00Z", updatedAt: "2026-07-01T00:00:00Z"
      },
      {
        seatId: "seat-new", eventId: "event-1", sessionId: "session-1", label: "A-02",
        zone: "A", status: "available", holderRegistrationId: "",
        createdAt: "2026-07-01T00:00:00Z", updatedAt: "2026-07-01T00:00:00Z"
      }
    ],
    "报名问题": [{
      questionId: "email", eventId: "event-1", label: "Email", type: "email", required: true,
      options: "{}", sortOrder: 1, status: "active",
      createdAt: "2026-07-01T00:00:00Z", updatedAt: "2026-07-01T00:00:00Z"
    }],
    "参加者": [{
      participantId: "person-1", name: "Alice Chan", phone: "0123456789",
      email: "alice@example.com", createdAt: "2026-07-01T00:00:00Z",
      updatedAt: "2026-07-01T00:00:00Z"
    }],
    "报名项目": [
      {
        registrationId: "registration-1", eventId: "event-1", participantId: "person-1",
        ticketNumber: "EVT-PRIVATE-001", status: "active",
        sessionIds: JSON.stringify(["session-1"]), seatChoices: JSON.stringify(["seat-old"]),
        answers: JSON.stringify({
          values: { email: "alice@example.com", privateNote: "secret answer" },
          ticketToken: "opaque-private-ticket-token",
          verificationField: "email"
        }),
        createdAt: "2026-07-01T00:00:00Z", updatedAt: "2026-07-01T00:00:00Z"
      },
      {
        registrationId: "registration-1", eventId: "event-1", participantId: "person-1",
        ticketNumber: "EVT-PRIVATE-001", status: "active",
        sessionIds: JSON.stringify(["session-1"]), seatChoices: JSON.stringify(["seat-old"]),
        answers: JSON.stringify({
          values: { email: "alice@example.com", privateNote: "secret answer" },
          ticketToken: "opaque-private-ticket-token",
          verificationField: "email"
        }),
        createdAt: "2026-07-01T00:00:00Z", updatedAt: "2026-07-01T00:00:00Z"
      }
    ],
    "签到记录": [{
      checkInId: "check-1", registrationId: "registration-1", eventId: "event-1",
      sessionId: "session-1", checkedInAt: "2026-08-16T09:05:00Z",
      checkedInBy: "staff@example.com", status: "checked_in"
    }],
    "操作记录": []
  };
}

function records(sheet) {
  return sheet.rows.slice(1).map((values) =>
    Object.fromEntries(headers[sheet.name].map((key, index) => [key, values[index]])));
}

function registryValue(harness, key) {
  const row = records(harness.sourceSheets["系统设置"]).find((candidate) => candidate.key === key);
  return row ? row.value : null;
}

function setRegistryValue(harness, key, value) {
  const sheet = harness.sourceSheets["系统设置"];
  const keyColumn = headers["系统设置"].indexOf("key");
  const valueColumn = headers["系统设置"].indexOf("value");
  const updatedAtColumn = headers["系统设置"].indexOf("updatedAt");
  const row = sheet.rows.slice(1).find((candidate) => candidate[keyColumn] === key);
  if (row) {
    row[valueColumn] = value;
    row[updatedAtColumn] = "2026-07-26T04:00:00Z";
  } else {
    sheet.rows.push([key, value, "2026-07-26T04:00:00Z"]);
  }
}

function readHarnessAdminSettings(harness) {
  const shared = records(harness.sourceSheets["系统设置"])
    .find((row) => row.key === "ADMIN_SETTINGS");
  return JSON.parse(shared ? shared.value : harness.properties.ADMIN_SETTINGS);
}

function settingsStorageSnapshot(harness) {
  return JSON.stringify({
    shared: records(harness.sourceSheets["系统设置"]),
    legacyProperty: harness.properties.ADMIN_SETTINGS
  });
}

function cloneRows(rows) {
  return Object.fromEntries(Object.entries(rows).map(([name, values]) =>
    [name, values.map((value) => ({ ...value }))]));
}

async function createHarness(options = {}) {
  const defaultAdminSettings = {
    registration: {
      identityFields: [],
      events: {
        "event-1": {
          seatExchangeEnabled: true,
          cancellationEnabled: true,
          showOpeningCountdown: true,
          showClosingCountdown: true,
          identityFields: ["email"],
          showOnTicketFields: []
        }
      }
    }
  };
  const properties = {
    ACTIVE_SPREADSHEET_ID: "source-sheet-id",
    ATTENDANCE_STAFF_ALLOWLIST: JSON.stringify(options.staffAllowlist || ["admin@example.com"]),
    ADMIN_EMAIL_ALLOWLIST: JSON.stringify(options.adminAllowlist || ["admin@example.com"]),
    ADMIN_SETTINGS: JSON.stringify(options.adminSettings || defaultAdminSettings),
    PUBLIC_BACKEND_URL: "https://script.google.com/macros/s/public-deployment/exec",
    SWITCH_PROBE_SHARED_SECRET: switchProbeSecret
  };
  const sourceRows = cloneRows(options.rows || baseRows());
  if (options.seedRegistrySettings !== false &&
      !sourceRows["系统设置"].some((row) => row.key === "ADMIN_SETTINGS")) {
    sourceRows["系统设置"].push({
      key: "ADMIN_SETTINGS",
      value: JSON.stringify(options.adminSettings || defaultAdminSettings),
      updatedAt: "2026-07-01T00:00:00Z"
    });
  }
  const sourceSheets = Object.fromEntries(Object.entries(sourceRows)
    .map(([name, values]) => [name, new FakeSheet(name, values)]));
  const targetSheets = Object.fromEntries(Object.entries(cloneRows(options.targetRows || baseRows()))
    .map(([name, values]) => [name, new FakeSheet(name, values)]));
  const spreadsheets = {
    "source-sheet-id": {
      getId: () => "source-sheet-id",
      getName: () => "Source Registration Data",
      getSheetByName: (name) => sourceSheets[name] || null
    },
    "target-sheet-id": {
      getId: () => "target-sheet-id",
      getName: () => "Target Registration Data",
      getSheetByName: (name) => targetSheets[name] || null
    }
  };
  const locks = [];
  let lockDepth = 0;
  let uuid = 0;
  const RealDate = Date;
  let serverNow = options.nowIso || "2026-07-26T04:00:00Z";
  class ServerDate extends RealDate {
    constructor(value) { super(value === undefined ? serverNow : value); }
    static now() { return RealDate.parse(serverNow); }
  }
  const context = vm.createContext({
    JSON, Object, Array, String, Number, RegExp, Error, Math, isFinite, Date: ServerDate,
    Session: {
      getActiveUser: () => ({ getEmail: () => options.sessionEmail || "admin@example.com" })
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => properties[key] ?? null,
        setProperty: (key, value) => {
          properties[key] = value;
        }
      })
    },
    SpreadsheetApp: {
      openById: (spreadsheetId) => {
        if (!spreadsheets[spreadsheetId]) throw new Error("missing spreadsheet");
        return spreadsheets[spreadsheetId];
      }
    },
    LockService: {
      getScriptLock: () => ({
        waitLock: () => {
          assert.equal(lockDepth, 0, "nested lock");
          lockDepth += 1;
          locks.push("acquire");
        },
        releaseLock: () => {
          locks.push("release");
          lockDepth -= 1;
        }
      })
    },
    Utilities: {
      getUuid: () => `generated-${++uuid}`,
      computeHmacSha256Signature: (value, key) =>
        Array.from(createHmac("sha256", key).update(value).digest()),
      base64EncodeWebSafe: (bytes) => Buffer.from(bytes).toString("base64url")
    }
  });
  for (const file of ["Repository.gs", "AttendanceService.gs", "AdminService.gs"]) {
    vm.runInContext(await readFile(new URL(file, staffScriptRoot), "utf8"), context, { filename: file });
  }
  return {
    context,
    properties,
    sourceSheets,
    targetSheets,
    locks,
    setNow: (value) => { serverNow = value; }
  };
}

async function createPublicRegistrationContext(
  sourceSheets,
  fallbackSettings,
  additionalSpreadsheets = {},
  propertyOverrides = {}
) {
  const properties = {
    ACTIVE_SPREADSHEET_ID: "source-sheet-id",
    ADMIN_SETTINGS: JSON.stringify(fallbackSettings),
    SWITCH_PROBE_SHARED_SECRET: switchProbeSecret,
    ...propertyOverrides
  };
  const spreadsheets = {
    "source-sheet-id": sourceSheets,
    ...additionalSpreadsheets
  };
  let lockDepth = 0;
  let uuid = 1000;
  const RealDate = Date;
  let serverNow = "2026-08-10T04:00:00Z";
  class RegistrationDate extends RealDate {
    constructor(value) { super(value === undefined ? serverNow : value); }
    static now() { return RealDate.parse(serverNow); }
  }
  const context = vm.createContext({
    JSON, Object, Array, String, Number, RegExp, Error, Math, isFinite, Date: RegistrationDate,
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => properties[key] ?? null
      })
    },
    SpreadsheetApp: {
      openById: (spreadsheetId) => {
        const sheets = spreadsheets[spreadsheetId];
        if (!sheets) throw new Error("missing spreadsheet");
        return {
          getId: () => spreadsheetId,
          getName: () => spreadsheetId,
          getSheetByName: (name) => sheets[name] || null
        };
      }
    },
    LockService: {
      getScriptLock: () => ({
        waitLock: () => {
          assert.equal(lockDepth, 0, "nested public lock");
          lockDepth += 1;
        },
        releaseLock: () => { lockDepth -= 1; }
      })
    },
    Utilities: {
      getUuid: () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, "0")}`,
      computeHmacSha256Signature: (value, key) =>
        Array.from(createHmac("sha256", key).update(value).digest()),
      base64EncodeWebSafe: (bytes) => Buffer.from(bytes).toString("base64url")
    },
    ContentService: {
      MimeType: { JSON: "application/json" },
      createTextOutput: (content) => ({
        content,
        setMimeType() { return this; }
      })
    }
  });
  const openedSpreadsheetIds = [];
  context.SpreadsheetApp.openById = (spreadsheetId) => {
    openedSpreadsheetIds.push(spreadsheetId);
    const sheets = spreadsheets[spreadsheetId];
    if (!sheets) throw new Error("missing spreadsheet");
    return {
      getId: () => spreadsheetId,
      getName: () => spreadsheetId,
      getSheetByName: (name) => sheets[name] || null
    };
  };
  context.__openedSpreadsheetIds = openedSpreadsheetIds;
  context.__setNow = (value) => { serverNow = value; };
  for (const file of [
    "Repository.gs",
    "RegistrationService.gs",
    "TicketService.gs",
    "AttendanceService.gs",
    "SwitchProbeService.gs",
    "Code.gs"
  ]) {
    vm.runInContext(await readFile(new URL(file, publicScriptRoot), "utf8"), context, { filename: file });
  }
  return context;
}

function postPublic(context, action, payload) {
  const response = context.doPost({
    postData: { contents: JSON.stringify({ action, payload }) }
  });
  return JSON.parse(response.content);
}

function setSwitchMaintenance(harness, expiresAt) {
  setRegistryValue(harness, "SWITCH_MAINTENANCE", JSON.stringify({
    nonce: "abandoned-switch",
    expiresAt
  }));
}

async function createPublicMaintenanceHarness(expiresAt) {
  const harness = await createHarness({ nowIso: "2026-08-10T04:00:00Z" });
  setSwitchMaintenance(harness, expiresAt);
  const publicContext = await createPublicRegistrationContext(
    harness.sourceSheets,
    {},
    { "target-sheet-id": harness.targetSheets }
  );
  return { harness, publicContext };
}

test("event lifecycle changes preserve every related history row and save advanced policy", async () => {
  const harness = await createHarness();
  const before = Object.fromEntries(Object.entries(harness.sourceSheets)
    .map(([name, sheet]) => [name, sheet.rows.length]));

  const archived = harness.context.saveAdminEvent({ eventId: "event-1", action: "archive" });
  assert.equal(archived.ok, true);
  assert.equal(archived.data.status, "archived");

  const closed = harness.context.saveAdminEvent({
    eventId: "event-1",
    action: "close",
    cancellationEnabled: false,
    seatExchangeEnabled: false,
    showOpeningCountdown: false,
    showClosingCountdown: true
  });
  assert.equal(closed.ok, true);
  assert.equal(closed.data.status, "ended");

  for (const name of ["场次", "座位", "报名问题", "参加者", "报名项目", "签到记录"]) {
    assert.equal(harness.sourceSheets[name].rows.length, before[name], name);
  }
  const eventSettings = readHarnessAdminSettings(harness).registration.events["event-1"];
  assert.equal(eventSettings.cancellationEnabled, false);
  assert.equal(eventSettings.seatExchangeEnabled, false);
  assert.equal(eventSettings.showOpeningCountdown, false);
  assert.equal(eventSettings.showClosingCountdown, true);
});

test("reopen requires explicit confirmation and reports the existing unique registration count", async () => {
  const harness = await createHarness();

  const denied = harness.context.saveAdminEvent({ eventId: "event-1", action: "reopen" });
  assert.equal(denied.ok, false);
  assert.equal(denied.code, "CONFIRMATION_REQUIRED");

  const reopened = harness.context.saveAdminEvent({
    eventId: "event-1",
    action: "reopen",
    confirm: true
  });
  assert.equal(reopened.ok, true);
  assert.equal(reopened.data.status, "open");
  assert.equal(reopened.data.registrationCount, 1);
  assert.equal(records(harness.sourceSheets["报名项目"]).length, 2);
});

test("event, session, and question CRUD validate supported values and retain extended rules", async () => {
  const harness = await createHarness();
  const createdEvent = harness.context.saveAdminEvent({
    title: "New Event",
    description: "Description",
    status: "draft",
    opensAt: "2026-09-01T00:00:00Z",
    closesAt: "2026-09-10T00:00:00Z",
    location: "Auditorium",
    selectionMode: "mixed",
    minChoices: 1,
    maxChoices: 3,
    seatMode: "zone",
    seatZones: ["North", "South"],
    cancellationEnabled: true,
    seatExchangeEnabled: true
  });
  assert.equal(createdEvent.ok, true);
  assert.equal(createdEvent.data.status, "draft");

  const eventId = createdEvent.data.eventId;
  const session = harness.context.saveAdminSession({
    eventId,
    title: "Keynote",
    speaker: "Professor Wu",
    startsAt: "2026-09-11T09:00:00Z",
    endsAt: "2026-09-11T10:00:00Z",
    location: "Room 3",
    capacity: 120,
    required: true,
    groupRule: "group-a",
    status: "open"
  });
  assert.equal(session.ok, true);
  assert.equal(session.data.location, "Room 3");
  assert.equal(session.data.groupRule, "group-a");

  const question = harness.context.saveAdminQuestion({
    eventId,
    label: "Meal",
    type: "select",
    required: true,
    options: ["Vegetarian", "Standard"],
    validation: { minLength: 2 },
    sortOrder: 3,
    status: "active",
    showOnTicket: true,
    duplicateIdentity: true
  });
  assert.equal(question.ok, true);
  assert.equal(question.data.type, "select");
  assert.equal(question.data.showOnTicket, true);
  assert.equal(question.data.duplicateIdentity, true);

  const invalidStatus = harness.context.saveAdminEvent({ eventId, status: "deleted" });
  const invalidType = harness.context.saveAdminQuestion({ eventId, label: "Bad", type: "password" });
  assert.equal(invalidStatus.code, "INVALID_REQUEST");
  assert.equal(invalidType.code, "INVALID_REQUEST");
});

test("seat plans cover every mode and reserve, close, and reopen seats without deleting rows", async () => {
  const harness = await createHarness();
  for (const mode of ["none", "self", "auto", "zone"]) {
    const result = harness.context.saveAdminSeatPlan({
      eventId: "event-1",
      action: "generate",
      mode,
      sessionId: "session-1",
      zones: mode === "zone"
        ? [{ name: "Balcony", rows: 1, seatsPerRow: 2 }]
        : [{ name: "", rows: mode === "none" ? 0 : 1, seatsPerRow: mode === "none" ? 0 : 1 }]
    });
    assert.equal(result.ok, true, mode);
    assert.equal(result.data.mode, mode);
  }

  const seatsAfterGeneration = records(harness.sourceSheets["座位"]);
  const generated = seatsAfterGeneration.find((seat) => seat.label === "Balcony-1-1");
  assert.ok(generated);
  const count = seatsAfterGeneration.length;

  assert.equal(harness.context.saveAdminSeatPlan({ action: "reserve", seatId: generated.seatId }).data.status, "reserved");
  assert.equal(harness.context.saveAdminSeatPlan({ action: "close", seatId: generated.seatId }).data.status, "closed");
  assert.equal(harness.context.saveAdminSeatPlan({ action: "reopen", seatId: generated.seatId }).data.status, "available");
  assert.equal(records(harness.sourceSheets["座位"]).length, count);
});

test("dashboard search masks participant fields and answers while returning attendance", async () => {
  const harness = await createHarness();
  const result = harness.context.getAdminDashboard({ search: "alice@example.com" });

  assert.equal(result.ok, true);
  assert.equal(result.data.connection.connected, true);
  assert.equal(result.data.records.length, 1);
  assert.equal(result.data.attendance.length, 1);
  const serialized = JSON.stringify(result.data);
  assert.match(result.data.records[0].participantName, /\*/);
  assert.doesNotMatch(serialized, /Alice Chan|0123456789|alice@example\.com|secret answer|opaque-private-ticket-token/);
  assert.doesNotMatch(serialized, /source-sheet-id|rowNumber/);
});

test("dashboard masks boolean and collection values in every dynamic private answer", async () => {
  const rows = baseRows();
  rows["报名项目"].forEach((registration) => {
    registration.answers = JSON.stringify({
      values: {
        email: "alice@example.com",
        privateNote: "secret answer",
        consent: true,
        declined: false,
        dietaryTags: ["nut allergy", "vegan"]
      },
      ticketToken: "opaque-private-ticket-token",
      verificationField: "email"
    });
  });
  const harness = await createHarness({ rows });

  const result = harness.context.getAdminDashboard({});

  assert.equal(result.ok, true);
  const answers = JSON.parse(JSON.stringify(result.data.records[0].answers));
  assert.equal(answers.consent, "****");
  assert.equal(answers.declined, "****");
  assert.ok(Object.values(answers).every((value) =>
    typeof value === "string" || (Array.isArray(value) && value.every((item) => typeof item === "string"))));
  assert.doesNotMatch(JSON.stringify(answers), /secret answer|nut allergy|vegan|true|false/);
});

test("dashboard aggregates sessions and seats from every row of one registration", async () => {
  const rows = baseRows();
  rows["场次"].push({
    sessionId: "session-2", eventId: "event-1", title: "Workshop", speaker: "Dr Tan",
    startsAt: "2026-08-16T11:00:00Z", endsAt: "2026-08-16T12:00:00Z",
    required: false, capacity: 30, status: "open",
    createdAt: "2026-07-01T00:00:00Z", updatedAt: "2026-07-01T00:00:00Z"
  });
  rows["座位"].push({
    seatId: "seat-second", eventId: "event-1", sessionId: "session-2", label: "B-01",
    zone: "B", status: "registered", holderRegistrationId: "registration-1",
    createdAt: "2026-07-01T00:00:00Z", updatedAt: "2026-07-01T00:00:00Z"
  });
  rows["报名项目"][1].sessionIds = JSON.stringify(["session-2"]);
  rows["报名项目"][1].seatChoices = JSON.stringify(["seat-second"]);
  const harness = await createHarness({ rows });

  const result = harness.context.getAdminDashboard({});

  assert.equal(result.ok, true);
  assert.equal(result.data.records.length, 1);
  assert.deepEqual(
    JSON.parse(JSON.stringify(result.data.records[0].sessionIds)),
    ["session-1", "session-2"]
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(result.data.records[0].seatChoices)),
    ["seat-old", "seat-second"]
  );
});

test("seat adjustment rejects a seat from another event before changing any row", async () => {
  const rows = baseRows();
  rows["座位"].push({
    seatId: "seat-other-event", eventId: "event-2", sessionId: "", label: "X-01",
    zone: "X", status: "available", holderRegistrationId: "",
    createdAt: "2026-07-01T00:00:00Z", updatedAt: "2026-07-01T00:00:00Z"
  });
  const harness = await createHarness({ rows });
  const beforeSeats = JSON.stringify(records(harness.sourceSheets["座位"]));
  const beforeRegistrations = JSON.stringify(records(harness.sourceSheets["报名项目"]));

  const result = harness.context.adminRecordAction({
    action: "adjust_seat",
    registrationId: "registration-1",
    seatId: "seat-other-event",
    confirm: true
  });

  assert.equal(result.code, "CONFLICT");
  assert.equal(JSON.stringify(records(harness.sourceSheets["座位"])), beforeSeats);
  assert.equal(JSON.stringify(records(harness.sourceSheets["报名项目"])), beforeRegistrations);
  assert.equal(harness.sourceSheets["座位"].writeCount, 0);
  assert.equal(harness.sourceSheets["报名项目"].writeCount, 0);
  assert.equal(harness.sourceSheets["操作记录"].writeCount, 0);
});

test("seat adjustment rejects an unselected session before releasing the current seat", async () => {
  const rows = baseRows();
  rows["场次"].push({
    sessionId: "session-2", eventId: "event-1", title: "Workshop", speaker: "Dr Tan",
    startsAt: "2026-08-16T11:00:00Z", endsAt: "2026-08-16T12:00:00Z",
    required: false, capacity: 30, status: "open",
    createdAt: "2026-07-01T00:00:00Z", updatedAt: "2026-07-01T00:00:00Z"
  });
  rows["座位"].push({
    seatId: "seat-unselected", eventId: "event-1", sessionId: "session-2", label: "B-01",
    zone: "B", status: "available", holderRegistrationId: "",
    createdAt: "2026-07-01T00:00:00Z", updatedAt: "2026-07-01T00:00:00Z"
  });
  const harness = await createHarness({ rows });
  const beforeSeats = JSON.stringify(records(harness.sourceSheets["座位"]));
  const beforeRegistrations = JSON.stringify(records(harness.sourceSheets["报名项目"]));

  const result = harness.context.adminRecordAction({
    action: "adjust_seat",
    registrationId: "registration-1",
    seatId: "seat-unselected",
    confirm: true
  });

  assert.equal(result.code, "CONFLICT");
  assert.equal(JSON.stringify(records(harness.sourceSheets["座位"])), beforeSeats);
  assert.equal(JSON.stringify(records(harness.sourceSheets["报名项目"])), beforeRegistrations);
  assert.equal(harness.sourceSheets["座位"].writeCount, 0);
  assert.equal(harness.sourceSheets["报名项目"].writeCount, 0);
  assert.equal(harness.sourceSheets["操作记录"].writeCount, 0);
});

test("seat adjustment restores every seat and registration row when a later write fails", async () => {
  for (const failureStage of ["registration update", "old-seat release"]) {
    const harness = await createHarness();
    const beforeSeats = JSON.stringify(records(harness.sourceSheets["座位"]));
    const beforeRegistrations = JSON.stringify(records(harness.sourceSheets["报名项目"]));
    const beforeAudits = JSON.stringify(records(harness.sourceSheets["操作记录"]));
    if (failureStage === "registration update") {
      harness.sourceSheets["报名项目"].failNextWrite();
    } else {
      harness.sourceSheets["座位"].failWriteOnAttempt(2);
    }

    const result = harness.context.adminRecordAction({
      action: "adjust_seat",
      registrationId: "registration-1",
      seatId: "seat-new",
      confirm: true
    });

    assert.equal(result.code, "INTERNAL", failureStage);
    assert.equal(JSON.stringify(records(harness.sourceSheets["座位"])), beforeSeats, failureStage);
    assert.equal(
      JSON.stringify(records(harness.sourceSheets["报名项目"])),
      beforeRegistrations,
      failureStage
    );
    assert.equal(
      JSON.stringify(records(harness.sourceSheets["操作记录"])),
      beforeAudits,
      failureStage
    );
  }
});

test("seat adjustment keeps the old seat and journals recovery when target rollback fails", async () => {
  const harness = await createHarness();
  harness.sourceSheets["报名项目"].failNextWrite();
  harness.sourceSheets["座位"].failWriteOnAttempt(2);

  const result = harness.context.adminRecordAction({
    action: "adjust_seat",
    registrationId: "registration-1",
    seatId: "seat-new",
    confirm: true
  });

  assert.equal(result.code, "INTEGRITY_ERROR");
  const seats = records(harness.sourceSheets["座位"]);
  assert.equal(seats.find((seat) => seat.seatId === "seat-old").status, "registered");
  assert.equal(
    seats.find((seat) => seat.seatId === "seat-old").holderRegistrationId,
    "registration-1"
  );
  assert.ok(records(harness.sourceSheets["操作记录"])
    .some((row) => row.action === "ADMIN_SEAT_ADJUSTMENT_RECOVERY"));
});

test("identity questions cannot become optional or hidden while policy still depends on them", async () => {
  for (const change of [
    { required: false },
    { action: "hide" }
  ]) {
    const harness = await createHarness();
    const beforeQuestions = JSON.stringify(records(harness.sourceSheets["报名问题"]));
    const beforeSettings = settingsStorageSnapshot(harness);
    const result = harness.context.saveAdminQuestion({
      eventId: "event-1",
      questionId: "email",
      ...change
    });

    assert.equal(result.code, "CONFLICT");
    assert.equal(JSON.stringify(records(harness.sourceSheets["报名问题"])), beforeQuestions);
    assert.equal(settingsStorageSnapshot(harness), beforeSettings);
    assert.equal(harness.sourceSheets["报名问题"].writeCount, 0);
    assert.equal(harness.sourceSheets["操作记录"].writeCount, 0);
  }
});

test("the final identity flag can be cleared, hidden, or made optional while persisting an empty policy", async () => {
  for (const change of [
    { duplicateIdentity: false },
    { action: "hide", duplicateIdentity: false },
    { required: false, duplicateIdentity: false }
  ]) {
    const harness = await createHarness();

    const result = harness.context.saveAdminQuestion({
      eventId: "event-1",
      questionId: "email",
      ...change
    });

    assert.equal(result.ok, true, JSON.stringify(change));
    assert.deepEqual(
      readHarnessAdminSettings(harness).registration.events["event-1"].identityFields,
      [],
      JSON.stringify(change)
    );
    assert.equal(result.data.duplicateIdentity, false, JSON.stringify(change));
  }
});

test("clearing the final identity flag is observed by the separate public registration project", async () => {
  const harness = await createHarness();
  const cleared = harness.context.saveAdminQuestion({
    eventId: "event-1",
    questionId: "email",
    duplicateIdentity: false
  });
  assert.equal(cleared.ok, true);

  const publicContext = await createPublicRegistrationContext(
    harness.sourceSheets,
    {
      registration: {
        identityFields: ["email"],
        events: {
          "event-1": {
            identityFields: ["email"],
            seatHoldsEnabled: true
          }
        }
      }
    }
  );
  const registered = publicContext.createRegistration({
    eventId: "event-1",
    sessionIds: ["session-1"],
    seatChoices: ["seat-new"],
    answers: { email: "alice@example.com" }
  });

  assert.equal(registered.ok, true, JSON.stringify(registered));
});

test("a public registration pins one active spreadsheet even when the root pointer changes mid-request", async () => {
  const rows = baseRows();
  rows["系统设置"] = [{
    key: "ADMIN_SETTINGS",
    value: JSON.stringify({
      registration: {
        identityFields: ["email"],
        events: { "event-1": { identityFields: [] } }
      }
    }),
    updatedAt: "2026-07-01T00:00:00Z"
  }];
  const targetRows = baseRows();
  targetRows["场次"] = [];
  const harness = await createHarness({ rows, targetRows });
  const sourceRegistrationCount = records(harness.sourceSheets["报名项目"]).length;
  const targetSnapshot = JSON.stringify(Object.fromEntries(
    Object.entries(harness.targetSheets).map(([name, sheet]) => [name, sheet.rows])
  ));
  harness.sourceSheets["活动"].afterNextRead(() => {
    harness.sourceSheets["系统设置"].appendRow([
      "ACTIVE_SPREADSHEET_ID",
      "target-sheet-id",
      "2026-07-26T04:00:00Z"
    ]);
    harness.sourceSheets["系统设置"].appendRow([
      "SWITCH_MAINTENANCE",
      JSON.stringify({ nonce: "mid-request", expiresAt: "2026-08-10T04:02:00Z" }),
      "2026-07-26T04:00:00Z"
    ]);
  });
  const publicContext = await createPublicRegistrationContext(
    harness.sourceSheets,
    {
      registration: {
        identityFields: ["email"],
        events: { "event-1": { identityFields: ["email"] } }
      }
    },
    { "target-sheet-id": harness.targetSheets }
  );

  const registered = publicContext.createRegistration({
    eventId: "event-1",
    sessionIds: ["session-1"],
    seatChoices: ["seat-new"],
    answers: { email: "alice@example.com" }
  });

  assert.equal(registered.ok, true, JSON.stringify(registered));
  assert.equal(records(harness.sourceSheets["报名项目"]).length, sourceRegistrationCount + 1);
  assert.equal(JSON.stringify(Object.fromEntries(
    Object.entries(harness.targetSheets).map(([name, sheet]) => [name, sheet.rows])
  )), targetSnapshot);
  assert.equal(publicContext.createRegistration({
    eventId: "event-1",
    sessionIds: ["session-1"],
    seatChoices: ["seat-new"],
    answers: { email: "second@example.com" }
  }).code, "MAINTENANCE");
});

test("a staff lookup pins one active spreadsheet even when the root pointer changes mid-request", async () => {
  const rows = baseRows();
  const targetRows = baseRows();
  targetRows["活动"] = [];
  const harness = await createHarness({ rows, targetRows });
  harness.sourceSheets["报名项目"].afterNextRead(() => {
    harness.sourceSheets["系统设置"].appendRow([
      "ACTIVE_SPREADSHEET_ID",
      "target-sheet-id",
      "2026-07-26T04:00:00Z"
    ]);
  });

  const result = harness.context.getStaffTicketForCheckIn({
    token: "opaque-private-ticket-token"
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.data.event.title, "Ideas Forum");
});

test("blank or malformed authoritative registry settings fail closed despite valid project properties", async () => {
  for (const sharedValue of ["", "{not-json"]) {
    const rows = baseRows();
    rows["系统设置"] = [{
      key: "ADMIN_SETTINGS",
      value: sharedValue,
      updatedAt: "2026-07-01T00:00:00Z"
    }];
    const harness = await createHarness({ rows });
    const dashboard = harness.context.getAdminDashboard({});
    assert.equal(dashboard.code, "INTERNAL", sharedValue);

    const publicContext = await createPublicRegistrationContext(
      harness.sourceSheets,
      {
        registration: {
          identityFields: ["email"],
          events: { "event-1": { identityFields: ["email"] } }
        }
      }
    );
    const registered = publicContext.createRegistration({
      eventId: "event-1",
      sessionIds: ["session-1"],
      seatChoices: ["seat-new"],
      answers: { email: "alice@example.com" }
    });
    assert.equal(registered.code, "INTERNAL", sharedValue);
  }
});

test("missing authoritative registry settings fail closed despite valid project properties", async () => {
  const rows = baseRows();
  const harness = await createHarness({ rows, seedRegistrySettings: false });

  assert.equal(harness.context.getAdminDashboard({}).code, "INTERNAL");

  const publicContext = await createPublicRegistrationContext(
    harness.sourceSheets,
    {
      registration: {
        identityFields: ["email"],
        events: { "event-1": { identityFields: ["email"] } }
      }
    }
  );
  const registered = publicContext.createRegistration({
    eventId: "event-1",
    sessionIds: ["session-1"],
    seatChoices: ["seat-new"],
    answers: { email: "alice@example.com" }
  });
  assert.equal(registered.code, "INTERNAL");
});

test("a nonempty identity policy with a missing question reference is rejected without mutation", async () => {
  const adminSettings = {
    registration: {
      identityFields: [],
      events: {
        "event-1": {
          identityFields: ["email", "missing-question"],
          showOnTicketFields: []
        }
      }
    }
  };
  const harness = await createHarness({ adminSettings });
  const beforeQuestions = JSON.stringify(records(harness.sourceSheets["报名问题"]));
  const beforeSettings = settingsStorageSnapshot(harness);

  const result = harness.context.saveAdminQuestion({
    eventId: "event-1",
    questionId: "email",
    label: "Updated Email"
  });

  assert.equal(result.code, "CONFLICT");
  assert.equal(JSON.stringify(records(harness.sourceSheets["报名问题"])), beforeQuestions);
  assert.equal(settingsStorageSnapshot(harness), beforeSettings);
  assert.equal(harness.sourceSheets["报名问题"].writeCount, 0);
});

test("event question edits preserve the effective global identity policy invariant", async () => {
  const adminSettings = {
    registration: {
      identityFields: ["email"],
      events: {
        "event-1": {
          seatExchangeEnabled: true,
          cancellationEnabled: true,
          showOnTicketFields: []
        }
      }
    }
  };
  const harness = await createHarness({ adminSettings });
  const beforeQuestions = JSON.stringify(records(harness.sourceSheets["报名问题"]));
  const beforeSettings = settingsStorageSnapshot(harness);
  const dashboard = harness.context.getAdminDashboard({});

  const result = harness.context.saveAdminQuestion({
    eventId: "event-1",
    questionId: "email",
    action: "hide"
  });

  assert.equal(
    dashboard.data.questions.find((question) => question.questionId === "email").duplicateIdentity,
    true
  );
  assert.equal(result.code, "CONFLICT");
  assert.equal(JSON.stringify(records(harness.sourceSheets["报名问题"])), beforeQuestions);
  assert.equal(settingsStorageSnapshot(harness), beforeSettings);
  assert.equal(harness.sourceSheets["报名问题"].writeCount, 0);
});

test("an identity question cannot be moved to another event around the policy invariant", async () => {
  const rows = baseRows();
  rows["活动"].push({
    eventId: "event-2", title: "Second Event", description: "", status: "draft",
    opensAt: "", closesAt: "", location: "", selectionMode: "free",
    minChoices: 0, maxChoices: 1, seatMode: "none", seatZones: "[]",
    createdAt: "2026-07-01T00:00:00Z", updatedAt: "2026-07-01T00:00:00Z"
  });
  const harness = await createHarness({ rows });
  const beforeQuestions = JSON.stringify(records(harness.sourceSheets["报名问题"]));
  const beforeSettings = settingsStorageSnapshot(harness);

  const result = harness.context.saveAdminQuestion({
    eventId: "event-2",
    questionId: "email"
  });

  assert.equal(result.code, "CONFLICT");
  assert.equal(JSON.stringify(records(harness.sourceSheets["报名问题"])), beforeQuestions);
  assert.equal(settingsStorageSnapshot(harness), beforeSettings);
  assert.equal(harness.sourceSheets["报名问题"].writeCount, 0);
});

test("identity question can be hidden when the same mutation leaves another active required identity field", async () => {
  const rows = baseRows();
  rows["报名问题"].push({
    questionId: "phone", eventId: "event-1", label: "Phone", type: "tel", required: true,
    options: "{}", sortOrder: 2, status: "active",
    createdAt: "2026-07-01T00:00:00Z", updatedAt: "2026-07-01T00:00:00Z"
  });
  const adminSettings = {
    registration: {
      identityFields: ["email"],
      events: {
        "event-1": {
          seatExchangeEnabled: true,
          cancellationEnabled: true,
          identityFields: ["email", "phone"],
          showOnTicketFields: []
        }
      }
    }
  };
  const harness = await createHarness({ rows, adminSettings });

  const result = harness.context.saveAdminQuestion({
    eventId: "event-1",
    questionId: "email",
    action: "hide",
    duplicateIdentity: false
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.status, "inactive");
  assert.deepEqual(
    readHarnessAdminSettings(harness).registration.events["event-1"].identityFields,
    ["phone"]
  );
});

test("clearing the final identity flag persists policy first so a shared-settings failure is atomic", async () => {
  const harness = await createHarness();
  const beforeQuestions = JSON.stringify(records(harness.sourceSheets["报名问题"]));
  const beforeSettings = settingsStorageSnapshot(harness);
  harness.sourceSheets["系统设置"].failNextWrite();

  const result = harness.context.saveAdminQuestion({
    eventId: "event-1",
    questionId: "email",
    action: "hide",
    duplicateIdentity: false
  });

  assert.equal(result.code, "INTERNAL");
  assert.equal(JSON.stringify(records(harness.sourceSheets["报名问题"])), beforeQuestions);
  assert.equal(settingsStorageSnapshot(harness), beforeSettings);
  assert.equal(harness.sourceSheets["操作记录"].writeCount, 0);
});

test("record cancellation and seat adjustment preserve rows and append auditable state changes", async () => {
  const cancellationHarness = await createHarness();
  const cancellationCounts = Object.fromEntries(Object.entries(cancellationHarness.sourceSheets)
    .map(([name, sheet]) => [name, sheet.rows.length]));
  const cancelled = cancellationHarness.context.adminRecordAction({
    action: "cancel_registration",
    registrationId: "registration-1",
    confirm: true
  });
  assert.equal(cancelled.ok, true);
  assert.ok(records(cancellationHarness.sourceSheets["报名项目"]).every((row) => row.status === "cancelled"));
  assert.equal(records(cancellationHarness.sourceSheets["座位"])[0].status, "available");
  for (const name of ["参加者", "报名项目", "签到记录"]) {
    assert.equal(cancellationHarness.sourceSheets[name].rows.length, cancellationCounts[name], name);
  }

  const adjustmentHarness = await createHarness();
  const adjusted = adjustmentHarness.context.adminRecordAction({
    action: "adjust_seat",
    registrationId: "registration-1",
    seatId: "seat-new",
    confirm: true
  });
  assert.equal(adjusted.ok, true);
  const seats = records(adjustmentHarness.sourceSheets["座位"]);
  assert.equal(seats.find((seat) => seat.seatId === "seat-old").status, "available");
  assert.equal(seats.find((seat) => seat.seatId === "seat-new").holderRegistrationId, "registration-1");
  assert.ok(records(adjustmentHarness.sourceSheets["报名项目"])
    .every((row) => JSON.parse(row.seatChoices).includes("seat-new")));
  assert.ok(records(adjustmentHarness.sourceSheets["操作记录"]).length >= 1);
});

test("connection testing validates the target without returning or activating its Sheet ID", async () => {
  const harness = await createHarness();
  const sourceId = harness.properties.ACTIVE_SPREADSHEET_ID;

  const result = harness.context.testAdminSheetConnection({ spreadsheetId: "target-sheet-id" });

  assert.equal(result.ok, true);
  assert.equal(result.data.connected, true);
  assert.equal(result.data.sheetName, "Target Registration Data");
  assert.equal(harness.properties.ACTIVE_SPREADSHEET_ID, sourceId);
  assert.equal(JSON.stringify(result).includes("target-sheet-id"), false);
  assert.equal(harness.context.testAdminSheetConnection({ spreadsheetId: "missing" }).code, "SHEET_CONNECTION_FAILED");
});

test("Sheet switching stages maintenance, waits for a public-deployer ack, then atomically publishes the pointer", async () => {
  const harness = await createHarness({ nowIso: "2026-08-10T04:00:00Z" });
  const targetCounts = Object.fromEntries(Object.entries(harness.targetSheets)
    .map(([name, sheet]) => [name, sheet.rows.length]));

  const denied = harness.context.switchAdminSheet({ spreadsheetId: "target-sheet-id" });
  assert.equal(denied.code, "CONFIRMATION_REQUIRED");
  assert.equal(harness.properties.ACTIVE_SPREADSHEET_ID, "source-sheet-id");

  const publicContext = await createPublicRegistrationContext(
    harness.sourceSheets,
    {},
    { "target-sheet-id": harness.targetSheets }
  );

  const staged = harness.context.switchAdminSheet({
    spreadsheetId: "target-sheet-id",
    confirm: true
  });
  assert.equal(staged.ok, true);
  assert.equal(staged.data.state, "probe_required");
  assert.equal(typeof staged.data.nonce, "string");
  assert.ok(staged.data.nonce.length >= 32);
  assert.equal(staged.data.probeUrl, harness.properties.PUBLIC_BACKEND_URL);
  assert.equal(JSON.stringify(staged).includes("target-sheet-id"), false);
  assert.equal(registryValue(harness, "ACTIVE_SPREADSHEET_ID"), null);
  assert.equal(JSON.parse(registryValue(harness, "SWITCH_MAINTENANCE")).nonce, staged.data.nonce);
  assert.equal(JSON.parse(registryValue(harness, "SWITCH_PROBE")).candidateSpreadsheetId, "target-sheet-id");

  const blockedRegistration = publicContext.createRegistration({
    eventId: "event-1",
    sessionIds: ["session-1"],
    seatChoices: ["seat-new"],
    answers: { email: "during-switch@example.com" }
  });
  assert.equal(blockedRegistration.code, "MAINTENANCE");
  assert.equal(publicContext.cancelRegistration({}).code, "MAINTENANCE");
  assert.equal(publicContext.exchangeSeat({}).code, "MAINTENANCE");
  assert.equal(harness.context.checkIn({}).code, "MAINTENANCE");
  assert.equal(harness.context.saveAdminEvent({}).code, "MAINTENANCE");

  assert.deepEqual(
    postPublic(publicContext, "probeSheetSwitch", { nonce: staged.data.nonce }),
    { ok: true, data: { status: "processed" } }
  );
  const ack = JSON.parse(registryValue(harness, "SWITCH_PROBE_ACK"));
  assert.equal(ack.nonce, staged.data.nonce);
  assert.equal(typeof ack.signature, "string");
  assert.ok(ack.signature.length >= 32);
  assert.equal(registryValue(harness, "ACTIVE_SPREADSHEET_ID"), null);

  const switched = harness.context.switchAdminSheet({
    nonce: staged.data.nonce,
    confirm: true
  });
  assert.equal(switched.ok, true);
  assert.equal(switched.data.connected, true);
  assert.match(switched.data.warning, /旧数据.*保留/);
  assert.match(switched.data.warning, /不会自动迁移/);
  assert.equal(harness.properties.ACTIVE_SPREADSHEET_ID, "source-sheet-id");
  assert.equal(JSON.stringify(switched).includes("target-sheet-id"), false);
  assert.equal(registryValue(harness, "ACTIVE_SPREADSHEET_ID"), "target-sheet-id");
  assert.equal(registryValue(harness, "SWITCH_MAINTENANCE"), "");
  assert.equal(registryValue(harness, "SWITCH_PROBE"), "");
  assert.equal(registryValue(harness, "SWITCH_PROBE_ACK"), "");
  assert.equal(
    publicContext.getConfiguredSpreadsheet(publicContext.getRegistrySpreadsheet_()).getId(),
    "target-sheet-id"
  );

  for (const [name, count] of Object.entries(targetCounts)) {
    assert.equal(harness.targetSheets[name].rows.length, count, `target ${name}`);
  }
});

test("an abandoned staged switch blocks every mutation surface before expiry", async () => {
  const harness = await createHarness({ nowIso: "2026-08-10T04:00:00Z" });
  const publicContext = await createPublicRegistrationContext(
    harness.sourceSheets,
    {},
    { "target-sheet-id": harness.targetSheets }
  );
  const staged = harness.context.switchAdminSheet({
    spreadsheetId: "target-sheet-id",
    confirm: true
  });
  assert.equal(staged.ok, true);

  assert.equal(publicContext.createRegistration({
    eventId: "event-1",
    sessionIds: ["session-1"],
    seatChoices: ["seat-new"],
    answers: { email: "abandoned@example.com" }
  }).code, "MAINTENANCE");
  assert.equal(publicContext.cancelRegistration({}).code, "MAINTENANCE");
  assert.equal(publicContext.exchangeSeat({}).code, "MAINTENANCE");
  assert.equal(harness.context.checkIn({}).code, "MAINTENANCE");
  assert.equal(harness.context.saveAdminEvent({}).code, "MAINTENANCE");
  assert.equal(registryValue(harness, "ACTIVE_SPREADSHEET_ID"), null);
  assert.notEqual(registryValue(harness, "SWITCH_MAINTENANCE"), "");
});

test("exact and elapsed maintenance expiry permit registration, cancellation, exchange, check-in, and admin writes", async (t) => {
  const boundaries = [
    {
      label: "at exact expiry",
      publicExpiresAt: "2026-08-10T04:00:00.000Z",
      staffExpiresAt: "2026-08-16T09:30:00.000Z"
    },
    {
      label: "after expiry",
      publicExpiresAt: "2026-08-10T03:59:59.999Z",
      staffExpiresAt: "2026-08-16T09:29:59.999Z"
    }
  ];

  for (const boundary of boundaries) {
    await t.test(`${boundary.label}: public registration`, async () => {
      const { publicContext } = await createPublicMaintenanceHarness(boundary.publicExpiresAt);
      const result = publicContext.createRegistration({
        eventId: "event-1",
        sessionIds: ["session-1"],
        seatChoices: ["seat-new"],
        answers: { email: `${boundary.label.replaceAll(" ", "-")}@example.com` }
      });
      assert.equal(result.ok, true, JSON.stringify(result));
    });

    await t.test(`${boundary.label}: public cancellation`, async () => {
      const { publicContext } = await createPublicMaintenanceHarness(boundary.publicExpiresAt);
      const result = publicContext.cancelRegistration({
        ticketNumber: "EVT-PRIVATE-001",
        verificationValue: "alice@example.com"
      });
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(result.data.status, "cancelled");
    });

    await t.test(`${boundary.label}: public seat exchange`, async () => {
      const { publicContext } = await createPublicMaintenanceHarness(boundary.publicExpiresAt);
      const result = publicContext.exchangeSeat({
        ticketNumber: "EVT-PRIVATE-001",
        verificationValue: "alice@example.com",
        oldSeatId: "seat-old",
        newSeatId: "seat-new"
      });
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.ok(result.data.seats.some((seat) => seat.seatId === "seat-new"));
    });

    await t.test(`${boundary.label}: staff check-in`, async () => {
      const rows = baseRows();
      rows["\u6d3b\u52a8"][0].status = "live";
      rows["\u573a\u6b21"][0].status = "live";
      rows["\u7b7e\u5230\u8bb0\u5f55"] = [];
      const harness = await createHarness({
        rows,
        nowIso: "2026-08-16T09:30:00Z",
        staffAllowlist: ["admin@example.com"]
      });
      setSwitchMaintenance(harness, boundary.staffExpiresAt);

      const result = harness.context.checkIn({
        token: "opaque-private-ticket-token",
        sessionId: "session-1"
      });
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(result.data.status, "checked_in");
    });

    await t.test(`${boundary.label}: administrator mutation`, async () => {
      const harness = await createHarness({ nowIso: "2026-08-10T04:00:00Z" });
      setSwitchMaintenance(harness, boundary.publicExpiresAt);

      const result = harness.context.saveAdminEvent({
        eventId: "event-1",
        title: `Updated ${boundary.label}`
      });
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(result.data.title, `Updated ${boundary.label}`);
    });
  }
});

test("malformed maintenance markers fail closed in both public and staff deployments", async (t) => {
  const malformedMarkers = [
    "{",
    "[]",
    "{}",
    JSON.stringify({ expiresAt: "not-a-date" }),
    JSON.stringify({ expiresAt: "0" }),
    JSON.stringify({ expiresAt: 0 })
  ];

  for (const marker of malformedMarkers) {
    await t.test(marker, async () => {
      const harness = await createHarness({ nowIso: "2026-08-10T04:00:00Z" });
      setRegistryValue(harness, "SWITCH_MAINTENANCE", marker);
      const publicContext = await createPublicRegistrationContext(harness.sourceSheets, {});

      assert.equal(publicContext.createRegistration({
        eventId: "event-1",
        sessionIds: ["session-1"],
        seatChoices: ["seat-new"],
        answers: { email: "malformed@example.com" }
      }).code, "MAINTENANCE");
      assert.equal(harness.context.saveAdminEvent({}).code, "MAINTENANCE");
      assert.equal(registryValue(harness, "SWITCH_MAINTENANCE"), marker);
    });
  }
});

test("a published pointer recovers after maintenance expiry when clearing the marker failed", async () => {
  const harness = await createHarness({ nowIso: "2026-08-10T04:00:00Z" });
  const publicContext = await createPublicRegistrationContext(
    harness.sourceSheets,
    {},
    { "target-sheet-id": harness.targetSheets }
  );
  const staged = harness.context.switchAdminSheet({
    spreadsheetId: "target-sheet-id",
    confirm: true
  });
  postPublic(publicContext, "probeSheetSwitch", { nonce: staged.data.nonce });

  const registrySheet = harness.sourceSheets["\u7cfb\u7edf\u8bbe\u7f6e"];
  registrySheet.failWriteOnAttempt(
    registrySheet.writeAttemptCount + 2,
    new Error("injected maintenance clear failure")
  );
  const finalized = harness.context.switchAdminSheet({
    nonce: staged.data.nonce,
    confirm: true
  });

  assert.equal(finalized.code, "INTERNAL");
  assert.equal(registryValue(harness, "ACTIVE_SPREADSHEET_ID"), "target-sheet-id");
  assert.notEqual(registryValue(harness, "SWITCH_MAINTENANCE"), "");
  assert.equal(publicContext.createRegistration({
    eventId: "event-1",
    sessionIds: ["session-1"],
    seatChoices: ["seat-new"],
    answers: { email: "still-blocked@example.com" }
  }).code, "MAINTENANCE");

  const afterExpiry = new Date(Date.parse(staged.data.expiresAt) + 1).toISOString();
  harness.setNow(afterExpiry);
  publicContext.__setNow(afterExpiry);
  const registered = publicContext.createRegistration({
    eventId: "event-1",
    sessionIds: ["session-1"],
    seatChoices: ["seat-new"],
    answers: { email: "recovered@example.com" }
  });
  assert.equal(registered.ok, true, JSON.stringify(registered));
  assert.notEqual(registryValue(harness, "SWITCH_MAINTENANCE"), "");
  assert.ok(records(harness.targetSheets["\u62a5\u540d\u9879\u76ee"])
    .some((record) => record.registrationId === registered.data.registrationId));

  const adminMutation = harness.context.saveAdminEvent({
    eventId: "event-1",
    title: "Recovered target"
  });
  assert.equal(adminMutation.ok, true, JSON.stringify(adminMutation));
  assert.equal(registryValue(harness, "SWITCH_MAINTENANCE"), "");
  assert.equal(records(harness.targetSheets["\u6d3b\u52a8"])[0].title, "Recovered target");
});

test("Sheet switching aborts maintenance without publishing when no public ack arrives", async () => {
  const harness = await createHarness({ nowIso: "2026-08-10T04:00:00Z" });
  const staged = harness.context.switchAdminSheet({
    spreadsheetId: "target-sheet-id",
    confirm: true
  });

  assert.equal(staged.ok, true);
  const finalized = harness.context.switchAdminSheet({ nonce: staged.data.nonce, confirm: true });

  assert.equal(finalized.code, "SHEET_CONNECTION_FAILED");
  assert.equal(registryValue(harness, "ACTIVE_SPREADSHEET_ID"), null);
  assert.equal(registryValue(harness, "SWITCH_MAINTENANCE"), "");
  assert.equal(registryValue(harness, "SWITCH_PROBE"), "");
  assert.equal(registryValue(harness, "SWITCH_PROBE_ACK"), "");
});

test("the public switch probe accepts only the staged nonce and never an arbitrary Sheet ID", async () => {
  const harness = await createHarness({ nowIso: "2026-08-10T04:00:00Z" });
  const publicContext = await createPublicRegistrationContext(
    harness.sourceSheets,
    {},
    {
      "target-sheet-id": harness.targetSheets,
      "attacker-sheet-id": Object.fromEntries(Object.entries(cloneRows(baseRows()))
        .map(([name, values]) => [name, new FakeSheet(name, values)]))
    }
  );
  const staged = harness.context.switchAdminSheet({
    spreadsheetId: "target-sheet-id",
    confirm: true
  });

  assert.deepEqual(
    postPublic(publicContext, "probeSheetSwitch", {
      nonce: "wrong-nonce",
      spreadsheetId: "attacker-sheet-id"
    }),
    { ok: true, data: { status: "processed" } }
  );
  assert.equal(registryValue(harness, "SWITCH_PROBE_ACK"), "");
  assert.equal(publicContext.__openedSpreadsheetIds.includes("attacker-sheet-id"), false);
  assert.equal(
    harness.context.switchAdminSheet({ nonce: "wrong-nonce", confirm: true }).code,
    "CONFLICT"
  );
  assert.notEqual(registryValue(harness, "SWITCH_MAINTENANCE"), "");

  assert.equal(
    harness.context.switchAdminSheet({ nonce: staged.data.nonce, confirm: true }).code,
    "SHEET_CONNECTION_FAILED"
  );
  assert.equal(registryValue(harness, "SWITCH_MAINTENANCE"), "");
  assert.equal(registryValue(harness, "ACTIVE_SPREADSHEET_ID"), null);
});

test("an expired switch probe cannot be acknowledged or published", async () => {
  const harness = await createHarness({ nowIso: "2026-08-10T04:00:00Z" });
  const publicContext = await createPublicRegistrationContext(
    harness.sourceSheets,
    {},
    { "target-sheet-id": harness.targetSheets }
  );
  const staged = harness.context.switchAdminSheet({
    spreadsheetId: "target-sheet-id",
    confirm: true
  });
  const expired = "2026-08-10T03:59:59.000Z";
  const probe = JSON.parse(registryValue(harness, "SWITCH_PROBE"));
  const maintenance = JSON.parse(registryValue(harness, "SWITCH_MAINTENANCE"));
  probe.expiresAt = expired;
  maintenance.expiresAt = expired;
  setRegistryValue(harness, "SWITCH_PROBE", JSON.stringify(probe));
  setRegistryValue(harness, "SWITCH_MAINTENANCE", JSON.stringify(maintenance));

  assert.deepEqual(
    postPublic(publicContext, "probeSheetSwitch", { nonce: staged.data.nonce }),
    { ok: true, data: { status: "processed" } }
  );
  assert.equal(registryValue(harness, "SWITCH_PROBE_ACK"), "");
  assert.equal(
    harness.context.switchAdminSheet({ nonce: staged.data.nonce, confirm: true }).code,
    "SHEET_CONNECTION_FAILED"
  );
  assert.equal(registryValue(harness, "ACTIVE_SPREADSHEET_ID"), null);
  assert.equal(registryValue(harness, "SWITCH_MAINTENANCE"), "");
});

test("a target the public deployer cannot open never receives pointer publication", async () => {
  const harness = await createHarness({ nowIso: "2026-08-10T04:00:00Z" });
  const publicContext = await createPublicRegistrationContext(harness.sourceSheets, {});
  const staged = harness.context.switchAdminSheet({
    spreadsheetId: "target-sheet-id",
    confirm: true
  });

  assert.deepEqual(
    postPublic(publicContext, "probeSheetSwitch", { nonce: staged.data.nonce }),
    { ok: true, data: { status: "processed" } }
  );
  assert.equal(registryValue(harness, "SWITCH_PROBE_ACK"), "");
  assert.equal(
    harness.context.switchAdminSheet({ nonce: staged.data.nonce, confirm: true }).code,
    "SHEET_CONNECTION_FAILED"
  );
  assert.equal(registryValue(harness, "ACTIVE_SPREADSHEET_ID"), null);
  assert.equal(registryValue(harness, "SWITCH_MAINTENANCE"), "");
});
