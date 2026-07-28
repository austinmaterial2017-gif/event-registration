import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { createHash, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";

const staffScriptRoot = new URL("../staff-apps-script/", import.meta.url);
const publicScriptRoot = new URL("../apps-script/", import.meta.url);
const switchProbeSecret = "test-switch-probe-secret-with-32-bytes";

const headers = {
  "系统设置": ["key", "value", "updatedAt"],
  "活动草稿": ["draftId", "payload", "createdBy", "createdAt", "updatedAt", "finalizedEventId"],
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

class FakeSheet {
  constructor(name, records = []) {
    this.name = name;
    const sheetHeaders = headers[name];
    this.rows = sheetHeaders
      ? [sheetHeaders, ...records.map((record) => sheetHeaders.map((key) => record[key] ?? ""))]
      : [];
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
  setName(name) {
    const previous = this.name;
    this.name = name;
    this.onRename?.(previous, name, this);
    return this;
  }
  getLastRow() { return this.rows.length; }
  getLastColumn() { return this.rows[0]?.length || (headers[this.name] || []).length; }
  insertRowsBefore(row, count) {
    this.consumeWriteFailure();
    this.writeCount += 1;
    this.rows.splice(row - 1, 0, ...Array.from({ length: count }, () => []));
    this.notifyWrite();
  }
  deleteRow(row) {
    this.consumeWriteFailure();
    this.writeCount += 1;
    this.rows.splice(row - 1, 1);
    this.notifyWrite();
  }
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
    "活动草稿": [],
    "活动目录": [],
    "票券索引": [],
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

function sheetByHeader(sheets, header) {
  return Object.values(sheets).find((sheet) => headers[sheet.name].includes(header));
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
  if (options.seedAdminRouting !== false && records(sourceSheets["活动目录"]).length === 0) {
    addPublicEventRoute(sourceSheets, sourceSheets, "source-event-sheet-id");
  }
  if (options.seedTicketRouting === true) {
    addTicketRoute(sourceSheets, sourceSheets);
  }
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
    },
    "source-event-sheet-id": {
      getId: () => "source-event-sheet-id",
      getName: () => "Source Activity Data",
      getSheetByName: (name) => sourceSheets[name] || null
    }
  };
  Object.entries(options.additionalSpreadsheets || {}).forEach(([spreadsheetId, sheets]) => {
    spreadsheets[spreadsheetId] = {
      getId: () => spreadsheetId,
      getName: () => spreadsheetId,
      getSheetByName: (name) => sheets[name] || null
    };
  });
  const createdSpreadsheets = [];
  const trashedFiles = [];
  let createCount = 0;
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
      },
      create: (name) => {
        if (options.createActivityError) throw options.createActivityError;
        const spreadsheetId = `created-activity-${++createCount}`;
        const createdSheets = {};
        const registerCreatedSheet = (sheet) => {
          sheet.onRename = (previous, next) => {
            delete createdSheets[previous];
            createdSheets[next] = sheet;
            if (options.failCreatedEventWrite && next === "活动") {
              sheet.failWriteOnAttempt(2, options.failCreatedEventWrite);
            }
          };
          createdSheets[sheet.getName()] = sheet;
          if (options.failCreatedEventWrite && sheet.getName() === "活动") {
            sheet.failWriteOnAttempt(2, options.failCreatedEventWrite);
          }
          return sheet;
        };
        const spreadsheet = {
          id: spreadsheetId,
          name,
          editors: [],
          sheets: createdSheets,
          getId: () => spreadsheetId,
          getName: () => name,
          getSheetByName: (sheetName) => createdSheets[sheetName] || null,
          getSheets: () => Object.values(createdSheets),
          insertSheet: (sheetName) => {
            if (options.initializeActivityError) throw options.initializeActivityError;
            const sheet = new FakeSheet(sheetName, []);
            sheet.rows = [];
            return registerCreatedSheet(sheet);
          },
          addEditor: (email) => {
            spreadsheet.editors.push(email);
            return spreadsheet;
          }
        };
        registerCreatedSheet(new FakeSheet("Sheet1", []));
        spreadsheets[spreadsheetId] = spreadsheet;
        createdSpreadsheets.push(spreadsheet);
        return spreadsheet;
      }
    },
    DriveApp: {
      getFileById: (spreadsheetId) => ({
        setTrashed: (trashed) => {
          if (trashed) trashedFiles.push(spreadsheetId);
        }
      })
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
      computeDigest: (_algorithm, value) =>
        Array.from(createHash("sha256").update(value).digest()),
      DigestAlgorithm: { SHA_256: "SHA_256" },
      Charset: { UTF_8: "UTF_8" },
      base64EncodeWebSafe: (bytes) => Buffer.from(bytes).toString("base64url")
    }
  });
  for (const file of ["Repository.gs", "AttendanceService.gs", "AdminService.gs"]) {
    vm.runInContext(await readFile(new URL(file, staffScriptRoot), "utf8"), context, { filename: file });
  }
  const gatewayLock = context.withScriptLock_;
  const attendanceSheetName = Object.keys(context.STAFF_SHEET_DEFINITIONS)
    .find((name) => context.STAFF_SHEET_DEFINITIONS[name].includes("checkInId"));
  const handlers = {
    "admin.getDashboard": (payload, actor) => context.getAdminDashboard_(payload, actor),
    "admin.saveDraft": (payload, actor) => context.saveAdminDraft_(payload, actor),
    "admin.finalizeDraft": (payload, actor) => context.finalizeAdminDraft_(payload, actor),
    "admin.deleteDraft": (payload, actor) => context.deleteAdminDraft_(payload, actor),
    "admin.deleteEmptyEvent": (payload, actor) => context.deleteEmptyAdminEvent_(payload, actor),
    "admin.saveEvent": (payload, actor) => context.saveAdminEvent_(payload, actor),
    "admin.saveSession": (payload, actor) => context.saveAdminSession_(payload, actor),
    "admin.saveSeatPlan": (payload, actor) => context.saveAdminSeatPlan_(payload, actor),
    "admin.saveQuestion": (payload, actor) => context.saveAdminQuestion_(payload, actor),
    "admin.recordAction": (payload, actor) => context.adminRecordAction_(payload, actor),
    "admin.testSheet": (payload, actor) => context.testAdminSheetConnection_(payload, actor),
    "admin.switchSheet": (payload, actor) => context.switchAdminSheet_(payload, actor),
    "staff.getTicket": (payload) => {
      const registry = context.getRootConfiguredSpreadsheet_();
      const route = context.getTicketRouteByToken_(registry, payload?.token);
      const spreadsheet = context.getEventSpreadsheet_(registry, route.eventId);
      return context.staffTicketProjection_(
        context.findStaffTicket_(spreadsheet, payload?.token, route)
      );
    },
    "staff.checkIn": (payload, actor) => {
      const registry = context.getRootConfiguredSpreadsheet_();
      context.requireNoSwitchMaintenance_(registry);
      const route = context.getTicketRouteByToken_(registry, payload?.token);
      const spreadsheet = context.getEventSpreadsheet_(registry, route.eventId);
      const match = context.findStaffTicket_(spreadsheet, payload?.token, route);
      if (match.status !== "active") context.staffAttendanceError_("TICKET_INACTIVE");
      if (String(match.event.status || "").toLowerCase() !== "live") {
        context.staffAttendanceError_("CHECK_IN_CLOSED");
      }
      const sessionId = String(payload?.sessionId || "").trim();
      const session = match.sessions.find((candidate) => candidate.sessionId === sessionId);
      if (!session) context.staffAttendanceError_("SESSION_NOT_REGISTERED");
      if (!["live", "open"].includes(String(session.status || "").toLowerCase()) ||
          !context.isWithinStaffAttendanceWindow_(registry, session, new ServerDate())) {
        context.staffAttendanceError_("CHECK_IN_CLOSED");
      }
      const duplicate = context.readRows_(spreadsheet, attendanceSheetName).some((record) =>
        record.registrationId === match.registrationId &&
        record.sessionId === sessionId &&
        String(record.status || "").toLowerCase() === "checked_in");
      if (duplicate) context.staffAttendanceError_("ALREADY_CHECKED_IN");
      const row = {
        checkInId: context.Utilities.getUuid(),
        registrationId: match.registrationId,
        eventId: match.event.eventId,
        sessionId,
        checkedInAt: new ServerDate().toISOString(),
        checkedInBy: actor,
        status: "checked_in"
      };
      const sheet = context.getRequiredSheet_(spreadsheet, attendanceSheetName);
      const values = context.normalizeRow_(attendanceSheetName, row);
      sheet.getRange(sheet.getLastRow() + 1, 1, 1, values.length).setValues([values]);
      return { status: "checked_in", sessionId, checkedInAt: row.checkedInAt };
    }
  };
  context.withScriptLock_ = (callback) => callback();
  context.invokeInternalBackend_ = (action, payload, actor) => gatewayLock(() => {
    try {
      if (!Object.hasOwn(handlers, action)) return { ok: false, code: "INTERNAL_REQUEST_DENIED" };
      return { ok: true, data: handlers[action](payload, actor) };
    } catch (error) {
      return { ok: false, code: error?.publicCode || "INTERNAL" };
    }
  });
  return {
    context,
    properties,
    sourceSheets,
    targetSheets,
    createdSpreadsheets,
    trashedFiles,
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
      computeDigest: (_algorithm, value) =>
        Array.from(createHash("sha256").update(value).digest()),
      DigestAlgorithm: { SHA_256: "SHA_256" },
      Charset: { UTF_8: "UTF_8" },
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

function eventSpreadsheetSheets(eventId, title) {
  const rows = baseRows();
  rows["活动"][0].eventId = eventId;
  rows["活动"][0].title = title;
  rows["场次"].forEach((row) => { row.eventId = eventId; });
  rows["座位"].forEach((row) => { row.eventId = eventId; });
  rows["报名问题"].forEach((row) => { row.eventId = eventId; });
  rows["报名项目"].forEach((row) => { row.eventId = eventId; });
  rows["签到记录"].forEach((row) => { row.eventId = eventId; });
  return Object.fromEntries(Object.entries(rows)
    .filter(([name]) => !["系统设置", "活动目录", "票券索引"].includes(name))
    .map(([name, values]) => [name, new FakeSheet(name, values)]));
}

function addPublicEventRoute(registrySheets, eventSheets, spreadsheetId = "event-1-sheet") {
  const event = records(eventSheets["活动"])[0];
  const route = {
    ...event,
    spreadsheetId,
    sheetName: "活动"
  };
  const catalog = registrySheets["活动目录"];
  const eventIdColumn = headers["活动目录"].indexOf("eventId");
  catalog.rows = [
    catalog.rows[0],
    ...catalog.rows.slice(1).filter((row) => row[eventIdColumn] !== event.eventId)
  ];
  catalog.rows.push(
    headers["活动目录"].map((key) => route[key] ?? "")
  );
  return { [spreadsheetId]: eventSheets };
}

function addTicketRoute(registrySheets, eventSheets) {
  const registration = records(eventSheets["报名项目"])[0];
  const stored = JSON.parse(registration.answers);
  const route = {
    ticketNumber: registration.ticketNumber,
    tokenDigest: createHash("sha256").update(stored.ticketToken).digest("hex"),
    eventId: registration.eventId,
    registrationId: registration.registrationId,
    status: registration.status,
    createdAt: registration.createdAt,
    updatedAt: registration.updatedAt
  };
  registrySheets["票券索引"].rows.push(
    headers["票券索引"].map((key) => route[key] ?? "")
  );
}

function assertPublicCode(action, code) {
  assert.throws(action, (error) => error && error.publicCode === code);
}

test("registry and event initializers keep their private schemas separate", async () => {
  const sheets = {};
  const registry = {
    getId: () => "registry-id",
    getSheetByName: (name) => sheets[name] || null,
    insertSheet: (name) => {
      const sheet = new FakeSheet(name, []);
      sheet.rows = [];
      sheets[name] = sheet;
      return sheet;
    }
  };
  const context = vm.createContext({
    Date, JSON, Object, Array, String, Number, RegExp, Error, Math, isFinite,
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: () => "registry-id",
        setProperty: () => {}
      })
    },
    SpreadsheetApp: { openById: () => registry },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    Utilities: { getUuid: () => "test-audit-id" }
  });
  vm.runInContext(await readFile(new URL("Repository.gs", publicScriptRoot), "utf8"), context);

  context.setupSystem();
  assert.deepEqual(Array.from(sheets["活动目录"].rows[0]), headers["活动目录"]);
  assert.deepEqual(Array.from(sheets["活动草稿"].rows[0]), headers["活动草稿"]);
  assert.deepEqual(Array.from(sheets["票券索引"].rows[0]), headers["票券索引"]);
  assert.equal(sheets["活动"], undefined);

  const eventSheets = {};
  const registerEventSheet = (sheet) => {
    sheet.onRename = (previous, next) => {
      delete eventSheets[previous];
      eventSheets[next] = sheet;
    };
    eventSheets[sheet.getName()] = sheet;
    return sheet;
  };
  registerEventSheet(new FakeSheet("Sheet1", []));
  const notesSheet = registerEventSheet(new FakeSheet("Notes", []));
  notesSheet.rows = [["keep me"]];
  const eventSpreadsheet = {
    getSheetByName: (name) => eventSheets[name] || null,
    getSheets: () => Object.values(eventSheets),
    insertSheet: (name) => {
      const sheet = new FakeSheet(name, []);
      sheet.rows = [];
      return registerEventSheet(sheet);
    }
  };
  context.initializeEventSpreadsheet_(eventSpreadsheet);
  assert.deepEqual(Array.from(eventSheets["活动"].rows[0]), headers["活动"]);
  assert.equal(eventSheets["活动"].rows.length, 1);
  assert.equal(eventSheets["活动目录"], undefined);
  assert.equal(eventSheets["票券索引"], undefined);
  assert.deepEqual(
    Object.keys(eventSheets).sort(),
    ["Notes", "活动", "场次", "座位", "报名问题", "参加者", "报名项目", "签到记录", "操作记录"].sort()
  );
  assert.deepEqual(eventSheets.Notes.rows, [["keep me"]]);
});

