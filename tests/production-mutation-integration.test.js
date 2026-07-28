import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { createHash, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";

const publicRoot = new URL("../apps-script/", import.meta.url);
const staffRoot = new URL("../staff-apps-script/", import.meta.url);
const adminScriptUrl = new URL("../staff-apps-script/AdminScript.html", import.meta.url);
const sharedSecret = "production-integration-shared-secret-32";

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
  constructor(name, records = [], onWrite) {
    this.name = name;
    this.onWrite = onWrite;
    const sheetHeaders = headers[name];
    this.rows = sheetHeaders ? [
      sheetHeaders.slice(),
      ...records.map((record) => sheetHeaders.map((key) => record[key] ?? ""))
    ] : [];
    this.afterWriteCallbacks = [];
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
  afterNextWrite(callback) {
    this.afterWriteCallbacks.push(callback);
  }
  notifyWrite() {
    const callback = this.afterWriteCallbacks.shift();
    if (callback) callback();
  }
  insertRowsBefore(row, count) {
    this.onWrite?.(this.name);
    this.rows.splice(row - 1, 0, ...Array.from({ length: count }, () => []));
    this.notifyWrite();
  }
  getRange(row, column, rowCount, columnCount) {
    return {
      getValues: () => Array.from({ length: rowCount }, (_, y) =>
        Array.from({ length: columnCount }, (_, x) =>
          this.rows[row - 1 + y]?.[column - 1 + x] ?? "")),
      setValues: (values) => {
        this.onWrite?.(this.name);
        values.forEach((source, y) => {
          const target = this.rows[row - 1 + y] || [];
          source.forEach((value, x) => { target[column - 1 + x] = value; });
          this.rows[row - 1 + y] = target;
        });
        this.notifyWrite();
      }
    };
  }
  appendRow(values) {
    this.onWrite?.(this.name);
    this.rows.push(values.slice());
    this.notifyWrite();
  }
  deleteRow(row) {
    this.onWrite?.(this.name);
    this.rows.splice(row - 1, 1);
    this.notifyWrite();
  }
  deleteRows(row, count) {
    this.onWrite?.(this.name);
    this.rows.splice(row - 1, count);
    this.notifyWrite();
  }
}

function rows(sheet) {
  return sheet.rows.slice(1).map((values) =>
    Object.fromEntries(headers[sheet.name].map((key, index) => [key, values[index]])));
}

function fixture() {
  const settings = {
    attendance: { earlyMinutes: 90, lateMinutes: 90 },
    registration: {
      identityFields: ["email"],
      events: {
        "event-1": {
          identityFields: ["email"],
          cancellationEnabled: true,
          seatExchangeEnabled: true,
          showOnTicketFields: []
        }
      }
    }
  };
  return {
    "系统设置": [{
      key: "ADMIN_SETTINGS",
      value: JSON.stringify(settings),
      updatedAt: "2026-08-16T08:00:00.000Z"
    }],
    "活动": [{
      eventId: "event-1",
      title: "Live Forum",
      description: "",
      status: "live",
      opensAt: "2026-01-01T00:00:00.000Z",
      closesAt: "2026-08-15T00:00:00.000Z",
      location: "Hall",
      selectionMode: "single",
      minChoices: 1,
      maxChoices: 1,
      seatMode: "none",
      seatZones: "[]",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    }],
    "场次": [{
      sessionId: "session-1",
      eventId: "event-1",
      title: "Opening",
      speaker: "Lin",
      startsAt: "2026-08-16T09:00:00.000Z",
      endsAt: "2026-08-16T10:00:00.000Z",
      required: true,
      capacity: 30,
      status: "open",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    }],
    "座位": [],
    "报名问题": [{
      questionId: "email",
      eventId: "event-1",
      label: "Email",
      type: "email",
      required: true,
      options: "{}",
      sortOrder: 1,
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    }],
    "参加者": [{
      participantId: "participant-1",
      name: "Alice",
      phone: "",
      email: "alice@example.com",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    }],
    "报名项目": [{
      registrationId: "registration-1",
      eventId: "event-1",
      participantId: "participant-1",
      ticketNumber: "EVT-ONE",
      status: "active",
      sessionIds: JSON.stringify(["session-1"]),
      seatChoices: "[]",
      answers: JSON.stringify({
        values: { email: "alice@example.com" },
        ticketToken: "physical-camera-token",
        verificationField: "email"
      }),
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    }],
    "签到记录": [],
    "操作记录": []
  };
}

function utilityService() {
  let uuid = 0;
  return {
    getUuid: () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, "0")}`,
    DigestAlgorithm: { SHA_256: "SHA_256" },
    Charset: { UTF_8: "UTF_8" },
    computeDigest: (_algorithm, value) => Array.from(createHash("sha256").update(value).digest()),
    computeHmacSha256Signature: (value, key) =>
      Array.from(createHmac("sha256", key).update(value).digest()),
    base64EncodeWebSafe: (bytes) => Buffer.from(bytes).toString("base64url")
  };
}

async function createSystem({ onWrite, failActivityCreationStage, extraSheetData = {} } = {}) {
  let now = "2026-08-16T09:30:00.000Z";
  class ServerDate extends Date {
    constructor(value) { super(value === undefined ? now : value); }
    static now() { return Date.parse(now); }
  }
  const publicProperties = {
    ACTIVE_SPREADSHEET_ID: "registry-sheet",
    INTERNAL_API_SHARED_SECRET: sharedSecret,
    PUBLIC_BASE_URL: "https://events.example.org/summer"
  };
  const publicPropertyStore = {
    getProperty: (key) => publicProperties[key] ?? null,
    setProperty: (key, value) => { publicProperties[key] = value; },
    deleteProperty: (key) => { delete publicProperties[key]; },
    getProperties: () => ({ ...publicProperties })
  };
  let publicLockDepth = 0;
  const lockEvents = [];
  const waiting = [];
  let arrivalHook = null;
  let arrivalTriggered = false;
  const data = fixture();
  const settingsRows = data["系统设置"];
  delete data["系统设置"];
  const registryData = {
    "系统设置": [
      ...settingsRows,
      {
        key: "ACTIVE_SPREADSHEET_ID",
        value: "activity-sheet",
        updatedAt: "2026-08-16T08:00:00.000Z"
      }
    ],
    "活动草稿": [],
    "活动目录": [{
      eventId: "event-1",
      spreadsheetId: "activity-sheet",
      sheetName: "活动",
      title: "Live Forum",
      description: "",
      status: "live",
      opensAt: "2026-01-01T00:00:00.000Z",
      closesAt: "2026-08-15T00:00:00.000Z",
      location: "Hall",
      selectionMode: "single",
      minChoices: 1,
      maxChoices: 1,
      seatMode: "none",
      seatZones: "[]",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    }],
    "票券索引": [{
      ticketNumber: "EVT-ONE",
      tokenDigest: createHash("sha256").update("physical-camera-token").digest("hex"),
      eventId: "event-1",
      registrationId: "registration-1",
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    }],
    "操作记录": []
  };
  let catalogFailurePending = failActivityCreationStage === "catalog";
  const createSheets = (source, kind) => Object.fromEntries(Object.entries(source).map(([name, records]) => [
    name,
    new FakeSheet(name, records, (sheetName) => {
      assert.equal(publicLockDepth, 1, `${sheetName} changed outside the public lock`);
      if (kind === "registry" && sheetName === "活动目录" && catalogFailurePending) {
        catalogFailurePending = false;
        throw new Error("injected catalog failure");
      }
      onWrite?.(sheetName);
      if (arrivalHook && !arrivalTriggered && sheetName === "活动") {
        arrivalTriggered = true;
        arrivalHook(waiting);
      }
    })
  ]));
  const sheets = createSheets(data, "activity");
  const registrySheets = createSheets(registryData, "registry");
  const activitySpreadsheet = {
    getId: () => "activity-sheet",
    getName: () => "Activity",
    getSheetByName: (name) => sheets[name] || null
  };
  const registrySpreadsheet = {
    getId: () => "registry-sheet",
    getName: () => "Registry",
    getSheetByName: (name) => registrySheets[name] || null
  };
  const extraSpreadsheets = Object.fromEntries(
    Object.entries(extraSheetData).map(([id, source]) => {
      const extraSheets = Object.fromEntries(Object.entries(source).map(([name, records]) => [
        name,
        new FakeSheet(name, records)
      ]));
      return [id, {
        getId: () => id,
        getName: () => id,
        getSheetByName: (name) => extraSheets[name] || null,
        sheets: extraSheets
      }];
    })
  );
  const createdSpreadsheets = [];
  const createdById = {};
  const trashedFiles = [];
  let createdCount = 0;
  const publicContext = vm.createContext({
    console,
    JSON, Object, Array, String, Number, RegExp, Error, Math, isFinite,
    Date: ServerDate,
    PropertiesService: { getScriptProperties: () => publicPropertyStore },
    SpreadsheetApp: {
      openById: (id) => {
        if (id === "registry-sheet") return registrySpreadsheet;
        if (id === "activity-sheet") return activitySpreadsheet;
        if (createdById[id]) return createdById[id];
        if (extraSpreadsheets[id]) return extraSpreadsheets[id];
        throw new Error("missing spreadsheet");
      },
      create: (name) => {
        if (failActivityCreationStage === "create") {
          throw new Error("injected create failure");
        }
        const id = `created-activity-${++createdCount}`;
        const createdSheets = {};
        const writeCounts = {};
        const registerCreatedSheet = (sheet) => {
          sheet.onRename = (previous, next) => {
            delete createdSheets[previous];
            createdSheets[next] = sheet;
          };
          createdSheets[sheet.getName()] = sheet;
          return sheet;
        };
        const spreadsheet = {
          id,
          name,
          editors: [],
          sheets: createdSheets,
          getId: () => id,
          getName: () => name,
          getSheetByName: (sheetName) => createdSheets[sheetName] || null,
          getSheets: () => Object.values(createdSheets),
          insertSheet: (sheetName) => {
            const sheet = new FakeSheet(sheetName, [], (writtenSheetName) => {
              assert.equal(publicLockDepth, 1, `${writtenSheetName} changed outside the public lock`);
              writeCounts[writtenSheetName] = (writeCounts[writtenSheetName] || 0) + 1;
              if (failActivityCreationStage === "initialize" &&
                  writeCounts[writtenSheetName] === 1) {
                throw new Error("injected initialization failure");
              }
              if (failActivityCreationStage === "event" &&
                  writtenSheetName === "活动" && writeCounts[writtenSheetName] === 2) {
                throw new Error("injected event write failure");
              }
              onWrite?.(writtenSheetName);
            });
            sheet.rows = [];
            return registerCreatedSheet(sheet);
          },
          addEditor: (email) => {
            spreadsheet.editors.push(email);
            return spreadsheet;
          }
        };
        registerCreatedSheet(new FakeSheet("Sheet1", [], (writtenSheetName) => {
          assert.equal(publicLockDepth, 1, `${writtenSheetName} changed outside the public lock`);
          writeCounts[writtenSheetName] = (writeCounts[writtenSheetName] || 0) + 1;
          if (failActivityCreationStage === "initialize" &&
              writeCounts[writtenSheetName] === 1) {
            throw new Error("injected initialization failure");
          }
          if (failActivityCreationStage === "event" &&
              writtenSheetName === "活动" && writeCounts[writtenSheetName] === 2) {
            throw new Error("injected event write failure");
          }
          onWrite?.(writtenSheetName);
        }));
        createdById[id] = spreadsheet;
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
          assert.equal(publicLockDepth, 0, "public mutation lock was re-entered");
          publicLockDepth = 1;
          lockEvents.push("acquire");
        },
        releaseLock: () => {
          publicLockDepth = 0;
          lockEvents.push("release");
          const next = waiting.shift();
          if (next) next();
        }
      })
    },
    Utilities: utilityService(),
    ContentService: {
      MimeType: { JSON: "application/json" },
      createTextOutput: (content) => ({
        content,
        setMimeType() { return this; }
      })
    },
    HtmlService: {
      createHtmlOutput: (content) => ({ content })
    }
  });
  for (const file of [
    "Repository.gs",
    "RegistrationService.gs",
    "TicketService.gs",
    "AttendanceService.gs",
    "InternalGateway.gs",
    "InternalMutationService.gs",
    "SwitchProbeService.gs",
    "Code.gs"
  ]) {
    vm.runInContext(await readFile(new URL(file, publicRoot), "utf8"), publicContext, {
      filename: file
    });
  }

  let staffLockAccesses = 0;
  let staffSheetAccesses = 0;
  const staffProperties = {
    INTERNAL_API_SHARED_SECRET: sharedSecret,
    PUBLIC_BACKEND_URL: "https://script.google.com/macros/s/public/exec",
    ATTENDANCE_STAFF_ALLOWLIST: JSON.stringify(["admin@example.com"]),
    ADMIN_EMAIL_ALLOWLIST: JSON.stringify(["admin@example.com"])
  };
  const staffContext = vm.createContext({
    console,
    JSON, Object, Array, String, Number, RegExp, Error, Math, isFinite,
    Date: ServerDate,
    Session: {
      getActiveUser: () => ({ getEmail: () => "admin@example.com" })
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => staffProperties[key] ?? null
      })
    },
    Utilities: utilityService(),
    UrlFetchApp: {
      fetch: (_url, options) => {
        const response = publicContext.doPost({
          postData: { contents: options.payload }
        });
        return {
          getResponseCode: () => 200,
          getContentText: () => response.content
        };
      }
    },
    LockService: {
      getScriptLock: () => {
        staffLockAccesses += 1;
        throw new Error("staff project lock must not guard shared state");
      }
    },
    SpreadsheetApp: {
      openById: () => {
        staffSheetAccesses += 1;
        throw new Error("staff project must not mutate the shared Sheet");
      }
    }
  });
  for (const file of ["InternalClient.gs", "AttendanceService.gs", "AdminService.gs"]) {
    vm.runInContext(await readFile(new URL(file, staffRoot), "utf8"), staffContext, {
      filename: file
    });
  }
  return {
    publicContext,
    staffContext,
    sheets,
    registrySheets,
    extraSpreadsheets,
    createdSpreadsheets,
    trashedFiles,
    lockEvents,
    waiting,
    setArrivalHook: (hook) => { arrivalHook = hook; arrivalTriggered = false; },
    get staffLockAccesses() { return staffLockAccesses; },
    get staffSheetAccesses() { return staffSheetAccesses; },
    setNow: (value) => { now = value; }
  };
}

class UiElement {
  constructor(tagName = "div") {
    this.tagName = tagName;
    this.attributes = new Map();
    this.children = [];
    this.dataset = {};
    this.elements = {};
    this.hidden = false;
    this.listeners = new Map();
    this.style = {};
    this.textContent = "";
    this.value = "";
    this.checked = false;
    this.disabled = false;
  }
  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }
  dispatch(type) {
    const event = { currentTarget: this, preventDefault() {} };
    for (const handler of this.listeners.get(type) || []) handler(event);
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  focus() {}
  scrollIntoView() {}
  reset() {
    for (const field of Object.values(this.elements)) {
      field.value = "";
      field.checked = false;
    }
  }
  querySelector(selector) {
    if (selector === "input[name=title]") return this.elements.title;
    if (selector === "input:not([type=hidden]), select, textarea") {
      return this.elements.title || this.elements.status;
    }
    return null;
  }
}

class UiFormData {
  constructor(form) {
    this.values = Object.entries(form.elements).map(([name, field]) => [name, field.value]);
  }
  entries() { return this.values[Symbol.iterator](); }
}

function uiField(value = "") {
  const node = new UiElement("input");
  node.value = value;
  return node;
}

function uiForm(names) {
  const node = new UiElement("form");
  for (const name of names) node.elements[name] = uiField();
  return node;
}

async function runAdminUiThroughRealService(system) {
  const elements = new Map();
  const add = (selector, node = new UiElement()) => (elements.set(selector, node), node);
  const eventForm = add("#event-form", uiForm([
    "eventId", "title", "description", "status", "opensAt", "closesAt", "location",
    "selectionMode", "minChoices", "maxChoices", "seatMode", "seatMapLabel", "seatZones",
    "showOpeningCountdown", "showClosingCountdown", "cancellationEnabled",
    "seatExchangeEnabled", "seatHoldsEnabled", "seatHoldMinutes",
    "registrationTimeLimitMinutes", "totalCapacity", "checkInMode"
  ]));
  const seatForm = add("#seat-form", uiForm([
    "eventId", "sessionId", "mode", "zoneName", "rows", "seatsPerRow"
  ]));
  const sessionForm = add("#session-form", uiForm([
    "eventId", "sessionId", "title", "speaker", "startsAt", "endsAt", "location",
    "capacity", "required", "groupRule", "status"
  ]));
  const questionForm = add("#question-form", uiForm([
    "eventId", "questionId", "label", "type", "options", "validation", "sortOrder",
    "status", "required", "showOnTicket", "duplicateIdentity", "semanticRole"
  ]));
  add("#record-search-form", uiForm(["search"]));
  const recordAction = add("#record-action-form", uiForm(["registrationId", "seatId"]));
  add("#sheet-form", uiForm(["spreadsheetId"]));
  for (const selector of [
    "#admin-status", "#connection-status", "#event-list", "#session-list", "#seat-list",
    "#question-list", "#record-list", "#attendance-list", "#selected-activity",
    "#selected-activity-title", "#selected-activity-meta", "#selected-activity-sheet",
    "#finalize-draft", "#delete-draft", "#delete-empty-event",
    "#min-session-field", "#max-session-field", "#seat-zone-field",
    "#activity-empty-state", "#clear-search", "#test-sheet", "#switch-sheet", "#new-activity",
    "#save-event", "#save-session", "#save-seat-plan", "#save-question",
    "#new-session", "#session-editor-mode"
  ]) add(selector);
  const selector = add("#activity-selector", new UiElement("select"));
  const sections = ["#sessions", "#seats", "#questions", "#records", "#attendance"]
    .map((id) => add(id));
  const navLinks = ["#events", "#sessions", "#seats", "#questions", "#records", "#attendance"]
    .map((href) => {
      const link = new UiElement("a");
      link.setAttribute("href", href);
      return link;
    });
  const lifecycle = ["close", "reopen", "archive"].map((action) => {
    const button = new UiElement("button");
    button.dataset.action = action;
    return button;
  });
  const recordActions = ["cancel_registration", "adjust_seat"].map((action) => {
    const button = new UiElement("button");
    button.dataset.action = action;
    return button;
  });
  const document = {
    createElement: (tag) => new UiElement(tag),
    querySelector: (query) => elements.get(query) || null,
    querySelectorAll: (query) => {
      if (query === ".selected-required") return sections;
      if (query === ".generated-required") return sections.slice(-2);
      if (query === 'nav a[href^="#"]') return navLinks;
      if (query === "#event-form [data-action]") return lifecycle;
      if (query === "#record-action-form [data-action]") return recordActions;
      if (query === "[data-copy-bundle]") return [];
      return [];
    }
  };
  const forwarded = [];
  class Runner {
    withSuccessHandler(handler) { this.success = handler; return this; }
    withFailureHandler(handler) { this.failure = handler; return this; }
    invoke(method, payload) {
      const result = system.staffContext[method](payload);
      forwarded.push({ method, payload, result });
      this.success(result);
    }
    getAdminDashboard(payload) { this.invoke("getAdminDashboard", payload); }
    saveAdminDraft(payload) { this.invoke("saveAdminDraft", payload); }
    finalizeAdminDraft(payload) { this.invoke("finalizeAdminDraft", payload); }
    deleteAdminDraft(payload) { this.invoke("deleteAdminDraft", payload); }
    deleteEmptyAdminEvent(payload) { this.invoke("deleteEmptyAdminEvent", payload); }
    saveAdminEvent(payload) { this.invoke("saveAdminEvent", payload); }
    saveAdminSeatPlan(payload) { this.invoke("saveAdminSeatPlan", payload); }
    adminRecordAction(payload) { this.invoke("adminRecordAction", payload); }
  }
  const context = vm.createContext({
    document,
    FormData: UiFormData,
    URL,
    console,
    google: { script: { get run() { return new Runner(); } } },
    navigator: { clipboard: { writeText: () => Promise.resolve() } },
    window: { confirm: () => true, matchMedia: () => ({ matches: false }) }
  });
  const source = (await readFile(adminScriptUrl, "utf8"))
    .replace(/^<script>\s*|\s*<\/script>\s*$/g, "");
  vm.runInContext(source, context);
  return {
    elements, eventForm, seatForm, sessionForm, questionForm, recordAction,
    selector, recordActions, forwarded
  };
}

test("assembled automatic activity creation prepares private Sheets before catalog publication", async () => {
  const system = await createSystem();
  const first = system.staffContext.saveAdminEvent({
    title: `Production\u0001 Talk ${"z".repeat(160)}`,
    status: "draft"
  });
  const second = system.staffContext.saveAdminEvent({
    title: "Production Talk B",
    status: "draft"
  });

  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.equal(system.createdSpreadsheets.length, 2);
  assert.notEqual(
    system.createdSpreadsheets[0].getId(),
    system.createdSpreadsheets[1].getId()
  );
  assert.equal(system.createdSpreadsheets[0].editors.includes("admin@example.com"), true);
  assert.equal(system.createdSpreadsheets[0].getName().length <= 100, true);
  assert.doesNotMatch(system.createdSpreadsheets[0].getName(), /[\u0000-\u001f\u007f-\u009f]/);
  for (const spreadsheet of system.createdSpreadsheets) {
    assert.deepEqual(
      Object.keys(spreadsheet.sheets).sort(),
      ["活动", "场次", "座位", "报名问题", "参加者", "报名项目", "签到记录", "操作记录"].sort()
    );
  }

  const catalog = rows(system.registrySheets["活动目录"]);
  assert.equal(catalog.length, 3);
  assert.notEqual(catalog[1].spreadsheetId, catalog[2].spreadsheetId);
  assert.equal(JSON.stringify(first.data).includes("spreadsheetId"), false);
  assert.equal(
    first.data.sheetUrl,
    `https://docs.google.com/spreadsheets/d/${encodeURIComponent(catalog[1].spreadsheetId)}/edit`
  );
});

