import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const appsScriptRoot = new URL("../apps-script/", import.meta.url);

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
    vm.runInContext(await readFile(new URL(file, appsScriptRoot), "utf8"), context, { filename: file });
  }
  return {
    context,
    get templateLoads() { return templateLoads; },
    get propertyReads() { return propertyReads; }
  };
}

test("default doGet remains a public health page and does not inspect staff authentication", async () => {
  const harness = await createHarness();
  const result = harness.context.doGet({});
  assert.equal(result.kind, "text");
  assert.match(result.content, /Event registration service is running/);
  assert.equal(harness.propertyReads, 0);
  assert.equal(harness.templateLoads, 0);
});

test("blank and unauthorized staff sessions receive the same generic page without loading the template", async () => {
  const blank = await createHarness();
  const unauthorized = await createHarness({ sessionEmail: "stranger@example.com" });
  const blankResult = blank.context.doGet({ parameter: { view: "staff" } });
  const unauthorizedResult = unauthorized.context.doGet({ parameter: { view: "staff" } });

  assert.equal(blankResult.kind, "text");
  assert.equal(blankResult.content, unauthorizedResult.content);
  assert.match(blankResult.content, /Staff access unavailable/);
  assert.doesNotMatch(blankResult.content, /allowlist|email|staff@example/i);
  assert.equal(blank.templateLoads + unauthorized.templateLoads, 0);
});

test("an allowlisted active Google session receives the StaffCheckIn template", async () => {
  const harness = await createHarness({ sessionEmail: " STAFF@example.com " });
  const result = harness.context.doGet({ parameter: { view: "staff" } });

  assert.equal(result.kind, "file");
  assert.equal(result.content, "StaffCheckIn");
  assert.equal(result.title, "员工讲座签到");
  assert.equal(harness.templateLoads, 1);
});

test("deployment guide requires separate public and authenticated staff deployments from one version", async () => {
  const guide = await readFile(new URL("../apps-script/DEPLOYMENT.md", import.meta.url), "utf8");
  assert.match(guide, /same Apps Script version/i);
  assert.match(guide, /execute as.*deployer/i);
  assert.match(guide, /anonymous/i);
  assert.match(guide, /execute as.*user accessing/i);
  assert.match(guide, /Google accounts|domain/i);
  assert.match(guide, /\?view=staff/);
  assert.match(guide, /must not.*GitHub public config/i);
});