test("setupSystem requires every legacy event to have one reachable validated catalog mapping before it mutates", async () => {
  async function setupContext(sheets, inserts, openedSpreadsheets = {}, propertyWrites = []) {
    const registry = {
      getId: () => "registry-id",
      getSheetByName: (name) => sheets[name] || null,
      insertSheet: (name) => {
        inserts.push(name);
        const sheet = new FakeSheet(name, []);
        sheet.rows = [];
        sheets[name] = sheet;
        return sheet;
      }
    };
    const context = vm.createContext({
      Date, JSON, Object, Array, String, Number, RegExp, Error, Math, isFinite,
      PropertiesService: {
        getScriptProperties: () => ({
          getProperty: () => "registry-id",
          setProperty: (key, value) => { propertyWrites.push([key, value]); }
        })
      },
      SpreadsheetApp: {
        openById: (id) => id === "registry-id" || openedSpreadsheets[id] === "registry"
          ? registry : openedSpreadsheets[id]
      },
      LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
      Utilities: { getUuid: () => "test-audit-id" }
    });
    vm.runInContext(await readFile(new URL("Repository.gs", publicScriptRoot), "utf8"), context);
    return context;
  }

  function migratedActivitySpreadsheet(id, eventId) {
    const eventSheets = Object.fromEntries([
      "活动", "场次", "座位", "报名问题", "参加者", "报名项目", "签到记录", "操作记录"
    ].map((name) => [name, new FakeSheet(name, name === "活动" ? [{
      eventId,
      title: `Migrated ${eventId}`,
      status: "archived",
      createdAt: "2026-07-01T00:00:00Z",
      updatedAt: "2026-07-01T00:00:00Z"
    }] : [])]));
    return {
      getId: () => id,
      getSheetByName: (name) => eventSheets[name] || null
    };
  }
  function catalogRow(eventId, spreadsheetId) {
    return {
      eventId, spreadsheetId, sheetName: "活动", title: `Legacy ${eventId}`,
      status: "archived", createdAt: "2026-07-01T00:00:00Z",
      updatedAt: "2026-07-01T00:00:00Z"
    };
  }
  function assertPreflightRejected(context, sheets, inserts) {
    const before = JSON.stringify(Object.fromEntries(Object.entries(sheets)
      .map(([name, sheet]) => [name, sheet.rows])));
    assert.throws(
      () => context.setupSystem(),
      (error) => error && error.publicCode === "LEGACY_MIGRATION_REQUIRED"
    );
    assert.equal(JSON.stringify(Object.fromEntries(Object.entries(sheets)
      .map(([name, sheet]) => [name, sheet.rows]))), before);
    assert.deepEqual(inserts, []);
  }

  const partialSheets = {
    "活动": new FakeSheet("活动", [
      { eventId: "legacy-a", title: "Legacy A" },
      { eventId: "legacy-b", title: "Legacy B" }
    ]),
    "活动目录": new FakeSheet("活动目录", [catalogRow("legacy-a", "migrated-a")])
  };
  const partialInserts = [];
  const partialContext = await setupContext(
    partialSheets, partialInserts, { "migrated-a": migratedActivitySpreadsheet("migrated-a", "legacy-a") }
  );
  assertPreflightRejected(partialContext, partialSheets, partialInserts);

  const blankIdSheets = {
    "活动": new FakeSheet("活动", [{ eventId: "", title: "No event ID" }])
  };
  const blankIdInserts = [];
  const blankIdContext = await setupContext(blankIdSheets, blankIdInserts);
  assertPreflightRejected(blankIdContext, blankIdSheets, blankIdInserts);

  const selfMappedSheets = {
    "活动": new FakeSheet("活动", [{ eventId: "legacy-a", title: "Legacy A" }]),
    "活动目录": new FakeSheet("活动目录", [catalogRow("legacy-a", "registry-id")])
  };
  const selfMappedInserts = [];
  const selfMappedContext = await setupContext(selfMappedSheets, selfMappedInserts);
  assertPreflightRejected(selfMappedContext, selfMappedSheets, selfMappedInserts);

  const duplicateMappedSheets = {
    "活动": new FakeSheet("活动", [{ eventId: "legacy-a", title: "Legacy A" }]),
    "活动目录": new FakeSheet("活动目录", [
      catalogRow("legacy-a", "migrated-a"),
      catalogRow("legacy-a", "migrated-b")
    ])
  };
  const duplicateMappedInserts = [];
  const duplicateMappedContext = await setupContext(duplicateMappedSheets, duplicateMappedInserts, {
    "migrated-a": migratedActivitySpreadsheet("migrated-a", "legacy-a"),
    "migrated-b": migratedActivitySpreadsheet("migrated-b", "legacy-a")
  });
  assertPreflightRejected(duplicateMappedContext, duplicateMappedSheets, duplicateMappedInserts);

  const unreachableSheets = {
    "活动": new FakeSheet("活动", [{ eventId: "legacy-a", title: "Legacy A" }]),
    "活动目录": new FakeSheet("活动目录", [catalogRow("legacy-a", "missing-migration")])
  };
  const unreachableInserts = [];
  const unreachableContext = await setupContext(unreachableSheets, unreachableInserts);
  assertPreflightRejected(unreachableContext, unreachableSheets, unreachableInserts);

  const mismatchedSheets = {
    "活动": new FakeSheet("活动", [{ eventId: "legacy-a", title: "Legacy A" }]),
    "活动目录": new FakeSheet("活动目录", [catalogRow("legacy-a", "migrated-a")])
  };
  const mismatchedInserts = [];
  const mismatchedContext = await setupContext(
    mismatchedSheets,
    mismatchedInserts,
    { "migrated-a": migratedActivitySpreadsheet("migrated-a", "different-event") }
  );
  assertPreflightRejected(mismatchedContext, mismatchedSheets, mismatchedInserts);

  const fullyMappedSheets = {
    "活动": new FakeSheet("活动", [
      { eventId: "legacy-a", title: "Legacy A" },
      { eventId: "legacy-b", title: "Legacy B" }
    ]),
    "活动目录": new FakeSheet("活动目录", [
      catalogRow("legacy-a", "migrated-a"),
      catalogRow("legacy-b", "migrated-b")
    ]),
    "参加者": new FakeSheet("参加者", [{
      participantId: "legacy-person-a", name: "Legacy Person", phone: "", email: ""
    }]),
    "报名项目": new FakeSheet("报名项目", [
      {
        registrationId: "legacy-registration-a", eventId: "legacy-a", participantId: "legacy-person-a",
        ticketNumber: "", status: "active", sessionIds: '["legacy-session-1"]', seatChoices: "[]", answers: "{}"
      },
      {
        registrationId: "legacy-registration-a", eventId: "legacy-a", participantId: "legacy-person-a",
        ticketNumber: "", status: "active", sessionIds: '["legacy-session-2"]', seatChoices: "[]", answers: "{}"
      }
    ])
  };
  const fullyMappedContext = await setupContext(fullyMappedSheets, [], {
    "migrated-a": migratedActivitySpreadsheet("migrated-a", "legacy-a"),
    "migrated-b": migratedActivitySpreadsheet("migrated-b", "legacy-b")
  });
  assert.equal(fullyMappedContext.setupSystem(), "registry-id");

  const blankRegistrationParticipantIdSheets = {
    "活动": new FakeSheet("活动", [{ eventId: "legacy-a", title: "Legacy A" }]),
    "活动目录": new FakeSheet("活动目录", [catalogRow("legacy-a", "migrated-a")]),
    "报名项目": new FakeSheet("报名项目", [{
      registrationId: "legacy-registration-a", eventId: "legacy-a", participantId: "",
      ticketNumber: "", status: "active", sessionIds: "[]", seatChoices: "[]", answers: "{}"
    }])
  };
  const blankRegistrationParticipantIdInserts = [];
  const blankRegistrationParticipantIdContext = await setupContext(
    blankRegistrationParticipantIdSheets,
    blankRegistrationParticipantIdInserts,
    { "migrated-a": migratedActivitySpreadsheet("migrated-a", "legacy-a") }
  );
  assertPreflightRejected(
    blankRegistrationParticipantIdContext,
    blankRegistrationParticipantIdSheets,
    blankRegistrationParticipantIdInserts
  );

  const blankRegistrationIdSheets = {
    "活动": new FakeSheet("活动", [{ eventId: "legacy-a", title: "Legacy A" }]),
    "活动目录": new FakeSheet("活动目录", [catalogRow("legacy-a", "migrated-a")]),
    "报名项目": new FakeSheet("报名项目", [{
      registrationId: "", eventId: "legacy-a", participantId: "missing-person",
      ticketNumber: "", status: "active", sessionIds: "[]", seatChoices: "[]", answers: "{}"
    }])
  };
  const blankRegistrationIdInserts = [];
  const blankRegistrationIdContext = await setupContext(
    blankRegistrationIdSheets,
    blankRegistrationIdInserts,
    { "migrated-a": migratedActivitySpreadsheet("migrated-a", "legacy-a") }
  );
  assertPreflightRejected(blankRegistrationIdContext, blankRegistrationIdSheets, blankRegistrationIdInserts);

  const missingRegistrationParticipantSheets = {
    "活动": new FakeSheet("活动", [{ eventId: "legacy-a", title: "Legacy A" }]),
    "活动目录": new FakeSheet("活动目录", [catalogRow("legacy-a", "migrated-a")]),
    "报名项目": new FakeSheet("报名项目", [{
      registrationId: "legacy-registration-a", eventId: "legacy-a", participantId: "missing-person",
      ticketNumber: "", status: "active", sessionIds: "[]", seatChoices: "[]", answers: "{}"
    }])
  };
  const missingRegistrationParticipantInserts = [];
  const missingRegistrationParticipantContext = await setupContext(
    missingRegistrationParticipantSheets,
    missingRegistrationParticipantInserts,
    { "migrated-a": migratedActivitySpreadsheet("migrated-a", "legacy-a") }
  );
  assertPreflightRejected(
    missingRegistrationParticipantContext,
    missingRegistrationParticipantSheets,
    missingRegistrationParticipantInserts
  );

  const reusedRegistrationIdSheets = {
    "活动": new FakeSheet("活动", [
      { eventId: "legacy-a", title: "Legacy A" },
      { eventId: "legacy-b", title: "Legacy B" }
    ]),
    "活动目录": new FakeSheet("活动目录", [
      catalogRow("legacy-a", "migrated-a"),
      catalogRow("legacy-b", "migrated-b")
    ]),
    "参加者": new FakeSheet("参加者", [
      { participantId: "person-a", name: "A", phone: "", email: "" },
      { participantId: "person-b", name: "B", phone: "", email: "" }
    ]),
    "报名项目": new FakeSheet("报名项目", [
      {
        registrationId: "reused-registration", eventId: "legacy-a", participantId: "person-a",
        ticketNumber: "", status: "active", sessionIds: "[]", seatChoices: "[]", answers: "{}"
      },
      {
        registrationId: "reused-registration", eventId: "legacy-b", participantId: "person-b",
        ticketNumber: "", status: "active", sessionIds: "[]", seatChoices: "[]", answers: "{}"
      }
    ])
  };
  const reusedRegistrationIdInserts = [];
  const reusedRegistrationIdContext = await setupContext(
    reusedRegistrationIdSheets,
    reusedRegistrationIdInserts,
    {
      "migrated-a": migratedActivitySpreadsheet("migrated-a", "legacy-a"),
      "migrated-b": migratedActivitySpreadsheet("migrated-b", "legacy-b")
    }
  );
  assertPreflightRejected(reusedRegistrationIdContext, reusedRegistrationIdSheets, reusedRegistrationIdInserts);

  const reusedParticipantIdSheets = {
    "活动": new FakeSheet("活动", [
      { eventId: "legacy-a", title: "Legacy A" },
      { eventId: "legacy-b", title: "Legacy B" }
    ]),
    "活动目录": new FakeSheet("活动目录", [
      catalogRow("legacy-a", "migrated-a"),
      catalogRow("legacy-b", "migrated-b")
    ]),
    "参加者": new FakeSheet("参加者", [{
      participantId: "reused-person", name: "Reused", phone: "", email: ""
    }]),
    "报名项目": new FakeSheet("报名项目", [
      {
        registrationId: "legacy-registration-a", eventId: "legacy-a", participantId: "reused-person",
        ticketNumber: "", status: "active", sessionIds: "[]", seatChoices: "[]", answers: "{}"
      },
      {
        registrationId: "legacy-registration-b", eventId: "legacy-b", participantId: "reused-person",
        ticketNumber: "", status: "active", sessionIds: "[]", seatChoices: "[]", answers: "{}"
      }
    ])
  };
  const reusedParticipantIdInserts = [];
  const reusedParticipantIdContext = await setupContext(
    reusedParticipantIdSheets,
    reusedParticipantIdInserts,
    {
      "migrated-a": migratedActivitySpreadsheet("migrated-a", "legacy-a"),
      "migrated-b": migratedActivitySpreadsheet("migrated-b", "legacy-b")
    }
  );
  assertPreflightRejected(reusedParticipantIdContext, reusedParticipantIdSheets, reusedParticipantIdInserts);

  const orphanParticipantSheets = {
    "参加者": new FakeSheet("参加者", [{
      participantId: "orphan-person", name: "Orphan", phone: "", email: ""
    }])
  };
  const orphanParticipantInserts = [];
  const orphanParticipantContext = await setupContext(orphanParticipantSheets, orphanParticipantInserts);
  assertPreflightRejected(orphanParticipantContext, orphanParticipantSheets, orphanParticipantInserts);

  const blankParticipantSheets = {
    "参加者": new FakeSheet("参加者", [{
      participantId: "", name: "Missing participant identity", phone: "", email: ""
    }])
  };
  const blankParticipantInserts = [];
  const blankParticipantContext = await setupContext(blankParticipantSheets, blankParticipantInserts);
  assertPreflightRejected(blankParticipantContext, blankParticipantSheets, blankParticipantInserts);

  const duplicateParticipantSheets = {
    "活动": new FakeSheet("活动", [{ eventId: "legacy-a", title: "Legacy A" }]),
    "活动目录": new FakeSheet("活动目录", [catalogRow("legacy-a", "migrated-a")]),
    "参加者": new FakeSheet("参加者", [
      { participantId: "duplicate-person", name: "First", phone: "", email: "" },
      { participantId: "duplicate-person", name: "Second", phone: "", email: "" }
    ]),
    "报名项目": new FakeSheet("报名项目", [{
      registrationId: "legacy-registration-a", eventId: "legacy-a", participantId: "duplicate-person",
      ticketNumber: "", status: "active", sessionIds: "[]", seatChoices: "[]", answers: "{}"
    }])
  };
  const duplicateParticipantInserts = [];
  const duplicateParticipantContext = await setupContext(
    duplicateParticipantSheets,
    duplicateParticipantInserts,
    { "migrated-a": migratedActivitySpreadsheet("migrated-a", "legacy-a") }
  );
  assertPreflightRejected(duplicateParticipantContext, duplicateParticipantSheets, duplicateParticipantInserts);

  const partialRegistrationParticipantSheets = {
    "活动": new FakeSheet("活动", [{ eventId: "legacy-a", title: "Legacy A" }]),
    "活动目录": new FakeSheet("活动目录", [catalogRow("legacy-a", "migrated-a")]),
    "参加者": new FakeSheet("参加者", [{
      participantId: "partial-person", name: "Partial", phone: "", email: ""
    }]),
    "报名项目": new FakeSheet("报名项目", [{
      registrationId: "legacy-registration-b", eventId: "legacy-b", participantId: "partial-person",
      ticketNumber: "", status: "active", sessionIds: "[]", seatChoices: "[]", answers: "{}"
    }])
  };
  const partialRegistrationParticipantInserts = [];
  const partialRegistrationParticipantContext = await setupContext(
    partialRegistrationParticipantSheets,
    partialRegistrationParticipantInserts,
    { "migrated-a": migratedActivitySpreadsheet("migrated-a", "legacy-a") }
  );
  assertPreflightRejected(
    partialRegistrationParticipantContext,
    partialRegistrationParticipantSheets,
    partialRegistrationParticipantInserts
  );

  const freshSheets = {};
  const freshContext = await setupContext(freshSheets, []);
  assert.equal(freshContext.setupSystem(), "registry-id");

  const candidateSheets = { "活动": new FakeSheet("活动", [{ eventId: "legacy-a", title: "Legacy A" }]) };
  const candidateInserts = [];
  const candidateWrites = [];
  const candidateContext = await setupContext(
    candidateSheets,
    candidateInserts,
    { "candidate-id": "registry" },
    candidateWrites
  );
  assert.throws(
    () => candidateContext.setActiveSpreadsheet("candidate-id"),
    (error) => error && error.publicCode === "LEGACY_MIGRATION_REQUIRED"
  );
  assert.deepEqual(candidateInserts, []);
  assert.deepEqual(candidateWrites, []);
});

