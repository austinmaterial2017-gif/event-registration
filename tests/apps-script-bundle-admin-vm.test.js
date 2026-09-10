import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

async function loadBundleValidation() {
  const source = await readFile(new URL("../apps-script/Repository.gs", import.meta.url), "utf8");
  const context = vm.createContext({ Object, Array, String, Number, JSON, Date, Error });
  vm.runInContext(source, context);
  return context;
}

async function loadStaffScanner({ normalCheckIn, bundleCheckIn }) {
  const source = await readFile(new URL("../apps-script/StaffScannerService.gs", import.meta.url), "utf8");
  const scannerEntry = source.slice(
    source.indexOf("function staffScannerCheckIn(payload)"),
    source.indexOf("function createInternalStaffScannerPass_")
  );
  const context = vm.createContext({
    Object, Array, String, Number, JSON, Date, Error,
    withInternalActionScriptLock_: (callback) => callback(),
    readStaffScannerPass_: () => ({ actor: "staff@example.com", eventId: "event-1", sessionId: "session-1" }),
    internalStaffCheckInLocked_: normalCheckIn,
    staffBundleCheckIn_: bundleCheckIn,
    internalMutationFailure_: (code) => ({ ok: false, code })
  });
  vm.runInContext(scannerEntry, context);
  return context;
}

test("bundle plan accepts a configurable positive total ticket limit and keeps its schedule", async () => {
  const context = await loadBundleValidation();
  const plan = context.requireBundlePlanPayload_({
    title: "九月组合报名", totalTicketLimit: 6,
    opensAt: "2026-09-01T00:00:00.000Z", closesAt: "2026-09-30T00:00:00.000Z",
    status: "draft"
  });
  assert.equal(plan.totalTicketLimit, 6);
  assert.equal(plan.opensAt, "2026-09-01T00:00:00.000Z");
  assert.equal(plan.closesAt, "2026-09-30T00:00:00.000Z");
});

test("bundle rule rejects zero fixed tickets and invalid capacity", async () => {
  const context = await loadBundleValidation();
  assert.throws(() => context.requireBundleRulePayload_({
    planId: "plan-1", eventId: "event-1", fixedTicketCount: 0, capacity: 20
  }), /INVALID_REQUEST/);
  assert.throws(() => context.requireBundleRulePayload_({
    planId: "plan-1", eventId: "event-1", fixedTicketCount: 2, capacity: -1
  }), /INVALID_REQUEST/);
});

test("native bundle item does not accept or require an ordinary event id", async () => {
  const context = await loadBundleValidation();
  const item = context.requireBundleItemPayload_({
    planId: "plan-1", title: "亲子科学工作坊", fixedTicketCount: 2, capacity: 40,
    startsAt: "2026-09-20T02:00:00.000Z", endsAt: "2026-09-20T04:00:00.000Z",
    checkInMode: "single", checkInCount: 1, checkInLabels: [], status: "open"
  });
  assert.equal(item.title, "亲子科学工作坊");
  assert.equal(item.eventId, undefined);
  assert.throws(() => context.requireBundleItemPayload_({
    planId: "plan-1", title: "", fixedTicketCount: 1, capacity: 0,
    checkInMode: "single", checkInCount: 1, checkInLabels: [], status: "open"
  }), /INVALID_REQUEST/);
});

test("bundle activity availability respects its own opening time and fixed capacity", async () => {
  const source = await readFile(new URL("../apps-script/Code.gs", import.meta.url), "utf8");
  const context = vm.createContext({ Object, Array, String, Number, JSON, Date, Error, isFinite });
  vm.runInContext(source, context);
  const now = new Date("2026-09-09T12:00:00.000Z");
  assert.equal(context.bundleRulePublicAvailability_({
    status: "open", opensAt: "2026-09-10T00:00:00.000Z", closesAt: "", capacity: 8
  }, 2, now).status, "not_open");
  assert.equal(context.bundleRulePublicAvailability_({
    status: "open", opensAt: "", closesAt: "", capacity: 2
  }, 2, now).status, "full");
  assert.equal(context.bundleRulePublicAvailability_({
    status: "open", opensAt: "", closesAt: "", capacity: 2
  }, 1, now).status, "open");
});

test("combination registration starts with no fixed personal-information fields", async () => {
  const source = await readFile(new URL("../apps-script/Code.gs", import.meta.url), "utf8");
  const context = vm.createContext({ Object, Array, String, Number, JSON, Date, Error, isFinite });
  vm.runInContext(source, context);
  const fields = context.bundleRegistrationFields_();
  assert.equal(JSON.stringify(fields), JSON.stringify([]));
});