test("assembled administrator entry points accept the payloads emitted by the activity selector", async () => {
  const system = await createSystem();
  const initialDashboardPayload = { search: "" };
  const createPayload = { title: "Selector-created activity", status: "draft" };

  assert.equal(Object.hasOwn(initialDashboardPayload, "eventId"), false);
  assert.equal(Object.hasOwn(createPayload, "eventId"), false);
  assert.equal(
    system.staffContext.getAdminDashboard(initialDashboardPayload).ok,
    true
  );
  assert.equal(system.staffContext.saveAdminEvent(createPayload).ok, true);

  const generated = system.staffContext.saveAdminSeatPlan({
    eventId: "event-1",
    action: "generate",
    mode: "self",
    zones: [{ name: "A", rows: 1, seatsPerRow: 1 }]
  });
  assert.equal(generated.ok, true, JSON.stringify(generated));
  const seatId = rows(system.sheets["座位"])[0].seatId;
  for (const [action, status] of [["reserve", "reserved"], ["close", "closed"], ["reopen", "available"]]) {
    const result = system.staffContext.saveAdminSeatPlan({ eventId: "event-1", action, seatId });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(rows(system.sheets["座位"])[0].status, status);
  }

  const adjusted = system.staffContext.adminRecordAction({
    eventId: "event-1",
    action: "adjust_seat",
    registrationId: "registration-1",
    seatId,
    confirm: true
  });
  assert.equal(adjusted.ok, true, JSON.stringify(adjusted));
  const cancelled = system.staffContext.adminRecordAction({
    eventId: "event-1",
    action: "cancel_registration",
    registrationId: "registration-1",
    seatId,
    confirm: true
  });
  assert.equal(cancelled.ok, true, JSON.stringify(cancelled));
  assert.equal(rows(system.sheets["报名项目"])[0].status, "cancelled");
});

