import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const staffScriptRoot = new URL("../staff-apps-script/", import.meta.url);

async function createHarness({ sessionEmail = "", allowlist = ["staff@example.com"] } = {}) {
  let templateLoads = 0;
  let propertyReads = 0;
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
          return key === "ATTENDANCE_STAFF_ALLOWLIST" ? JSON.stringify(allowlist) : null;
        }
      })
    },
    HtmlService: {
      createHtmlOutput: (content) => htmlOutput("text", content),
      createHtmlOutputFromFile: (name) => {
        templateLoads += 1;
        return htmlOutput("file", name);
      }
    }
  });
  for (const file of ["AttendanceService.gs", "Code.gs"]) {
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
  assert.equal(result.title, "员工讲座签到");
  assert.equal(harness.templateLoads, 1);
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
  assert.doesNotMatch(staffRepository, /setupSystem|initializeSpreadsheet_|setActiveSpreadsheet/);
  assert.doesNotMatch(staffRepository, /["'][A-Za-z0-9_-]{30,}["']/);
});