test("combination registration validates and saves the submitted photo files", async () => {
  const source = await readFile(new URL("../apps-script/Code.gs", import.meta.url), "utf8");
  assert.match(source, /validateRegistrationUploads_\(questions, payload\.uploads\)/);
  assert.match(source, /saveRegistrationUploads_\('bundle-' \+ planId, registrationId, normalizedUploads\)/);
});

test("combination registration batches entitlements and removes a partial registration on failure", async () => {
  const source = await readFile(new URL("../apps-script/Code.gs", import.meta.url), "utf8");
  assert.match(source, /var registrationRowNumber = 0/);
  assert.match(source, /entitlementSheet\.getRange\([\s\S]{0,200}rules\.length/);
  assert.match(source, /registrationSheet\.deleteRows\(registrationRowNumber, 1\)/);
});

test("saving a bundle plan writes only the dedicated bundle plan sheet and updates the same plan", async () => {
  const context = await loadBundleValidation();
  const rows = [context.BUNDLE_SHEET_HEADERS_["组合计划"].slice()];
  const sheet = {
    getLastRow: () => rows.length,
    getRange(row, column, rowCount, columnCount) {
      return {
        getValues: () => Array.from({ length: rowCount }, (_, y) =>
          Array.from({ length: columnCount }, (_, x) => rows[row - 1 + y]?.[column - 1 + x] ?? "")),
        setValues: (values) => values.forEach((source, y) => { rows[row - 1 + y] = source.slice(); })
      };
    }
  };
  const first = context.saveBundlePlanToSheet_(sheet, {
    planId: "plan-1", title: "九月组合", description: "", opensAt: "2026-09-01T00:00:00.000Z",
    closesAt: "2026-09-30T00:00:00.000Z", totalTicketLimit: 6, status: "draft"
  }, "2026-08-31T00:00:00.000Z");
  const second = context.saveBundlePlanToSheet_(sheet, { ...first, title: "十月组合" }, "2026-09-01T00:00:00.000Z");
  assert.equal(rows.length, 2);
  assert.equal(second.title, "十月组合");
  assert.equal(second.createdAt, "2026-08-31T00:00:00.000Z");
  assert.equal(second.updatedAt, "2026-09-01T00:00:00.000Z");
});

test("saving a bundle activity rule updates only the matching plan and event rule", async () => {
  const context = await loadBundleValidation();
  const rows = [context.BUNDLE_SHEET_HEADERS_["组合活动规则"].slice()];
  const sheet = {
    getLastRow: () => rows.length,
    getRange(row, column, rowCount, columnCount) {
      return {
        getValues: () => Array.from({ length: rowCount }, (_, y) => Array.from({ length: columnCount }, (_, x) => rows[row - 1 + y]?.[column - 1 + x] ?? "")),
        setValues: (values) => values.forEach((source, y) => { rows[row - 1 + y] = source.slice(); })
      };
    }
  };
  const first = context.saveBundleRuleToSheet_(sheet, {
    ruleId: "rule-1", planId: "plan-1", eventId: "event-1", fixedTicketCount: 2,
    capacity: 70, opensAt: "", closesAt: "", status: "open"
  });
  const second = context.saveBundleRuleToSheet_(sheet, { ...first, fixedTicketCount: 3, capacity: 60 });
  assert.equal(rows.length, 2);
  assert.equal(second.fixedTicketCount, 3);
  assert.equal(second.capacity, 60);
});

test("protected mutation registry exposes bundle plan actions only through admin routes", async () => {
  const source = await readFile(new URL("../apps-script/InternalMutationService.gs", import.meta.url), "utf8");
  const context = vm.createContext({
    Object, Array, String, Number, JSON, Date, Error,
    PUBLIC_BACKEND_URL: "", SWITCH_PROBE_SHARED_SECRET: "", SWITCH_PROBE: "", SWITCH_PROBE_ACK: "", SWITCH_MAINTENANCE: "",
    SHEET_DEFINITIONS: {}, SpreadsheetApp: {}, Utilities: { getUuid: () => "id" }
  });
  vm.runInContext(source, context);
  assert.equal(typeof context.saveBundlePlan_, "function");
  assert.equal(typeof context.saveBundleRule_, "function");
});

test("administrator backend exposes a read-only combination plan dashboard", async () => {
  const source = await readFile(new URL("../apps-script/InternalMutationService.gs", import.meta.url), "utf8");
  const context = vm.createContext({
    Object, Array, String, Number, JSON, Date, Error,
    PUBLIC_BACKEND_URL: "", SWITCH_PROBE_SHARED_SECRET: "", SWITCH_PROBE: "", SWITCH_PROBE_ACK: "", SWITCH_MAINTENANCE: "",
    SHEET_DEFINITIONS: {}, SpreadsheetApp: {}, Utilities: { getUuid: () => "id" }
  });
  vm.runInContext(source, context);
  assert.equal(typeof context.getBundleDashboard_, "function");
  assert.match(source, /'admin\.getBundleDashboard'/);
});

test("native combination item event times do not lock an already-open plan", async () => {
  const source = await readFile(new URL("../apps-script/Code.gs", import.meta.url), "utf8");
  assert.match(source, /bundleRulePublicAvailability_\(\{ status: item\.status, capacity: item\.capacity \}, used, now\)/);
  assert.match(source, /capacity: Number\(item\.capacity\), status: item\.status \};/);
  assert.doesNotMatch(source, /availability = bundleRulePublicAvailability_\(\{ status: item\.status, opensAt: item\.startsAt/);
});

test("adding the homepage flag keeps existing combination plan rows in their original columns", async () => {
  const context = await loadBundleValidation();
  const oldHeaders = ["planId", "title", "description", "opensAt", "closesAt", "totalTicketLimit", "status", "createdAt", "updatedAt"];
  const rows = [oldHeaders, ["plan-1", "旧计划", "", "2026-09-01T00:00:00.000Z", "2026-09-30T00:00:00.000Z", 6, "open", "old", "old"]];
  const sheet = {
    getName: () => "组合计划",
    getLastRow: () => rows.length,
    getRange(row, column, rowCount, columnCount) {
      return {
        getValues: () => Array.from({ length: rowCount }, (_, y) => Array.from({ length: columnCount }, (_, x) => rows[row - 1 + y]?.[column - 1 + x] ?? "")),
        setValues: (values) => values.forEach((source, y) => { rows[row - 1 + y] = source.slice(); })
      };
    },
    insertRowsBefore() { throw new Error("should not insert a duplicate header"); }
  };
  context.ensureHeaders_(sheet, context.BUNDLE_SHEET_HEADERS_["组合计划"]);
  assert.equal(rows[0][9], "showOnHome");
  assert.equal(rows[1][6], "open");
  assert.equal(rows[1][7], "old");
});

test("combination administrator editor creates native items instead of selecting an old activity", async () => {
  const html = await readFile(new URL("../staff-apps-script/Admin.html", import.meta.url), "utf8");
  const script = await readFile(new URL("../staff-apps-script/AdminScript.html", import.meta.url), "utf8");
  assert.match(html, /id="bundle-item-form"/);
  assert.match(html, /name="title" required placeholder="例如：亲子科学工作坊"/);
  assert.doesNotMatch(html, /bundle-event-selector/);
  assert.match(script, /saveBundleItem/);
});

test("combination plan dashboard includes its separate check-in count", async () => {
  const source = await readFile(new URL("../apps-script/InternalMutationService.gs", import.meta.url), "utf8");
  assert.match(source, /getSheetByName\('组合签到'\)/);
  assert.match(source, /attendanceCount:/);
  const adminScriptSource = await readFile(new URL("../staff-apps-script/AdminScript.html", import.meta.url), "utf8");
  assert.match(adminScriptSource, /已签到 \$\{plan\.attendanceCount/);
});

test("combination plan dashboard returns a safe participant registration link", async () => {
  const repositorySource = await readFile(new URL("../apps-script/Repository.gs", import.meta.url), "utf8");
  const internalSource = await readFile(new URL("../apps-script/InternalMutationService.gs", import.meta.url), "utf8");
  const adminScriptSource = await readFile(new URL("../staff-apps-script/AdminScript.html", import.meta.url), "utf8");
  assert.match(repositorySource, /function buildBundleRegistrationUrl_\(planId\)/);
  assert.match(internalSource, /registrationUrl:\s*buildBundleRegistrationUrl_\(plan\.planId\)/);
  assert.match(adminScriptSource, /复制报名链接/);
});

test("public route registry exposes a read-only combination plan action", async () => {
  const source = await readFile(new URL("../apps-script/Code.gs", import.meta.url), "utf8");
  const context = vm.createContext({ Object, Array, String, Number, JSON, Date, Error });
  vm.runInContext(source, context);
  assert.equal(typeof context.PUBLIC_ROUTES.getBundlePlan, "function");
});

test("public route registry exposes combination registration creation", async () => {
  const source = await readFile(new URL("../apps-script/Code.gs", import.meta.url), "utf8");
  const context = vm.createContext({ Object, Array, String, Number, JSON, Date, Error });
  vm.runInContext(source, context);
  assert.equal(typeof context.PUBLIC_ROUTES.createBundleRegistration, "function");
});

test("public route registry exposes read-only combination ticket verification", async () => {
  const source = await readFile(new URL("../apps-script/Code.gs", import.meta.url), "utf8");
  const context = vm.createContext({ Object, Array, String, Number, JSON, Date, Error });
  vm.runInContext(source, context);
  assert.equal(typeof context.PUBLIC_ROUTES.verifyBundleTicket, "function");
});

test("combination ticket page uses the public QR SVG renderer", async () => {
  const source = await readFile(new URL("../public/js/bundle-ticket-page.js", import.meta.url), "utf8");
  assert.match(source, /import\s*\{\s*renderQrSvg\s*\}\s*from\s*["']\.\/qr\.js["']/);
  assert.match(source, /renderQrSvg\(/);
  assert.doesNotMatch(source, /renderQr\s*\(/);
});

test("combination registration page disables activities that the server says are unavailable", async () => {
  const source = await readFile(new URL("../public/js/bundle-register-page.js", import.meta.url), "utf8");
  assert.match(source, /input\.disabled\s*=\s*rule\.available\s*===\s*false/);
});

test("combination registration serializes selected photo files before submitting", async () => {
  const source = await readFile(new URL("../public/js/bundle-register-page.js", import.meta.url), "utf8");
  assert.match(source, /serializePhotoFiles/);
  assert.match(source, /uploads:\s*await serializePhotoFiles/);
  assert.match(source, /Object\.fromEntries\(fields\.map/);
  assert.doesNotMatch(source, /form\.elements\.name|form\.elements\.phone|form\.elements\.photo/);
  assert.match(source, /服务器正在唤醒，请稍候/);
});

test("scanner checks a combination entitlement only when a normal ticket is unknown", async () => {
  const unknown = new Error("TOKEN_INVALID");
  unknown.publicCode = "TOKEN_INVALID";
  let bundleCalls = 0;
  const context = await loadStaffScanner({
    normalCheckIn: () => { throw unknown; },
    bundleCheckIn: (payload, actor, pass) => {
      bundleCalls += 1;
      assert.equal(payload.token, "bundle-token");
      assert.equal(actor, "staff@example.com");
      assert.equal(pass.eventId, "event-1");
      return { status: "checked_in", kind: "bundle" };
    }
  });
  const result = context.staffScannerCheckIn({ scannerPass: "pass", token: "bundle-token" });
  assert.equal(result.ok, true);
  assert.equal(result.data.status, "checked_in");
  assert.equal(result.data.kind, "bundle");
  assert.equal(bundleCalls, 1);
});

test("scanner keeps an ordinary ticket result without attempting a combination fallback", async () => {
  let bundleCalls = 0;
  const context = await loadStaffScanner({
    normalCheckIn: () => ({ status: "checked_in", kind: "ordinary" }),
    bundleCheckIn: () => { bundleCalls += 1; return {}; }
  });
  const result = context.staffScannerCheckIn({ scannerPass: "pass", token: "ordinary-token" });
  assert.equal(result.ok, true);
  assert.equal(result.data.status, "checked_in");
  assert.equal(result.data.kind, "ordinary");
  assert.equal(bundleCalls, 0);
});

test("combination attendance overview puts every configured project across one participant row", async () => {
  const source = await readFile(new URL("../apps-script/InternalMutationService.gs", import.meta.url), "utf8");
  const context = vm.createContext({
    Object, Array, String, Number, JSON, Date, Error,
    PUBLIC_BACKEND_URL: "", SWITCH_PROBE_SHARED_SECRET: "", SWITCH_PROBE: "", SWITCH_PROBE_ACK: "", SWITCH_MAINTENANCE: "",
    SHEET_DEFINITIONS: {}, SpreadsheetApp: {}, Utilities: { getUuid: () => "id" }
  });
  vm.runInContext(source, context);
  const view = context.buildBundlePlanAttendanceOverview_(
    [{ bundleRegistrationId: "registration-1", ticketNumber: "BND-001", answers: JSON.stringify({ name: "小明", phone: "0123456789" }), status: "active" }],
    [
      { entitlementId: "entitlement-a", bundleRegistrationId: "registration-1", eventId: "item-a", status: "active" },
      { entitlementId: "entitlement-b", bundleRegistrationId: "registration-1", eventId: "item-b", status: "active" }
    ],
    [{ entitlementId: "entitlement-a", eventId: "item-a", checkpointId: "checkpoint-1", checkedInAt: "2026-12-12T10:00:00.000Z", status: "checked_in" }],
    { "item-a": { title: "羽球比赛", checkpoints: ["入场"] }, "item-b": { title: "海边", checkpoints: ["集合"] } },
    [{ questionId: "name", label: "姓名" }, { questionId: "phone", label: "电话" }]
  );
  assert.deepEqual(JSON.parse(JSON.stringify(view.headers)), ["电子票", "姓名", "电话", "羽球比赛 · 入场", "海边 · 集合"]);
  assert.deepEqual(JSON.parse(JSON.stringify(view.rows)), [["BND-001", "小明", "0123456789", "2026-12-12T10:00:00.000Z", "未签到"]]);
});

test("combination plans expose edit, safe close, and guarded permanent deletion controls", async () => {
  const internalSource = await readFile(new URL("../apps-script/InternalMutationService.gs", import.meta.url), "utf8");
  const adminServiceSource = await readFile(new URL("../staff-apps-script/AdminService.gs", import.meta.url), "utf8");
  const adminScriptSource = await readFile(new URL("../staff-apps-script/AdminScript.html", import.meta.url), "utf8");
  assert.match(internalSource, /'admin\.archiveBundlePlan'/);
  assert.match(internalSource, /'admin\.deleteBundlePlan'/);
  assert.match(internalSource, /'admin\.archiveBundleItem'/);
  assert.match(internalSource, /'admin\.deleteBundleItem'/);
  assert.match(adminServiceSource, /function archiveBundlePlan\(payload\)/);
  assert.match(adminServiceSource, /function deleteBundlePlan\(payload\)/);
  assert.match(adminScriptSource, /编辑计划/);
  assert.match(adminScriptSource, /关闭计划/);
  assert.match(adminScriptSource, /删除计划/);
  assert.match(adminScriptSource, /编辑项目/);
  assert.match(adminScriptSource, /关闭项目/);
  assert.match(adminScriptSource, /删除项目/);
});

test("combination plans can collect configurable personal information and be shown on the public home page", async () => {
  const repositorySource = await readFile(new URL("../apps-script/Repository.gs", import.meta.url), "utf8");
  const internalSource = await readFile(new URL("../apps-script/InternalMutationService.gs", import.meta.url), "utf8");
  const codeSource = await readFile(new URL("../apps-script/Code.gs", import.meta.url), "utf8");
  const adminHtml = await readFile(new URL("../staff-apps-script/Admin.html", import.meta.url), "utf8");
  const adminScript = await readFile(new URL("../staff-apps-script/AdminScript.html", import.meta.url), "utf8");
  const publicIndex = await readFile(new URL("../public/js/index-page.js", import.meta.url), "utf8");
  assert.match(repositorySource, /'showOnHome'/);
  assert.match(internalSource, /'admin\.saveBundleQuestion'/);
  assert.match(internalSource, /'admin\.deleteBundleQuestion'/);
  assert.match(internalSource, /sortOrder\s*<\s*1/);
  assert.match(codeSource, /'listBundlePlans'/);
  assert.match(adminHtml, /id="bundle-question-form"/);
  assert.match(adminHtml, /name="options"/);
  assert.match(adminHtml, /value="photo"/);
  assert.match(adminScript, /saveBundleQuestion/);
  assert.match(adminScript, /deleteBundleQuestion/);
  assert.match(adminScript, /现在可以直接新增下一题/);
  assert.match(publicIndex, /listBundlePlans/);
});

test("combination administrator offers a collapsible project list and a participant-form preview", async () => {
  const adminHtml = await readFile(new URL("../staff-apps-script/Admin.html", import.meta.url), "utf8");
  const adminScript = await readFile(new URL("../staff-apps-script/AdminScript.html", import.meta.url), "utf8");
  assert.match(adminHtml, /id="preview-bundle-registration"/);
  assert.match(adminHtml, /id="bundle-registration-preview"/);
  assert.match(adminScript, /预览报名表/);
  assert.match(adminScript, /bundle-plan-fold/);
  assert.match(adminScript, /fold\.open\s*=\s*false/);
});

test("staff scanner source exposes active native bundle projects without ordinary event routing", async () => {
  const source = await readFile(new URL("../apps-script/StaffScannerService.gs", import.meta.url), "utf8");
  assert.match(source, /组合项目/);
  assert.match(source, /targetKind:\s*'bundle'/);
  assert.match(source, /bundleItemId/);
});