test("the real administrator UI forwards emitted payload objects through real administrator validation", async () => {
  const system = await createSystem();
  const ui = await runAdminUiThroughRealService(system);

  const initialDashboard = ui.forwarded.find((call) => call.method === "getAdminDashboard");
  assert.ok(initialDashboard);
  assert.equal(Object.hasOwn(initialDashboard.payload, "eventId"), false);
  assert.equal(initialDashboard.result.ok, true, JSON.stringify(initialDashboard.result));

  ui.elements.get("#new-activity").dispatch("click");
  Object.assign(ui.eventForm.elements.title, { value: "UI-created activity" });
  Object.assign(ui.eventForm.elements.status, { value: "draft" });
  Object.assign(ui.eventForm.elements.selectionMode, { value: "none" });
  Object.assign(ui.eventForm.elements.minChoices, { value: "0" });
  Object.assign(ui.eventForm.elements.maxChoices, { value: "0" });
  Object.assign(ui.eventForm.elements.seatMode, { value: "none" });
  Object.assign(ui.eventForm.elements.seatHoldMinutes, { value: "5" });
  Object.assign(ui.eventForm.elements.registrationTimeLimitMinutes, { value: "5" });
  Object.assign(ui.eventForm.elements.totalCapacity, { value: "0" });
  Object.assign(ui.eventForm.elements.checkInMode, { value: "session" });
  ui.eventForm.dispatch("submit");
  const savedDraft = ui.forwarded.find((call) => call.method === "saveAdminDraft");
  assert.ok(savedDraft);
  assert.equal(Object.hasOwn(savedDraft.payload, "eventId"), false);
  assert.equal(savedDraft.result.ok, true, JSON.stringify(savedDraft.result));
  assert.equal(system.createdSpreadsheets.length, 0);
  assert.equal(rows(system.registrySheets["活动草稿"]).length, 1);

  ui.selector.value = "event-1";
  ui.selector.dispatch("change");
  ui.seatForm.elements.mode.value = "self";
  ui.seatForm.elements.zoneName.value = "A";
  ui.seatForm.elements.rows.value = "1";
  ui.seatForm.elements.seatsPerRow.value = "1";
  ui.seatForm.dispatch("submit");
  const seatId = rows(system.sheets["座位"])[0].seatId;
  const seatButtons = ui.elements.get("#seat-list").children[0].children.at(-1).children;
  seatButtons.forEach((button) => button.dispatch("click"));

  ui.recordAction.elements.registrationId.value = "registration-1";
  ui.recordAction.elements.seatId.value = seatId;
  ui.recordActions[1].dispatch("click");
  ui.recordActions[0].dispatch("click");

  const seatActions = ui.forwarded.filter((call) =>
    call.method === "saveAdminSeatPlan" && ["reserve", "close", "reopen"].includes(call.payload.action));
  const recordActions = ui.forwarded.filter((call) => call.method === "adminRecordAction");
  assert.deepEqual(
    seatActions.map((call) => call.payload.action),
    ["reserve", "close", "reopen"]
  );
  assert.deepEqual(
    recordActions.map((call) => call.payload.action),
    ["adjust_seat", "cancel_registration"]
  );
  for (const call of seatActions.concat(recordActions)) {
    assert.equal(call.payload.eventId, "event-1");
    assert.equal(call.result.ok, true, `${call.method}: ${JSON.stringify(call.result)}`);
  }
  assert.equal(rows(system.sheets["报名项目"])[0].status, "cancelled");
  assert.equal(rows(system.registrySheets["票券索引"])[0].status, "cancelled");
});