test("registry routing resolves one validated activity and ticket route without raw tokens", async () => {
  const rows = baseRows();
  const tokenDigest = createHash("sha256").update("raw-secret-token").digest("hex");
  rows["活动目录"].push(
    {
      eventId: "event-a", spreadsheetId: "sheet-a", sheetName: "活动", title: "Activity A",
      description: "A", status: "open", opensAt: "", closesAt: "", location: "",
      selectionMode: "free", minChoices: 0, maxChoices: 1, seatMode: "none", seatZones: "[]",
      createdAt: "2026-07-01T00:00:00Z", updatedAt: "2026-07-01T00:00:00Z"
    },
    {
      eventId: "event-b", spreadsheetId: "sheet-b", sheetName: "活动", title: "Activity B",
      description: "B", status: "open", opensAt: "", closesAt: "", location: "",
      selectionMode: "free", minChoices: 0, maxChoices: 1, seatMode: "none", seatZones: "[]",
      createdAt: "2026-07-01T00:00:00Z", updatedAt: "2026-07-01T00:00:00Z"
    }
  );
  rows["票券索引"].push(
    {
      ticketNumber: "EVT-AAA", tokenDigest: createHash("sha256").update("different-token").digest("hex"),
      eventId: "event-a", registrationId: "registration-a", status: "active",
      createdAt: "2026-07-01T00:00:00Z", updatedAt: "2026-07-01T00:00:00Z"
    },
    {
      ticketNumber: "EVT-BBB", tokenDigest, eventId: "event-b", registrationId: "registration-b",
      status: "active", createdAt: "2026-07-01T00:00:00Z", updatedAt: "2026-07-01T00:00:00Z"
    }
  );
  const harness = await createHarness({ rows });
  const context = await createPublicRegistrationContext(harness.sourceSheets, {}, {
    "sheet-a": eventSpreadsheetSheets("event-a", "Activity A"),
    "sheet-b": eventSpreadsheetSheets("event-b", "Activity B")
  });
  const registry = context.getRegistrySpreadsheet_();

  assert.equal(context.getEventSpreadsheet_(registry, "event-a").getId(), "sheet-a");
  assert.equal(context.getEventSpreadsheet_(registry, " event-b ").getId(), "sheet-b");
  assert.equal(context.getTicketRouteByNumber_(registry, " EVT-AAA ").eventId, "event-a");
  assert.equal(context.getTicketRouteByToken_(registry, " raw-secret-token ").eventId, "event-b");
  assert.notEqual(records(harness.sourceSheets["票券索引"])[1].tokenDigest, "raw-secret-token");

  assertPublicCode(() => context.getEventCatalogEntry_(registry, "missing"), "EVENT_NOT_FOUND");
  assertPublicCode(() => context.getTicketRouteByNumber_(registry, "missing"), "TICKET_NOT_FOUND");

  rows["活动目录"].push({ ...rows["活动目录"][0] });
  const duplicateContext = await createPublicRegistrationContext(
    Object.fromEntries(Object.entries(rows).map(([name, values]) => [name, new FakeSheet(name, values)])),
    {}, { "sheet-a": eventSpreadsheetSheets("event-a", "Activity A") }
  );
  assertPublicCode(
    () => duplicateContext.getEventCatalogEntry_(duplicateContext.getRegistrySpreadsheet_(), "event-a"),
    "INTEGRITY_ERROR"
  );

  const malformedRows = baseRows();
  malformedRows["活动目录"].push({ ...rows["活动目录"][0], spreadsheetId: "" });
  const malformedContext = await createPublicRegistrationContext(
    Object.fromEntries(Object.entries(malformedRows).map(([name, values]) => [name, new FakeSheet(name, values)])),
    {}
  );
  assertPublicCode(
    () => malformedContext.getEventCatalogEntry_(malformedContext.getRegistrySpreadsheet_(), "event-a"),
    "INTEGRITY_ERROR"
  );

  const selfMappedRows = baseRows();
  selfMappedRows["活动目录"].push({ ...rows["活动目录"][0], spreadsheetId: "source-sheet-id" });
  const selfMappedContext = await createPublicRegistrationContext(
    Object.fromEntries(Object.entries(selfMappedRows).map(([name, values]) => [name, new FakeSheet(name, values)])),
    {}
  );
  assertPublicCode(
    () => selfMappedContext.getEventCatalogEntry_(selfMappedContext.getRegistrySpreadsheet_(), "event-a"),
    "INTEGRITY_ERROR"
  );

  const mismatchedRows = baseRows();
  mismatchedRows["活动目录"].push({ ...rows["活动目录"][0] });
  const mismatchContext = await createPublicRegistrationContext(
    Object.fromEntries(Object.entries(mismatchedRows).map(([name, values]) => [name, new FakeSheet(name, values)])),
    {}, { "sheet-a": eventSpreadsheetSheets("other-event", "Activity A") }
  );
  assertPublicCode(
    () => mismatchContext.getEventSpreadsheet_(mismatchContext.getRegistrySpreadsheet_(), "event-a"),
    "INTEGRITY_ERROR"
  );

  const duplicateTicketRows = cloneRows(rows);
  duplicateTicketRows["票券索引"].push({ ...duplicateTicketRows["票券索引"][0] });
  const duplicateTicketContext = await createPublicRegistrationContext(
    Object.fromEntries(Object.entries(duplicateTicketRows).map(([name, values]) => [name, new FakeSheet(name, values)])),
    {}
  );
  assertPublicCode(
    () => duplicateTicketContext.getTicketRouteByNumber_(duplicateTicketContext.getRegistrySpreadsheet_(), "EVT-AAA"),
    "INTEGRITY_ERROR"
  );

  const malformedTicketRows = cloneRows(rows);
  malformedTicketRows["票券索引"][0].tokenDigest = "not-a-sha256-digest";
  const malformedTicketContext = await createPublicRegistrationContext(
    Object.fromEntries(Object.entries(malformedTicketRows).map(([name, values]) => [name, new FakeSheet(name, values)])),
    {}
  );
  assertPublicCode(
    () => malformedTicketContext.getTicketRouteByNumber_(malformedTicketContext.getRegistrySpreadsheet_(), "EVT-AAA"),
    "INTEGRITY_ERROR"
  );

  const missingIndexSheets = Object.fromEntries(Object.entries(baseRows())
    .filter(([name]) => name !== "票券索引")
    .map(([name, values]) => [name, new FakeSheet(name, values)]));
  const missingIndexContext = await createPublicRegistrationContext(missingIndexSheets, {});
  assertPublicCode(
    () => missingIndexContext.getTicketRouteByNumber_(missingIndexContext.getRegistrySpreadsheet_(), "EVT-AAA"),
    "INTEGRITY_ERROR"
  );

  const upsertRows = baseRows();
  upsertRows["活动目录"].push({ ...rows["活动目录"][0] }, { ...rows["活动目录"][1] });
  const upsertSheets = Object.fromEntries(Object.entries(upsertRows)
    .map(([name, values]) => [name, new FakeSheet(name, values)]));
  const upsertContext = await createPublicRegistrationContext(upsertSheets, {}, {
    "sheet-a": eventSpreadsheetSheets("event-a", "Activity A"),
    "sheet-b": eventSpreadsheetSheets("event-b", "Activity B")
  });
  const upsertRegistry = upsertContext.getRegistrySpreadsheet_();
  const initialRoute = {
    ticketNumber: "EVT-UPSERT", tokenDigest: upsertContext.digestTicketToken_("opaque-token"),
    eventId: "event-a", registrationId: "registration-a", status: "active",
    createdAt: "2026-07-01T00:00:00Z", updatedAt: "2026-07-01T00:00:00Z"
  };
  upsertContext.upsertTicketRoute_(upsertRegistry, initialRoute);
  upsertContext.upsertTicketRoute_(upsertRegistry, { ...initialRoute, status: "cancelled", updatedAt: "2026-07-02T00:00:00Z" });
  const upsertedRoutes = records(upsertSheets["票券索引"]);
  assert.equal(upsertedRoutes.length, 1);
  assert.equal(upsertedRoutes[0].status, "cancelled");
  assert.notEqual(upsertedRoutes[0].tokenDigest, "opaque-token");
  assertPublicCode(
    () => upsertContext.upsertTicketRoute_(upsertRegistry, {
      ...initialRoute,
      tokenDigest: upsertContext.digestTicketToken_("attacker-token"),
      eventId: "event-b",
      registrationId: "registration-b",
      updatedAt: "2026-07-03T00:00:00Z"
    }),
    "INTEGRITY_ERROR"
  );
  assert.deepEqual(records(upsertSheets["票券索引"])[0], {
    ...initialRoute,
    status: "cancelled",
    updatedAt: "2026-07-02T00:00:00Z"
  });
});

