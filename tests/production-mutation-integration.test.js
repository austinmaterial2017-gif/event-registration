import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { createHash, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";

const publicRoot = new URL("../apps-script/", import.meta.url);
const staffRoot = new URL("../staff-apps-script/", import.meta.url);
const sharedSecret = "production-integration-shared-secret-32";

const headers = {
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

class FakeSheet {
  constructor(name, records, onWrite) {
    this.name = name;
    this.onWrite = onWrite;
    this.rows = [
      headers[name].slice(),
      ...records.map((record) => headers[name].map((key) => record[key] ?? ""))
    ];
  }
  getName() { return this.name; }
  getLastRow() { return this.rows.length; }
  getLastColumn() { return headers[this.name].length; }
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
      }
    };
  }
  appendRow(values) {
    this.onWrite?.(this.name);
    this.rows.push(values.slice());
  }
  deleteRow(row) {
    this.onWrite?.(this.name);
    this.rows.splice(row - 1, 1);
  }
  deleteRows(row, count) {
    this.onWrite?.(this.name);
    this.rows.splice(row - 1, count);
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

async function createSystem({ onWrite } = {}) {
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
  const createSheets = (source) => Object.fromEntries(Object.entries(source).map(([name, records]) => [
    name,
    new FakeSheet(name, records, (sheetName) => {
      assert.equal(publicLockDepth, 1, `${sheetName} changed outside the public lock`);
      onWrite?.(sheetName);
      if (arrivalHook && !arrivalTriggered && sheetName === "活动") {
        arrivalTriggered = true;
        arrivalHook(waiting);
      }
    })
  ]));
  const sheets = createSheets(data);
  const registrySheets = createSheets(registryData);
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
  const publicContext = vm.createContext({
    console,
    JSON, Object, Array, String, Number, RegExp, Error, Math, isFinite,
    Date: ServerDate,
    PropertiesService: { getScriptProperties: () => publicPropertyStore },
    SpreadsheetApp: {
      openById: (id) => {
        if (id === "registry-sheet") return registrySpreadsheet;
        if (id === "activity-sheet") return activitySpreadsheet;
        throw new Error("missing spreadsheet");
      }
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
    lockEvents,
    waiting,
    setArrivalHook: (hook) => { arrivalHook = hook; arrivalTriggered = false; },
    get staffLockAccesses() { return staffLockAccesses; },
    get staffSheetAccesses() { return staffSheetAccesses; },
    setNow: (value) => { now = value; }
  };
}

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