test("assembled administrator cancellation keeps the ticket index and public ticket views transactional", async (t) => {
  const cancellationPayload = {
    eventId: "event-1",
    action: "cancel_registration",
    registrationId: "registration-1",
    confirm: true
  };
  const mutationSnapshot = (system) => JSON.stringify({
    routes: rows(system.registrySheets["票券索引"]),
    registrations: rows(system.sheets["报名项目"]),
    seats: rows(system.sheets["座位"]),
    audits: rows(system.sheets["操作记录"])
  });

  await t.test("success makes lookup and verification observe one cancelled route", async () => {
    const system = await createSystem();
    const result = system.staffContext.adminRecordAction(cancellationPayload);

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(rows(system.registrySheets["票券索引"])[0].status, "cancelled");
    const lookup = system.publicContext.lookupTicket({
      ticketNumber: "EVT-ONE",
      verificationValue: "alice@example.com"
    });
    const verified = system.publicContext.verifyTicket({ token: "physical-camera-token" });
    assert.equal(lookup.ok, true, JSON.stringify(lookup));
    assert.equal(lookup.data.status, "cancelled");
    assert.equal(verified.ok, true, JSON.stringify(verified));
    assert.equal(verified.data.status, "cancelled");
  });

  await t.test("a mismatched active route changes nothing", async () => {
    const system = await createSystem();
    const route = system.registrySheets["票券索引"].rows[1];
    route[headers["票券索引"].indexOf("registrationId")] = "other-registration";
    const before = mutationSnapshot(system);

    const result = system.staffContext.adminRecordAction(cancellationPayload);

    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(result.code, "CONFLICT");
    assert.equal(mutationSnapshot(system), before);
  });

  await t.test("a route write failure restores every mutation", async () => {
    const system = await createSystem();
    const before = mutationSnapshot(system);
    system.registrySheets["票券索引"].afterNextWrite(() => {
      throw new Error("injected route write failure");
    });

    const result = system.staffContext.adminRecordAction(cancellationPayload);

    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(mutationSnapshot(system), before);
  });

  await t.test("a downstream audit failure restores a route that was already cancelled", async () => {
    const system = await createSystem();
    const before = mutationSnapshot(system);
    let routeWasCancelledBeforeAuditFailure = false;
    system.sheets["操作记录"].afterNextWrite(() => {
      routeWasCancelledBeforeAuditFailure =
        rows(system.registrySheets["票券索引"])[0].status === "cancelled";
      throw new Error("injected cancellation audit failure");
    });

    const result = system.staffContext.adminRecordAction(cancellationPayload);

    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(routeWasCancelledBeforeAuditFailure, true);
    assert.equal(mutationSnapshot(system), before);
  });
});