test("new activities create distinct initialized private Sheets and publish only protected URLs", async () => {
  const harness = await createHarness({ sessionEmail: " ADMIN@EXAMPLE.COM " });
  const originalCatalog = records(harness.sourceSheets["活动目录"]);
  const first = harness.context.saveAdminEvent({
    title: `Talk\u0000 A ${"x".repeat(180)}`,
    status: "draft"
  });
  const second = harness.context.saveAdminEvent({
    title: "Talk B",
    status: "draft"
  });

  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.equal(harness.createdSpreadsheets.length, 2);
  assert.notEqual(
    harness.createdSpreadsheets[0].getId(),
    harness.createdSpreadsheets[1].getId()
  );
  assert.equal(harness.createdSpreadsheets[0].editors.includes("admin@example.com"), true);
  assert.equal(harness.createdSpreadsheets[0].getName().length <= 100, true);
  assert.doesNotMatch(harness.createdSpreadsheets[0].getName(), /[\u0000-\u001f\u007f-\u009f]/);
  for (const spreadsheet of harness.createdSpreadsheets) {
    const expectedSheetNames = [
      "活动", "场次", "座位", "报名问题", "参加者",
      "报名项目", "签到记录", "操作记录"
    ];
    assert.deepEqual(Object.keys(spreadsheet.sheets).sort(), expectedSheetNames.sort());
    for (const sheetName of expectedSheetNames) {
      assert.deepEqual(Array.from(spreadsheet.sheets[sheetName].rows[0]), headers[sheetName]);
    }
  }

  const catalog = records(harness.sourceSheets["活动目录"]);
  assert.equal(catalog.length, originalCatalog.length + 2);
  assert.notEqual(catalog.at(-2).spreadsheetId, catalog.at(-1).spreadsheetId);
  assert.equal(JSON.stringify(first.data).includes("spreadsheetId"), false);
  assert.equal(
    first.data.sheetUrl,
    `https://docs.google.com/spreadsheets/d/${encodeURIComponent(catalog.at(-2).spreadsheetId)}/edit`
  );
});

