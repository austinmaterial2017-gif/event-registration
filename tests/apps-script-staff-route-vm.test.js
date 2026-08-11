import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readdir, readFile } from "node:fs/promises";

const staffScriptRoot = new URL("../staff-apps-script/", import.meta.url);
const ADMIN_RPC_NAMES = [
  "adminRecordAction",
  "deleteAdminDraft",
  "deleteAdminSession",
  "deleteEmptyAdminEvent",
  "finalizeAdminDraft",
  "getAdminDashboard",
  "getAdminSourceBundles",
  "refreshAdminReadableViews",
  "saveAdminDraft",
  "saveAdminEvent",
  "saveAdminQuestion",
  "saveAdminSeatPlan",
  "saveAdminSession",
  "switchAdminSheet",
  "testAdminSheetConnection"
];

async function declaredStaffServerFunctions() {
  const fileNames = (await readdir(staffScriptRoot))
    .filter((name) => name.endsWith(".gs"))
    .sort();
  const declarations = [];
  for (const fileName of fileNames) {
    const script = await readFile(new URL(fileName, staffScriptRoot), "utf8");
    for (const match of script.matchAll(/^function\s+([A-Za-z_$][\w$]*)\s*\(/gm)) {
      declarations.push({ fileName, name: match[1] });
    }
  }
  return declarations;
}

async function createHarness({
  sessionEmail = "",
  staffAllowlist = ["staff@example.com"],
  adminAllowlist = ["admin@example.com"]
} = {}) {
  let templateLoads = 0;
  let propertyReads = 0;
  const staffWebAppUrl = "https://script.google.com/macros/s/staff-deployment/exec";
  const htmlOutput = (kind, content) => ({
    kind,
    content,
    title: "",
    setTitle(title) { this.title = title; return this; }
  });
  const context = vm.createContext({
    JSON, Object, Array, String, Number, Error,
    Session: {
      getActiveUser: () => ({ getEmail: () => sessionEmail })
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => {
          propertyReads += 1;
          if (key === "ATTENDANCE_STAFF_ALLOWLIST") return JSON.stringify(staffAllowlist);
          if (key === "ADMIN_EMAIL_ALLOWLIST") return JSON.stringify(adminAllowlist);
          return null;
        }
      })
    },
    HtmlService: {
      createHtmlOutput: (content) => htmlOutput("text", content),
      createHtmlOutputFromFile: (name) => {
        templateLoads += 1;
        return htmlOutput("file", name);
      },
      createTemplateFromFile: (name) => {
        const template = {
          evaluate: () => {
            templateLoads += 1;
            const output = htmlOutput("file", name);
            output.templateValues = { ...template };
            delete output.templateValues.evaluate;
            return output;
          }
        };
        return template;
      }
    },
    ScriptApp: {
      getService: () => ({ getUrl: () => staffWebAppUrl })
    },
    Utilities: {
      getUuid: () => "uuid"
    },
    LockService: {
      getScriptLock: () => ({
        waitLock() {},
        releaseLock() {}
      })
    },
    SpreadsheetApp: {
      openById: () => {
        throw new Error("unexpected Sheet access");
      }
    }
  });
  for (const file of ["AttendanceService.gs", "AdminService.gs", "Code.gs"]) {
    vm.runInContext(await readFile(new URL(file, staffScriptRoot), "utf8"), context, { filename: file });
  }
  return {
    context,
    get templateLoads() { return templateLoads; },
    get propertyReads() { return propertyReads; }
  };
}

test("blank and unauthorized staff-project sessions receive the same generic page without loading the template", async () => {
  const blank = await createHarness();
  const unauthorized = await createHarness({ sessionEmail: "stranger@example.com" });
  const blankResult = blank.context.doGet({});
  const unauthorizedResult = unauthorized.context.doGet({});

  assert.equal(blankResult.kind, "text");
  assert.equal(blankResult.content, unauthorizedResult.content);
  assert.match(blankResult.content, /Staff access unavailable/);
  assert.doesNotMatch(blankResult.content, /allowlist|email|staff@example/i);
  assert.equal(blank.templateLoads + unauthorized.templateLoads, 0);
});

test("an allowlisted active Google session receives the StaffCheckIn template", async () => {
  const harness = await createHarness({ sessionEmail: " STAFF@example.com " });
  const result = harness.context.doGet({});

  assert.equal(result.kind, "file");
  assert.equal(result.content, "StaffCheckIn");
  assert.equal(result.title, "工作人员验票／参与者签到");
  assert.equal(harness.templateLoads, 1);
});