test("assembled advanced switching rejects an unmapped legacy candidate before activation", async () => {
  const legacyCandidate = fixture();
  legacyCandidate["活动草稿"] = [];
  legacyCandidate["活动目录"] = [];
  legacyCandidate["票券索引"] = [];
  const system = await createSystem({
    extraSheetData: { "legacy-candidate": legacyCandidate }
  });
  const beforeRegistry = JSON.stringify(rows(system.registrySheets["系统设置"]));
  const beforeAudit = JSON.stringify(rows(system.extraSpreadsheets["legacy-candidate"].sheets["操作记录"]));

  const result = system.staffContext.switchAdminSheet({
    spreadsheetId: "legacy-candidate",
    confirm: true
  });

  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.code, "LEGACY_MIGRATION_REQUIRED");
  assert.equal(JSON.stringify(rows(system.registrySheets["系统设置"])), beforeRegistry);
  assert.equal(
    JSON.stringify(rows(system.extraSpreadsheets["legacy-candidate"].sheets["操作记录"])),
    beforeAudit
  );
});

test("assembled creation failures leave the existing catalog unchanged", async (t) => {
  for (const stage of ["create", "initialize", "event", "catalog", "catalog-post-write"]) {
    await t.test(stage, async () => {
      const system = await createSystem({ failActivityCreationStage: stage });
      const before = JSON.stringify(rows(system.registrySheets["活动目录"]));
      if (stage === "catalog-post-write") {
        system.registrySheets["活动目录"].afterNextWrite(() => {
          throw new Error("injected catalog post-write failure");
        });
      }

      const result = system.staffContext.saveAdminEvent({
        title: `Failed ${stage}`,
        status: "draft"
      });

      assert.equal(result.ok, false, JSON.stringify(result));
      assert.deepEqual(
        system.trashedFiles,
        stage === "create" ? [] : ["created-activity-1"],
        `${stage} should clean up every newly created activity Sheet`
      );
      assert.equal(JSON.stringify(rows(system.registrySheets["活动目录"])), before);
    });
  }
});