test("activity drafts persist without a Sheet and finalization creates exactly one draft activity", async () => {
  const harness = await createHarness({
    sessionEmail: "admin@example.com",
    seedAdminRouting: false
  });
  const saved = harness.context.saveAdminDraft({
    event: {
      title: "Drafted education forum",
      status: "draft",
      selectionMode: "none",
      seatMode: "none"
    },
    sessions: [],
    seatPlan: { mode: "none", zones: [] },
    questions: []
  });

  assert.equal(saved.ok, true, JSON.stringify(saved));
  assert.match(saved.data.draftId, /^generated-/);
  assert.equal(harness.createdSpreadsheets.length, 0);
  assert.equal(records(harness.sourceSheets["活动目录"]).length, 0);
  assert.equal(records(harness.sourceSheets["活动草稿"]).length, 1);

  const generated = harness.context.finalizeAdminDraft({
    draftId: saved.data.draftId,
    confirm: true
  });
  assert.equal(generated.ok, true, JSON.stringify(generated));
  assert.equal(generated.data.status, "draft");
  assert.equal(harness.createdSpreadsheets.length, 1);
  assert.equal(records(harness.sourceSheets["活动目录"]).length, 1);
  assert.equal(
    records(harness.createdSpreadsheets[0].sheets["活动"])[0].status,
    "draft"
  );

  const repeated = harness.context.finalizeAdminDraft({
    draftId: saved.data.draftId,
    confirm: true
  });
  assert.equal(repeated.ok, true, JSON.stringify(repeated));
  assert.equal(repeated.data.alreadyFinalized, true);
  assert.equal(harness.createdSpreadsheets.length, 1);
});

test("an ungenerated activity draft can be deleted without touching activity Sheets", async () => {
  const harness = await createHarness({ seedAdminRouting: false });
  const saved = harness.context.saveAdminDraft({
    event: {
      title: "Disposable draft",
      status: "draft",
      selectionMode: "none",
      seatMode: "none"
    },
    sessions: [],
    seatPlan: { mode: "none", zones: [] },
    questions: []
  });
  assert.equal(saved.ok, true, JSON.stringify(saved));

  const deleted = harness.context.deleteAdminDraft({
    draftId: saved.data.draftId,
    confirm: true
  });
  assert.equal(deleted.ok, true, JSON.stringify(deleted));
  assert.equal(records(harness.sourceSheets["活动草稿"]).length, 0);
  assert.equal(harness.createdSpreadsheets.length, 0);
});