test("an allowlisted administrator can also open the staff check-in page", async () => {
  const harness = await createHarness({
    sessionEmail: "admin@example.com",
    staffAllowlist: [],
    adminAllowlist: ["admin@example.com"]
  });
  const result = harness.context.doGet({});

  assert.equal(result.kind, "file");
  assert.equal(result.content, "StaffCheckIn");
  assert.equal(harness.templateLoads, 1);
});

test("staff scanner return accepts a ticket verification URL and keeps only its opaque token", async () => {
  const harness = await createHarness({ sessionEmail: "staff@example.com" });
  const token = "a".repeat(64);
  const result = harness.context.doGet({
    parameter: { scan: `https://events.example.org/v.html?t=${token}` }
  });

  assert.equal(result.kind, "file");
  assert.equal(result.templateValues.initialScan, token);
  assert.equal(
    result.templateValues.staffReturnUrl,
    "https://script.google.com/macros/s/staff-deployment/exec?view=staff"
  );
});

test("staff membership does not grant the protected administrator view", async () => {
  const blank = await createHarness({ staffAllowlist: ["staff@example.com"], adminAllowlist: [] });
  const staffOnly = await createHarness({
    sessionEmail: "staff@example.com",
    staffAllowlist: ["staff@example.com"],
    adminAllowlist: []
  });

  const blankResult = blank.context.doGet({ parameter: { view: "admin" } });
  const staffResult = staffOnly.context.doGet({ parameter: { view: "admin" } });

  assert.equal(blankResult.kind, "text");
  assert.equal(blankResult.content, staffResult.content);
  assert.match(blankResult.content, /Administrator access unavailable/);
  assert.doesNotMatch(blankResult.content, /allowlist|email|staff@example/i);
  assert.equal(blank.templateLoads + staffOnly.templateLoads, 0);
});

test("an administrator session receives only the protected Admin template", async () => {
  const harness = await createHarness({
    sessionEmail: " ADMIN@example.com ",
    staffAllowlist: [],
    adminAllowlist: ["admin@example.com"]
  });

  const result = harness.context.doGet({ parameter: { view: "admin" } });

  assert.equal(result.kind, "file");
  assert.equal(result.content, "Admin");
  assert.equal(result.title, "活动管理后台");
  assert.equal(
    result.templateValues.staffScannerUrl,
    "https://austinmaterial2017-gif.github.io/event-registration/staff-checkin.html"
  );
  assert.equal(harness.templateLoads, 1);
});

test("staff project exposes only the approved Apps Script server entry points", async () => {
  const declarations = await declaredStaffServerFunctions();
  const remotelyCallable = declarations
    .filter(({ name }) => !name.endsWith("_"))
    .map(({ name }) => name)
    .sort();

  assert.deepEqual(remotelyCallable, [
    ...ADMIN_RPC_NAMES,
    "checkIn",
    "createStaffScannerPass",
    "doGet",
    "getStaffCheckInTargets",
    "getStaffTicketForCheckIn"
  ].sort());
});

test("both staff data entry points deny an unauthorized session before any Sheet access", async () => {
  let sheetAccesses = 0;
  let lockAccesses = 0;
  const context = vm.createContext({
    JSON, Object, Array, String, Number, Error, isFinite,
    Session: {
      getActiveUser: () => ({ getEmail: () => "stranger@example.com" })
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => key === "ATTENDANCE_STAFF_ALLOWLIST"
          ? JSON.stringify(["staff@example.com"])
          : "private-spreadsheet-id"
      })
    },
    SpreadsheetApp: {
      openById: () => {
        sheetAccesses += 1;
        throw new Error("unauthorized Sheet access");
      }
    },
    LockService: {
      getScriptLock: () => {
        lockAccesses += 1;
        throw new Error("unauthorized lock access");
      }
    }
  });
  for (const file of ["Repository.gs", "AttendanceService.gs"]) {
    vm.runInContext(await readFile(new URL(file, staffScriptRoot), "utf8"), context, { filename: file });
  }

  const lookup = context.getStaffTicketForCheckIn({ token: "opaque-token" });
  const checkIn = context.checkIn({ token: "opaque-token", sessionId: "session-1" });

  assert.equal(lookup.ok, false);
  assert.equal(lookup.code, "STAFF_ACTION_DENIED");
  assert.equal(checkIn.ok, false);
  assert.equal(checkIn.code, "STAFF_ACTION_DENIED");
  assert.equal(sheetAccesses, 0);
  assert.equal(lockAccesses, 0);
});