test("existing event catalog post-write failure restores both catalog and activity state", async () => {
  const system = await createSystem();
  const beforeCatalog = JSON.stringify(rows(system.registrySheets["活动目录"]));
  const beforeEvent = JSON.stringify(rows(system.sheets["活动"]));
  const beforeSettings = JSON.stringify(rows(system.registrySheets["系统设置"]));
  const beforeAudit = JSON.stringify(rows(system.sheets["操作记录"]));
  system.registrySheets["活动目录"].afterNextWrite(() => {
    throw new Error("injected existing catalog post-write failure");
  });

  const result = system.staffContext.saveAdminEvent({
    eventId: "event-1",
    title: "Must roll back"
  });

  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(JSON.stringify(rows(system.registrySheets["活动目录"])), beforeCatalog);
  assert.equal(JSON.stringify(rows(system.sheets["活动"])), beforeEvent);
  assert.equal(JSON.stringify(rows(system.registrySheets["系统设置"])), beforeSettings);
  assert.equal(JSON.stringify(rows(system.sheets["操作记录"])), beforeAudit);
});

test("seat-plan changes publish catalog summaries and roll back after a post-write catalog failure", async (t) => {
  await t.test("success", async () => {
    const system = await createSystem();
    const result = system.staffContext.saveAdminSeatPlan({
      eventId: "event-1",
      action: "generate",
      mode: "zone",
      zones: [{ name: "Balcony", rows: 1, seatsPerRow: 1 }]
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    const event = rows(system.sheets["活动"])[0];
    const catalog = rows(system.registrySheets["活动目录"])[0];
    assert.equal(event.seatMode, "zone");
    assert.equal(catalog.seatMode, "zone");
    assert.deepEqual(JSON.parse(catalog.seatZones), ["Balcony"]);
  });

  await t.test("post-write failure", async () => {
    const system = await createSystem();
    const beforeCatalog = JSON.stringify(rows(system.registrySheets["活动目录"]));
    const beforeEvent = JSON.stringify(rows(system.sheets["活动"]));
    const beforeSeats = JSON.stringify(rows(system.sheets["座位"]));
    const beforeAudit = JSON.stringify(rows(system.sheets["操作记录"]));
    system.registrySheets["活动目录"].afterNextWrite(() => {
      throw new Error("injected seat-plan catalog post-write failure");
    });

    const result = system.staffContext.saveAdminSeatPlan({
      eventId: "event-1",
      action: "generate",
      mode: "zone",
      zones: [{ name: "Balcony", rows: 1, seatsPerRow: 1 }]
    });

    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(JSON.stringify(rows(system.registrySheets["活动目录"])), beforeCatalog);
    assert.equal(JSON.stringify(rows(system.sheets["活动"])), beforeEvent);
    assert.equal(JSON.stringify(rows(system.sheets["座位"])), beforeSeats);
    assert.equal(JSON.stringify(rows(system.sheets["操作记录"])), beforeAudit);
  });
});

test("assembled staff check-in and administrator writes share the public backend lock", async () => {
  const system = await createSystem();

  const ownerTicket = system.publicContext.lookupTicket({
    ticketNumber: "EVT-ONE",
    verificationValue: "alice@example.com"
  });
  assert.equal(ownerTicket.ok, true, JSON.stringify(ownerTicket));
  assert.equal(
    ownerTicket.data.verifyUrl,
    "https://events.example.org/summer/verify.html?token=physical-camera-token"
  );

  const lookup = system.staffContext.getStaffTicketForCheckIn({
    token: "physical-camera-token"
  });
  assert.equal(lookup.ok, true, JSON.stringify(lookup));

  const checkedIn = system.staffContext.checkIn({
    token: "physical-camera-token",
    sessionId: "session-1"
  });
  assert.equal(checkedIn.ok, true, JSON.stringify(checkedIn));
  assert.equal(rows(system.sheets["签到记录"]).length, 1);

  const closed = system.staffContext.saveAdminEvent({
    eventId: "event-1",
    title: "Live Forum",
    status: "closed"
  });
  assert.equal(closed.ok, true, JSON.stringify(closed));
  assert.equal(rows(system.sheets["活动"])[0].status, "closed");
  assert.equal(system.staffLockAccesses, 0);
  assert.equal(system.staffSheetAccesses, 0);
  assert.ok(system.lockEvents.length >= 6);
  assert.deepEqual(
    system.lockEvents.filter((event) => event === "acquire").length,
    system.lockEvents.filter((event) => event === "release").length
  );
});

test("a staff request arriving during an admin write waits for the public lock and observes the committed event state", async () => {
  const system = await createSystem();
  let queuedResult = null;
  system.setArrivalHook((waiting) => {
    waiting.push(() => {
      queuedResult = system.staffContext.checkIn({
        token: "physical-camera-token",
        sessionId: "session-1"
      });
    });
  });

  const closed = system.staffContext.saveAdminEvent({
    eventId: "event-1",
    title: "Live Forum",
    status: "closed"
  });

  assert.equal(closed.ok, true, JSON.stringify(closed));
  assert.equal(queuedResult?.ok, false, JSON.stringify(queuedResult));
  assert.equal(queuedResult?.code, "CHECK_IN_CLOSED");
  assert.equal(rows(system.sheets["签到记录"]).length, 0);
  assert.deepEqual(system.lockEvents.slice(0, 4), [
    "acquire", "release", "acquire", "release"
  ]);
});

test("assembled administrator mutations roll back rows, settings, appends, and audits after injected failures", async () => {
  let failSettingsOnce = true;
  const eventSystem = await createSystem({
    onWrite: (sheetName) => {
      if (failSettingsOnce && headers[sheetName].includes("key")) {
        failSettingsOnce = false;
        throw new Error("injected settings failure");
      }
    }
  });
  const eventSheet = Object.values(eventSystem.sheets)
    .find((sheet) => headers[sheet.name].includes("eventId") && headers[sheet.name].includes("title"));
  const settingsSheet = Object.values(eventSystem.registrySheets)
    .find((sheet) => headers[sheet.name].includes("key"));
  const auditSheet = Object.values(eventSystem.sheets)
    .find((sheet) => headers[sheet.name].includes("auditId"));
  const beforeEvent = JSON.stringify(rows(eventSheet));
  const beforeSettings = JSON.stringify(rows(settingsSheet));
  const failedEvent = eventSystem.staffContext.saveAdminEvent({
    eventId: "event-1",
    title: "Must roll back",
    seatHoldsEnabled: true,
    seatHoldMinutes: 3
  });
  assert.equal(failedEvent.ok, false);
  assert.equal(failedEvent.code, "INTERNAL");
  assert.equal(JSON.stringify(rows(eventSheet)), beforeEvent);
  assert.equal(JSON.stringify(rows(settingsSheet)), beforeSettings);
  assert.equal(rows(auditSheet).length, 0);

  let failEventWriteOnce = true;
  const seatSystem = await createSystem({
    onWrite: (sheetName) => {
      if (failEventWriteOnce && headers[sheetName].includes("eventId") &&
          headers[sheetName].includes("title")) {
        failEventWriteOnce = false;
        throw new Error("injected event failure");
      }
    }
  });
  const seatSheet = Object.values(seatSystem.sheets)
    .find((sheet) => headers[sheet.name].includes("seatId"));
  const seatAuditSheet = Object.values(seatSystem.sheets)
    .find((sheet) => headers[sheet.name].includes("auditId"));
  const failedPlan = seatSystem.staffContext.saveAdminSeatPlan({
    action: "generate",
    eventId: "event-1",
    mode: "self",
    zones: [{ name: "A", rows: 1, seatsPerRow: 2 }]
  });
  assert.equal(failedPlan.ok, false);
  assert.equal(failedPlan.code, "INTERNAL");
  assert.equal(rows(seatSheet).length, 0);
  assert.equal(rows(seatAuditSheet).length, 0);
});