test("an empty generated activity can be trashed but activity history blocks deletion", async () => {
  const emptyHarness = await createHarness({ seedAdminRouting: false });
  const created = emptyHarness.context.saveAdminEvent({
    title: "Empty generated event",
    status: "draft"
  });
  assert.equal(created.ok, true, JSON.stringify(created));
  const eventId = created.data.eventId;
  const deleted = emptyHarness.context.deleteEmptyAdminEvent({
    eventId,
    confirm: true
  });
  assert.equal(deleted.ok, true, JSON.stringify(deleted));
  assert.equal(records(emptyHarness.sourceSheets["活动目录"]).length, 0);
  assert.deepEqual(emptyHarness.trashedFiles, ["created-activity-1"]);

  const historyHarness = await createHarness();
  const denied = historyHarness.context.deleteEmptyAdminEvent({
    eventId: "event-1",
    confirm: true
  });
  assert.equal(denied.ok, false);
  assert.equal(denied.code, "CONFLICT");
  assert.equal(records(historyHarness.sourceSheets["活动目录"]).length, 1);
  assert.deepEqual(historyHarness.trashedFiles, []);
});

test("failed activity preparation never publishes a catalog entry or changes existing entries", async (t) => {
  const stages = [
    ["create", { createActivityError: new Error("injected create failure") }],
    ["initialize", { initializeActivityError: new Error("injected initialize failure") }],
    ["event write", { failCreatedEventWrite: new Error("injected event write failure") }],
    ["catalog write", {}],
    ["catalog post-write", {}]
  ];

  for (const [stage, options] of stages) {
    await t.test(stage, async () => {
      const harness = await createHarness(options);
      const before = JSON.stringify(records(harness.sourceSheets["活动目录"]));
      if (stage === "catalog write") {
        harness.sourceSheets["活动目录"].failNextWrite(
          new Error("injected catalog write failure")
        );
      }
      if (stage === "catalog post-write") {
        harness.sourceSheets["活动目录"].afterNextWrite(() => {
          throw new Error("injected catalog post-write failure");
        });
      }

      const result = harness.context.saveAdminEvent({
        title: `Unpublished ${stage}`,
        status: "draft"
      });

      assert.equal(result.ok, false, JSON.stringify(result));
      assert.equal(JSON.stringify(records(harness.sourceSheets["活动目录"])), before);
    });
  }
});