test("every administrator RPC denies an unauthorized session before any Sheet or lock access", async () => {
  let sheetAccesses = 0;
  let lockAccesses = 0;
  const context = vm.createContext({
    JSON, Object, Array, String, Number, RegExp, Error, Date, Math, isFinite,
    Session: {
      getActiveUser: () => ({ getEmail: () => "staff@example.com" })
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => {
          if (key === "ADMIN_EMAIL_ALLOWLIST") return JSON.stringify(["admin@example.com"]);
          if (key === "ATTENDANCE_STAFF_ALLOWLIST") return JSON.stringify(["staff@example.com"]);
          return "private-runtime-value";
        },
        setProperty: () => {
          throw new Error("unauthorized property write");
        }
      })
    },
    SpreadsheetApp: {
      openById: () => {
        sheetAccesses += 1;
        throw new Error("unauthorized Sheet access");
      }
    },
    LockService: {
      getScriptLock: () => {
        lockAccesses += 1;
        throw new Error("unauthorized lock access");
      }
    },
    Utilities: {
      getUuid: () => "uuid"
    }
  });
  for (const file of ["Repository.gs", "AdminService.gs"]) {
    vm.runInContext(await readFile(new URL(file, staffScriptRoot), "utf8"), context, { filename: file });
  }

  for (const name of ADMIN_RPC_NAMES) {
    const result = context[name]({});
    assert.equal(result.ok, false, name);
    assert.equal(result.code, "ADMIN_ACTION_DENIED", name);
  }
  assert.equal(sheetAccesses, 0);
  assert.equal(lockAccesses, 0);
});

test("authorized staff and administrator RPCs delegate state work to the signed public backend without a staff-project lock or Sheet write", async () => {
  const delegated = [];
  let lockAccesses = 0;
  let sheetAccesses = 0;
  const context = vm.createContext({
    JSON, Object, Array, String, Number, RegExp, Error, Date, Math, isFinite,
    Session: {
      getActiveUser: () => ({ getEmail: () => "admin@example.com" })
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => {
          if (key === "ADMIN_EMAIL_ALLOWLIST") return JSON.stringify(["admin@example.com"]);
          if (key === "ATTENDANCE_STAFF_ALLOWLIST") return JSON.stringify(["admin@example.com"]);
          return null;
        }
      })
    },
    invokeInternalBackend_: (action, payload, actor) => {
      delegated.push({ action, payload: JSON.parse(JSON.stringify(payload)), actor });
      return { ok: true, data: { delegated: action } };
    },
    LockService: {
      getScriptLock: () => {
        lockAccesses += 1;
        throw new Error("staff project must not serialize shared mutations");
      }
    },
    SpreadsheetApp: {
      openById: () => {
        sheetAccesses += 1;
        throw new Error("staff project must not write shared state");
      }
    }
  });
  for (const file of ["AttendanceService.gs", "AdminService.gs"]) {
    vm.runInContext(await readFile(new URL(file, staffScriptRoot), "utf8"), context, { filename: file });
  }

  assert.equal(context.getStaffTicketForCheckIn({ token: "ticket-token" }).ok, true);
  assert.equal(context.getStaffCheckInTargets().ok, true);
  assert.equal(context.checkIn({ token: "ticket-token", sessionId: "session-1" }).ok, true);
  assert.equal(context.getAdminDashboard({ search: "Alice" }).ok, true);
  assert.equal(context.saveAdminDraft({ event: { title: "Draft" } }).ok, true);
  assert.equal(context.finalizeAdminDraft({ draftId: "draft-1", confirm: true }).ok, true);
  assert.equal(context.deleteAdminDraft({ draftId: "draft-1", confirm: true }).ok, true);
  assert.equal(context.deleteEmptyAdminEvent({ eventId: "event-1", confirm: true }).ok, true);
  assert.equal(context.saveAdminEvent({ eventId: "event-1", status: "closed" }).ok, true);
  assert.equal(context.saveAdminSession({ eventId: "event-1", sessionId: "session-1" }).ok, true);
  assert.equal(context.saveAdminSeatPlan({ eventId: "event-1", action: "generate" }).ok, true);
  assert.equal(context.saveAdminQuestion({ eventId: "event-1", questionId: "email" }).ok, true);
  assert.equal(context.adminRecordAction({
    registrationId: "registration-1",
    action: "cancel_registration",
    confirm: true
  }).ok, true);
  assert.equal(context.testAdminSheetConnection({ spreadsheetId: "candidate" }).ok, true);
  assert.equal(context.switchAdminSheet({ spreadsheetId: "candidate", confirm: true }).ok, true);

  assert.deepEqual(
    delegated.map(({ action }) => action),
    [
      "staff.getTicket",
      "staff.getCheckInTargets",
      "staff.checkIn",
      "admin.getDashboard",
      "admin.saveDraft",
      "admin.finalizeDraft",
      "admin.deleteDraft",
      "admin.deleteEmptyEvent",
      "admin.saveEvent",
      "admin.saveSession",
      "admin.saveSeatPlan",
      "admin.saveQuestion",
      "admin.recordAction",
      "admin.testSheet",
      "admin.switchSheet"
    ]
  );
  assert.ok(delegated.every(({ actor }) => actor === "admin@example.com"));
  assert.equal(lockAccesses, 0);
  assert.equal(sheetAccesses, 0);
});

test("deployment guide requires separate public and staff Apps Script projects", async () => {
  const guide = await readFile(new URL("../apps-script/DEPLOYMENT.md", import.meta.url), "utf8");
  assert.match(guide, /two separate Apps Script projects/i);
  assert.match(guide, /apps-script\//i);
  assert.match(guide, /staff-apps-script\//i);
  assert.match(guide, /USER_DEPLOYING|execute as.*deployer/i);
  assert.match(guide, /anonymous/i);
  assert.match(guide, /USER_ACCESSING|execute as.*user accessing/i);
  assert.match(guide, /ANYONE.*not anonymous|sign-in required/i);
  assert.match(guide, /Sheet access/i);
  assert.match(guide, /staff accounts.*allowlist/i);
  assert.match(guide, /must not.*GitHub public config/i);
  assert.match(guide, /ADMIN_EMAIL_ALLOWLIST/);
  assert.match(guide, /\?view=admin/);
  assert.match(guide, /attendance.*allowlist.*does not.*admin|independent.*allowlist/i);
  assert.match(guide, /copy.*public.*source.*staff.*source|source bundles/i);
  assert.match(guide, /old data remains|旧数据.*保留/i);
  assert.match(guide, /migration is not automatic|不会自动迁移/i);
});

test("public and staff projects have distinct web-app manifests and security surfaces", async () => {
  const [publicManifestText, staffManifestText, publicCode, publicAttendance, staffCode, staffAttendance, staffRepository] = await Promise.all([
    readFile(new URL("../apps-script/appsscript.json", import.meta.url), "utf8"),
    readFile(new URL("../staff-apps-script/appsscript.json", import.meta.url), "utf8"),
    readFile(new URL("../apps-script/Code.gs", import.meta.url), "utf8"),
    readFile(new URL("../apps-script/AttendanceService.gs", import.meta.url), "utf8"),
    readFile(new URL("../staff-apps-script/Code.gs", import.meta.url), "utf8"),
    readFile(new URL("../staff-apps-script/AttendanceService.gs", import.meta.url), "utf8"),
    readFile(new URL("../staff-apps-script/Repository.gs", import.meta.url), "utf8")
  ]);
  const publicManifest = JSON.parse(publicManifestText);
  const staffManifest = JSON.parse(staffManifestText);

  assert.equal(publicManifest.webapp.executeAs, "USER_DEPLOYING");
  assert.equal(publicManifest.webapp.access, "ANYONE_ANONYMOUS");
  assert.equal(staffManifest.webapp.executeAs, "USER_ACCESSING");
  assert.equal(staffManifest.webapp.access, "ANYONE");
  assert.doesNotMatch(`${publicCode}\n${publicAttendance}`, /StaffCheckIn|function\s+checkIn|ATTENDANCE_STAFF_ALLOWLIST|Session\.getActiveUser/);
  await assert.rejects(
    readFile(new URL("../apps-script/StaffCheckIn.html", import.meta.url), "utf8"),
    { code: "ENOENT" }
  );
  assert.match(staffCode, /StaffCheckIn/);
  assert.match(staffAttendance, /function\s+checkIn/);
  assert.match(staffAttendance, /Session\.getActiveUser\(\)\.getEmail\(\)/);
  assert.doesNotMatch(staffAttendance, /payload\.staffIdentity/);
  assert.match(staffRepository, /ACTIVE_SPREADSHEET_ID/);
  assert.match(staffRepository, /PropertiesService\.getScriptProperties\(\)/);
  assert.match(staffRepository, /SpreadsheetApp\.openById\(/);
  assert.match(staffRepository, /LockService\.getScriptLock\(\)/);
  assert.doesNotMatch(staffRepository, /function\s+(?:setupSystem|initializeSpreadsheet_|setActiveSpreadsheet)\s*\(/);
  assert.doesNotMatch(staffRepository, /["'][A-Za-z0-9_-]{30,}["']/);
});