test("normal activity creation rejects a client-submitted Sheet ID", async () => {
  const harness = await createHarness();
  const before = JSON.stringify(records(harness.sourceSheets["活动目录"]));

  const result = harness.context.saveAdminEvent({
    title: "Must not use attacker Sheet",
    status: "draft",
    spreadsheetId: "target-sheet-id"
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "INVALID_REQUEST");
  assert.equal(harness.createdSpreadsheets.length, 0);
  assert.equal(JSON.stringify(records(harness.sourceSheets["活动目录"])), before);
});

test("protected dashboard and mutations route only through the selected activity Sheet", async () => {
  const rows = baseRows();
  const event2Sheets = eventSpreadsheetSheets("event-2", "Second Activity");
  rows["活动目录"].push(
    {
      ...rows["活动"][0],
      spreadsheetId: "source-event-sheet-id",
      sheetName: "活动"
    },
    {
      ...records(event2Sheets["活动"])[0],
      spreadsheetId: "event-2-sheet",
      sheetName: "活动"
    }
  );
  const harness = await createHarness({
    rows,
    additionalSpreadsheets: { "event-2-sheet": event2Sheets }
  });
  addTicketRoute(harness.sourceSheets, event2Sheets);

  const catalogOnly = harness.context.getAdminDashboard({});
  assert.equal(catalogOnly.ok, true, JSON.stringify(catalogOnly));
  assert.equal(catalogOnly.data.events.length, 2);
  for (const collection of ["sessions", "seats", "questions", "records", "attendance"]) {
    assert.equal(catalogOnly.data[collection].length, 0, collection);
  }

  const dashboard = harness.context.getAdminDashboard({
    eventId: "event-2",
    search: "alice@example.com"
  });
  assert.equal(dashboard.ok, true, JSON.stringify(dashboard));
  assert.deepEqual(
    Array.from(dashboard.data.events, (event) => event.eventId),
    ["event-1", "event-2"]
  );
  assert.equal(dashboard.data.events.every((event) => typeof event.sheetUrl === "string"), true);
  for (const collection of ["sessions", "seats", "questions", "records", "attendance"]) {
    assert.equal(
      dashboard.data[collection].every((item) => item.eventId === "event-2"),
      true,
      collection
    );
  }
  assert.equal(JSON.stringify(dashboard.data).includes("spreadsheetId"), false);

  assert.equal(harness.context.saveAdminEvent({
    eventId: "event-2",
    title: "Second Activity Updated"
  }).ok, true);
  assert.equal(harness.context.saveAdminSession({
    eventId: "event-2",
    title: "Second Session",
    status: "open"
  }).ok, true);
  assert.equal(harness.context.saveAdminQuestion({
    eventId: "event-2",
    label: "Second Question",
    type: "text"
  }).ok, true);
  assert.equal(harness.context.saveAdminSeatPlan({
    eventId: "event-2",
    action: "generate",
    mode: "self",
    zones: [{ name: "B", rows: 1, seatsPerRow: 1 }]
  }).ok, true);
  const catalogAfterSeatPlan = records(harness.sourceSheets["活动目录"])
    .find((entry) => entry.eventId === "event-2");
  assert.equal(catalogAfterSeatPlan.seatMode, "self");
  assert.deepEqual(JSON.parse(catalogAfterSeatPlan.seatZones), ["A", "B"]);
  assert.equal(harness.context.adminRecordAction({
    eventId: "event-2",
    registrationId: "registration-1",
    action: "cancel_registration",
    confirm: true
  }).ok, true);

  assert.equal(records(event2Sheets["活动"])[0].title, "Second Activity Updated");
  assert.equal(records(harness.sourceSheets["活动"])[0].title, "Ideas Forum");
  assert.equal(records(event2Sheets["报名项目"])[0].status, "cancelled");
  assert.equal(records(harness.sourceSheets["报名项目"])[0].status, "active");
});

test("session, question, and seat IDs fail closed when stray cross-event rows share the selected Sheet", async (t) => {
  async function harnessFor(event2Sheets) {
    const rows = baseRows();
    rows["活动目录"].push({
      ...records(event2Sheets["活动"])[0],
      spreadsheetId: "event-2-sheet",
      sheetName: "活动"
    });
    return createHarness({
      rows,
      additionalSpreadsheets: { "event-2-sheet": event2Sheets }
    });
  }

  await t.test("session update", async () => {
    const event2Sheets = eventSpreadsheetSheets("event-2", "Second Activity");
    event2Sheets["场次"].rows.push(headers["场次"].map((key) => ({
      sessionId: "stray-session",
      eventId: "event-1",
      title: "Stray session",
      status: "open",
      createdAt: "2026-07-01T00:00:00Z",
      updatedAt: "2026-07-01T00:00:00Z"
    })[key] ?? ""));
    const harness = await harnessFor(event2Sheets);
    const before = JSON.stringify(records(event2Sheets["场次"]));

    const result = harness.context.saveAdminSession({
      eventId: "event-2",
      sessionId: "stray-session",
      title: "Must not move",
      status: "open"
    });

    assert.equal(result.code, "CONFLICT");
    assert.equal(JSON.stringify(records(event2Sheets["场次"])), before);
  });

  await t.test("duplicate question ID", async () => {
    const event2Sheets = eventSpreadsheetSheets("event-2", "Second Activity");
    const existing = records(event2Sheets["报名问题"])[0];
    event2Sheets["报名问题"].rows.push(headers["报名问题"].map((key) => ({
      ...existing,
      eventId: "event-1"
    })[key] ?? ""));
    const harness = await harnessFor(event2Sheets);
    const before = JSON.stringify(records(event2Sheets["报名问题"]));

    const result = harness.context.saveAdminQuestion({
      eventId: "event-2",
      questionId: existing.questionId,
      label: "Must not update"
    });

    assert.equal(result.code, "INTEGRITY_ERROR");
    assert.equal(JSON.stringify(records(event2Sheets["报名问题"])), before);
  });

  await t.test("duplicate seat ID", async () => {
    const event2Sheets = eventSpreadsheetSheets("event-2", "Second Activity");
    const existing = records(event2Sheets["座位"])
      .find((seat) => seat.seatId === "seat-new");
    event2Sheets["座位"].rows.push(headers["座位"].map((key) => ({
      ...existing,
      eventId: "event-1"
    })[key] ?? ""));
    const harness = await harnessFor(event2Sheets);
    const before = JSON.stringify(records(event2Sheets["座位"]));

    const result = harness.context.saveAdminSeatPlan({
      eventId: "event-2",
      action: "reserve",
      seatId: existing.seatId
    });

    assert.equal(result.code, "INTEGRITY_ERROR");
    assert.equal(JSON.stringify(records(event2Sheets["座位"])), before);
  });

  await t.test("seat generation session ID", async () => {
    const event2Sheets = eventSpreadsheetSheets("event-2", "Second Activity");
    event2Sheets["场次"].rows.push(headers["场次"].map((key) => ({
      sessionId: "stray-session",
      eventId: "event-1",
      title: "Stray session",
      status: "open",
      createdAt: "2026-07-01T00:00:00Z",
      updatedAt: "2026-07-01T00:00:00Z"
    })[key] ?? ""));
    const harness = await harnessFor(event2Sheets);
    const beforeSeats = JSON.stringify(records(event2Sheets["座位"]));
    const beforeEvent = JSON.stringify(records(event2Sheets["活动"]));

    const result = harness.context.saveAdminSeatPlan({
      eventId: "event-2",
      sessionId: "stray-session",
      action: "generate",
      mode: "self",
      zones: [{ name: "", rows: 1, seatsPerRow: 1 }]
    });

    assert.equal(result.code, "CONFLICT");
    assert.equal(JSON.stringify(records(event2Sheets["座位"])), beforeSeats);
    assert.equal(JSON.stringify(records(event2Sheets["活动"])), beforeEvent);
  });
});

test("record cancellation and seat adjustment ignore stray cross-event seats", async (t) => {
  async function harnessFor(event2Sheets) {
    const rows = baseRows();
    rows["活动目录"].push({
      ...records(event2Sheets["活动"])[0],
      spreadsheetId: "event-2-sheet",
      sheetName: "活动"
    });
    const harness = await createHarness({
      rows,
      additionalSpreadsheets: { "event-2-sheet": event2Sheets }
    });
    addTicketRoute(harness.sourceSheets, event2Sheets);
    return harness;
  }

  function addStraySeat(event2Sheets) {
    event2Sheets["座位"].rows.push(headers["座位"].map((key) => ({
      seatId: "stray-seat",
      eventId: "event-1",
      sessionId: "session-1",
      label: "X-01",
      zone: "X",
      status: "registered",
      holderRegistrationId: "registration-1",
      createdAt: "2026-07-01T00:00:00Z",
      updatedAt: "2026-07-01T00:00:00Z"
    })[key] ?? ""));
  }

  await t.test("cancellation", async () => {
    const event2Sheets = eventSpreadsheetSheets("event-2", "Second Activity");
    addStraySeat(event2Sheets);
    const harness = await harnessFor(event2Sheets);

    const result = harness.context.adminRecordAction({
      eventId: "event-2",
      action: "cancel_registration",
      registrationId: "registration-1",
      confirm: true
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    const stray = records(event2Sheets["座位"])
      .find((seat) => seat.seatId === "stray-seat");
    assert.equal(stray.status, "registered");
    assert.equal(stray.holderRegistrationId, "registration-1");
  });

  await t.test("seat adjustment", async () => {
    const event2Sheets = eventSpreadsheetSheets("event-2", "Second Activity");
    addStraySeat(event2Sheets);
    const harness = await harnessFor(event2Sheets);

    const result = harness.context.adminRecordAction({
      eventId: "event-2",
      action: "adjust_seat",
      registrationId: "registration-1",
      seatId: "seat-new",
      confirm: true
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    const stray = records(event2Sheets["座位"])
      .find((seat) => seat.seatId === "stray-seat");
    assert.equal(stray.status, "registered");
    assert.equal(stray.holderRegistrationId, "registration-1");
  });
});

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
  const eventRoute = addPublicEventRoute(harness.sourceSheets, harness.sourceSheets);
  addTicketRoute(harness.sourceSheets, harness.sourceSheets);
  const publicContext = await createPublicRegistrationContext(
    harness.sourceSheets,
    {},
    { "target-sheet-id": harness.targetSheets, ...eventRoute }
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

test("administrator policy persists seat holds, semantic field roles, and normalized constraints", async () => {
  const harness = await createHarness();
  const event = harness.context.saveAdminEvent({
    eventId: "event-1",
    title: "Policy event",
    seatHoldsEnabled: true,
    seatHoldMinutes: 3
  });
  assert.equal(event.ok, true, JSON.stringify(event));
  assert.equal(event.data.seatHoldsEnabled, true);
  assert.equal(event.data.seatHoldMinutes, 3);

  const question = harness.context.saveAdminQuestion({
    eventId: "event-1",
    label: "Contact email",
    type: "email",
    required: true,
    semanticRole: "email",
    showOnTicket: true,
    options: [],
    validation: { minLength: 6, maxLength: 120 }
  });
  assert.equal(question.ok, true, JSON.stringify(question));
  assert.equal(question.data.semanticRole, "email");
  assert.deepEqual({ ...question.data.validation }, { minLength: 6, maxLength: 120 });

  const questionSheet = sheetByHeader(harness.sourceSheets, "questionId");
  const storedQuestion = records(questionSheet)
    .find((row) => row.questionId === question.data.questionId);
  assert.deepEqual(JSON.parse(storedQuestion.options), {
    choices: [],
    minLength: 6,
    maxLength: 120
  });
  const settings = JSON.parse(registryValue(harness, "ADMIN_SETTINGS"));
  assert.equal(settings.registration.events["event-1"].fieldRoles.email, question.data.questionId);

  const before = JSON.stringify(records(questionSheet));
  assert.equal(harness.context.saveAdminQuestion({
    eventId: "event-1",
    label: "Broken",
    type: "text",
    required: true,
    semanticRole: "unknown-role",
    validation: { minLength: 10, maxLength: 2 }
  }).code, "INVALID_REQUEST");
  assert.equal(JSON.stringify(records(questionSheet)), before);
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

  assert.equal(harness.context.saveAdminSeatPlan({
    eventId: "event-1", action: "reserve", seatId: generated.seatId
  }).data.status, "reserved");
  assert.equal(harness.context.saveAdminSeatPlan({
    eventId: "event-1", action: "close", seatId: generated.seatId
  }).data.status, "closed");
  assert.equal(harness.context.saveAdminSeatPlan({
    eventId: "event-1", action: "reopen", seatId: generated.seatId
  }).data.status, "available");
  assert.equal(records(harness.sourceSheets["座位"]).length, count);
});

test("dashboard search masks participant fields and answers while returning attendance", async () => {
  const harness = await createHarness();
  const result = harness.context.getAdminDashboard({
    eventId: "event-1",
    search: "alice@example.com"
  });

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

  const result = harness.context.getAdminDashboard({ eventId: "event-1" });

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

  const result = harness.context.getAdminDashboard({ eventId: "event-1" });

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
    eventId: "event-1",
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
    eventId: "event-1",
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
      eventId: "event-1",
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
    eventId: "event-1",
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

  const eventRoute = addPublicEventRoute(harness.sourceSheets, harness.sourceSheets);
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
    },
    eventRoute
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
  const eventRoute = addPublicEventRoute(harness.sourceSheets, harness.sourceSheets);
  const publicContext = await createPublicRegistrationContext(
    harness.sourceSheets,
    {
      registration: {
        identityFields: ["email"],
        events: { "event-1": { identityFields: ["email"] } }
      }
    },
    { "target-sheet-id": harness.targetSheets, ...eventRoute }
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
  const harness = await createHarness({ rows, targetRows, seedTicketRouting: true });
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

    const eventRoute = addPublicEventRoute(harness.sourceSheets, harness.sourceSheets);
    const publicContext = await createPublicRegistrationContext(
      harness.sourceSheets,
      {
        registration: {
          identityFields: ["email"],
          events: { "event-1": { identityFields: ["email"] } }
        }
      },
      eventRoute
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

  const eventRoute = addPublicEventRoute(harness.sourceSheets, harness.sourceSheets);
  const publicContext = await createPublicRegistrationContext(
    harness.sourceSheets,
    {
      registration: {
        identityFields: ["email"],
        events: { "event-1": { identityFields: ["email"] } }
      }
    },
    eventRoute
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
  const dashboard = harness.context.getAdminDashboard({ eventId: "event-1" });

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

test("an identity question lookup cannot cross into an unregistered activity route", async () => {
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

  assert.equal(result.code, "NOT_FOUND");
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
  const cancellationHarness = await createHarness({ seedTicketRouting: true });
  const cancellationCounts = Object.fromEntries(Object.entries(cancellationHarness.sourceSheets)
    .map(([name, sheet]) => [name, sheet.rows.length]));
  const cancelled = cancellationHarness.context.adminRecordAction({
    eventId: "event-1",
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
    eventId: "event-1",
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
        staffAllowlist: ["admin@example.com"],
        seedTicketRouting: true
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
  const eventRoute = addPublicEventRoute(
    harness.sourceSheets,
    harness.targetSheets,
    "target-sheet-id"
  );
  const publicContext = await createPublicRegistrationContext(
    harness.sourceSheets,
    {},
    { "target-sheet-id": harness.targetSheets, ...eventRoute }
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

test("real public event reads expose only safe visible projections and authoritative server time", async () => {
  const rows = baseRows();
  rows["活动"].push(
    {
      ...rows["活动"][0],
      eventId: "draft-event",
      title: "Private draft",
      status: "draft"
    },
    {
      ...rows["活动"][0],
      eventId: "archived-event",
      title: "Private archive",
      status: "archived"
    },
    {
      ...rows["活动"][0],
      eventId: "upcoming-event",
      title: "Public preview",
      status: "upcoming"
    }
  );
  rows["场次"].push({
    ...rows["场次"][0],
    sessionId: "draft-session",
    title: "Hidden session",
    status: "draft"
  });
  rows["座位"].push({
    seatId: "held-private-seat",
    eventId: "event-1",
    sessionId: "session-1",
    label: "SECRET-HOLD",
    zone: "A",
    status: "held",
    holderRegistrationId: "HOLD|private-owner|9999999999999",
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z"
  });
  rows["报名问题"][0].options = JSON.stringify({
    choices: [],
    minLength: 6,
    maxLength: 120,
    pattern: "^[^@]+@[^@]+$"
  });
  rows["\u6d3b\u52a8\u76ee\u5f55"].push(...rows["\u6d3b\u52a8"].map((event) => ({
    ...event,
    spreadsheetId: event.eventId === "event-1" ? "event-1-sheet" : "unused-" + event.eventId,
    sheetName: "\u6d3b\u52a8"
  })));
  const harness = await createHarness({ rows, nowIso: "2026-08-10T04:00:00Z" });
  const event1Sheets = eventSpreadsheetSheets("event-1", "Ideas Forum");
  event1Sheets["座位"].rows.push(headers["座位"].map((key) => ({
    seatId: "held-private-seat",
    eventId: "event-1",
    sessionId: "session-1",
    label: "SECRET-HOLD",
    zone: "A",
    status: "held",
    holderRegistrationId: "HOLD|private-owner|9999999999999",
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z"
  })[key] ?? ""));
  const questionSheet = Object.values(event1Sheets)
    .find((sheet) => headers[sheet.name].includes("questionId"));
  questionSheet.rows[1][headers[questionSheet.name].indexOf("options")] =
    rows["\u62a5\u540d\u95ee\u9898"][0].options;
  const context = await createPublicRegistrationContext(harness.sourceSheets, {}, {
    "event-1-sheet": event1Sheets
  });

  const listed = context.listEvents({});
  assert.equal(listed.ok, true, JSON.stringify(listed));
  assert.equal(listed.data.serverNow, "2026-08-10T04:00:00.000Z");
  assert.deepEqual(
    Array.from(listed.data.events, (event) => event.id).sort(),
    ["event-1", "upcoming-event"]
  );
  assert.equal(JSON.stringify(listed.data).includes("Private draft"), false);
  assert.equal(JSON.stringify(listed.data).includes("source-sheet-id"), false);

  const detail = context.getEvent({ eventId: "event-1" });
  assert.equal(detail.ok, true, JSON.stringify(detail));
  assert.equal(detail.data.serverNow, "2026-08-10T04:00:00.000Z");
  assert.deepEqual(
    Array.from(detail.data.event.sessions, (session) => session.id),
    ["session-1"]
  );
  assert.equal(detail.data.event.fields[0].constraints.minLength, 6);
  assert.equal(detail.data.event.fields[0].constraints.maxLength, 120);
  const unavailableSeat = detail.data.event.seats.find(
    (seat) => seat.id === "held-private-seat"
  );
  assert.equal(unavailableSeat.available, false);
  assert.equal(JSON.stringify(detail.data).includes("holderRegistrationId"), false);
  assert.equal(JSON.stringify(detail.data).includes("private-owner"), false);
  assert.equal(JSON.stringify(detail.data).includes("rowNumber"), false);

  assert.equal(context.getEvent({ eventId: "draft-event" }).code, "EVENT_NOT_FOUND");
  assert.equal(context.getEvent({ eventId: "archived-event" }).code, "EVENT_NOT_FOUND");
});

test("public catalog lists safe visible activities and reads only the requested activity sheet", async () => {
  const rows = baseRows();
  const catalogKey = Object.keys(headers).find((name) => headers[name].includes("spreadsheetId"));
  rows[catalogKey].push(
    {
      eventId: "event-a", spreadsheetId: "sheet-a", sheetName: "\u6d3b\u52a8", title: "Activity A",
      description: "Private notes stay private", status: "open", opensAt: "2026-08-01T00:00:00Z",
      closesAt: "2026-08-15T00:00:00Z", location: "Main Hall", selectionMode: "free",
      minChoices: 1, maxChoices: 2, seatMode: "self", seatZones: JSON.stringify(["A"]),
      createdAt: "2026-07-01T00:00:00Z", updatedAt: "2026-07-01T00:00:00Z"
    },
    {
      eventId: "event-b", spreadsheetId: "sheet-b", sheetName: "\u6d3b\u52a8", title: "Activity B",
      description: "Private notes stay private", status: "open", opensAt: "2026-08-01T00:00:00Z",
      closesAt: "2026-08-15T00:00:00Z", location: "Main Hall", selectionMode: "free",
      minChoices: 1, maxChoices: 2, seatMode: "self", seatZones: JSON.stringify(["A"]),
      createdAt: "2026-07-01T00:00:00Z", updatedAt: "2026-07-01T00:00:00Z"
    },
    {
      eventId: "draft-event", spreadsheetId: "draft-sheet", sheetName: "\u6d3b\u52a8", title: "Private draft",
      description: "Private", status: "draft", opensAt: "", closesAt: "", location: "",
      selectionMode: "free", minChoices: 0, maxChoices: 1, seatMode: "none", seatZones: "[]",
      createdAt: "2026-07-01T00:00:00Z", updatedAt: "2026-07-01T00:00:00Z"
    }
  );
  const harness = await createHarness({ rows });
  const context = await createPublicRegistrationContext(harness.sourceSheets, {}, {
    "sheet-a": eventSpreadsheetSheets("event-a", "Activity A"),
    "sheet-b": eventSpreadsheetSheets("event-b", "Activity B"),
    "draft-sheet": eventSpreadsheetSheets("draft-event", "Private draft")
  });

  const listed = context.listEvents({});
  assert.equal(listed.ok, true, JSON.stringify(listed));
  assert.deepEqual(Array.from(listed.data.events, (event) => event.id), ["event-a", "event-b"]);
  assert.equal(JSON.stringify(listed).includes("sheet-a"), false);
  assert.equal(JSON.stringify(listed).includes("spreadsheetId"), false);
  assert.equal(JSON.stringify(listed).includes("sheetUrl"), false);
  assert.equal(JSON.stringify(listed).includes("Private draft"), false);

  const detail = context.getEvent({ eventId: "event-b" });
  assert.equal(detail.ok, true, JSON.stringify(detail));
  assert.equal(detail.data.event.title, "Activity B");
  assert.equal(JSON.stringify(detail).includes("sheetUrl"), false);
  assert.deepEqual(context.__openedSpreadsheetIds, ["source-sheet-id", "source-sheet-id", "sheet-b"]);
});

test("public catalog fails closed for malformed routes and duplicate visible event IDs", async () => {
  const catalogEntry = (overrides = {}) => ({
    eventId: "event-a", spreadsheetId: "sheet-a", sheetName: "\u6d3b\u52a8", title: "Activity A",
    description: "A", status: "open", opensAt: "", closesAt: "", location: "",
    selectionMode: "free", minChoices: 0, maxChoices: 1, seatMode: "none", seatZones: "[]",
    createdAt: "2026-07-01T00:00:00Z", updatedAt: "2026-07-01T00:00:00Z",
    ...overrides
  });
  const cases = [
    [catalogEntry({ spreadsheetId: "" })],
    [catalogEntry({ sheetName: "wrong-sheet" })],
    [catalogEntry({ spreadsheetId: "source-sheet-id" })],
    [catalogEntry(), catalogEntry()]
  ];

  for (const catalogRows of cases) {
    const rows = baseRows();
    rows["\u6d3b\u52a8\u76ee\u5f55"].push(...catalogRows);
    const harness = await createHarness({ rows });
    const context = await createPublicRegistrationContext(harness.sourceSheets, {});

    assert.equal(context.listEvents({}).code, "INTEGRITY_ERROR");
  }
});

test("hidden malformed catalog rows remain not found without opening an activity sheet", async () => {
  const rows = baseRows();
  rows["\u6d3b\u52a8\u76ee\u5f55"].push({
    eventId: "draft-event", spreadsheetId: "", sheetName: "wrong-sheet", title: "Private draft",
    description: "Private", status: "draft", opensAt: "", closesAt: "", location: "",
    selectionMode: "free", minChoices: 0, maxChoices: 1, seatMode: "none", seatZones: "[]",
    createdAt: "2026-07-01T00:00:00Z", updatedAt: "2026-07-01T00:00:00Z"
  });
  const harness = await createHarness({ rows });
  const context = await createPublicRegistrationContext(harness.sourceSheets, {});

  assert.equal(context.getEvent({ eventId: "draft-event" }).code, "EVENT_NOT_FOUND");
  assert.deepEqual(context.__openedSpreadsheetIds, ["source-sheet-id"]);
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
