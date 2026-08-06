import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const root = new URL("../", import.meta.url);
const publicFiles = [
  "apps-script/appsscript.json",
  "apps-script/Repository.gs",
  "apps-script/ReadableViews.gs",
  "apps-script/RegistrationService.gs",
  "apps-script/TicketService.gs",
  "apps-script/AttendanceService.gs",
  "apps-script/InternalGateway.gs",
  "apps-script/InternalMutationService.gs",
  "apps-script/SwitchProbeService.gs",
  "apps-script/Code.gs"
];
const staffFiles = [
  "staff-apps-script/appsscript.json",
  "staff-apps-script/Repository.gs",
  "staff-apps-script/InternalClient.gs",
  "staff-apps-script/AttendanceService.gs",
  "staff-apps-script/AdminService.gs",
  "staff-apps-script/Code.gs",
  "staff-apps-script/StaffCheckIn.html",
  "staff-apps-script/Admin.html",
  "staff-apps-script/AdminScript.html"
];

async function expectedBundle(fileNames) {
  const sections = [];
  for (const fileName of fileNames) {
    const content = (await readFile(new URL(fileName, root), "utf8")).replace(/\r\n/g, "\n").trimEnd();
    sections.push(`===== ${fileName} =====\n${content}`);
  }
  return `${sections.join("\n\n")}\n`;
}

async function expectedStaffBundle() {
  const staffCoreBundle = await expectedBundle(staffFiles);
  const copiedSource = (await readFile(
    new URL("../staff-apps-script/SourceBundles.gs", import.meta.url),
    "utf8"
  )).replace(/\r\n/g, "\n");
  return `${staffCoreBundle}\n===== staff-apps-script/SourceBundles.gs =====\n${copiedSource}`;
}

function bundleSections(bundle) {
  const matches = [...bundle.matchAll(/^===== ([^\r\n]+) =====\r?\n/gm)];
  const sections = new Map();
  matches.forEach((match, index) => {
    const start = match.index + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index : bundle.length;
    sections.set(match[1], bundle.slice(start, end).replace(/\r?\n$/, "").trimEnd());
  });
  return sections;
}

test("development-time source bundle generation is deterministic and current", async () => {
  await execFileAsync(process.execPath, [
    fileURLToPath(new URL("../scripts/build-admin-source-bundles.mjs", import.meta.url)),
    "--check"
  ], { cwd: fileURLToPath(new URL("..", import.meta.url)) });

  const [publicSnapshot, staffSnapshot] = await Promise.all([
    readFile(new URL("../source-bundles/public-backend.txt", import.meta.url), "utf8"),
    readFile(new URL("../source-bundles/staff-admin.txt", import.meta.url), "utf8")
  ]);
  assert.equal(publicSnapshot.replace(/\r\n/g, "\n"), await expectedBundle(publicFiles));
  assert.equal(staffSnapshot.replace(/\r\n/g, "\n"), await expectedStaffBundle());
});

test("runtime bundle constants exactly match relevant tracked source and redact private runtime data", async () => {
  const source = await readFile(new URL("../staff-apps-script/SourceBundles.gs", import.meta.url), "utf8");
  const context = vm.createContext({});
  vm.runInContext(source, context, { filename: "SourceBundles.gs" });
  const expectedPublic = await expectedBundle(publicFiles);
  const expectedStaff = await expectedStaffBundle();

  assert.equal(context.PUBLIC_BACKEND_SOURCE_BUNDLE_, expectedPublic);
  assert.equal(context.STAFF_ADMIN_SOURCE_BUNDLE_, expectedStaff);
  const combined = `${context.PUBLIC_BACKEND_SOURCE_BUNDLE_}\n${context.STAFF_ADMIN_SOURCE_BUNDLE_}`;
  for (const privateValue of [
    "source-sheet-id",
    "target-sheet-id",
    "alice@example.com",
    "0123456789",
    "secret answer",
    "opaque-private-ticket-token",
    "admin@example.com",
    "staff@example.com",
    "https://script.google.com/macros/s/private-public-deployment/exec",
    "https://script.google.com/macros/s/private-staff-deployment/exec",
    "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789",
    "private-shared-secret-value"
  ]) {
    assert.equal(combined.includes(privateValue), false, privateValue);
  }
  assert.doesNotMatch(combined, /["'][A-Za-z0-9_-]{32,}["']/);
});

test("a deployed staff bundle copies the same complete self-stable staff bundle", async () => {
  const staffBundle = (await readFile(
    new URL("../source-bundles/staff-admin.txt", import.meta.url),
    "utf8"
  )).replace(/\r\n/g, "\n");
  const trackedSource = (await readFile(
    new URL("../staff-apps-script/SourceBundles.gs", import.meta.url),
    "utf8"
  )).replace(/\r\n/g, "\n").trimEnd();
  const originalSections = bundleSections(staffBundle);
  const embeddedSource = originalSections.get("staff-apps-script/SourceBundles.gs");

  assert.equal(embeddedSource, trackedSource);
  const context = vm.createContext({});
  vm.runInContext(embeddedSource, context, { filename: "deployed-SourceBundles.gs" });
  const copiedBundle = String(context.STAFF_ADMIN_SOURCE_BUNDLE_ || "").replace(/\r\n/g, "\n");
  assert.equal(copiedBundle, staffBundle);

  const copiedSections = bundleSections(copiedBundle);
  assert.deepEqual([...copiedSections.keys()], [...originalSections.keys()]);
  for (const [name, content] of originalSections) {
    assert.equal(copiedSections.get(name), content, `${name} changed after copy`);
  }
});

test("bundle generation rejects injected private deployment and participant canaries", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "event-bundle-redaction-"));
  const builder = fileURLToPath(new URL("../scripts/build-admin-source-bundles.mjs", import.meta.url));
  await Promise.all([
    cp(fileURLToPath(new URL("../apps-script", import.meta.url)), join(fixtureRoot, "apps-script"), {
      recursive: true
    }),
    cp(fileURLToPath(new URL("../staff-apps-script", import.meta.url)), join(fixtureRoot, "staff-apps-script"), {
      recursive: true
    })
  ]);
  const target = join(fixtureRoot, "apps-script", "Code.gs");
  const original = await readFile(target, "utf8");
  const cases = [
    ["deployed Apps Script URL", "var leaked = 'https://script.google.com/macros/s/FAKE_DEPLOYMENT_CANARY_123456789/exec';"],
    ["concrete Google Sheet URL", "var leaked = 'https://docs.google.com/spreadsheets/d/1FakeSheetCanary_1234567890123456789/edit';"],
    ["Google Sheet ID", "var leaked = '1FakeSheetCanary_1234567890123456789';"],
    ["assigned shared secret", "var INTERNAL_API_SHARED_SECRET = 'fake-shared-secret-canary';"],
    ["assigned allowlist", "var ADMIN_EMAIL_ALLOWLIST = 'fake-allowlist-canary';"],
    ["assigned credential", "var password = 'fake-credential-canary';"],
    ["private key", "var leaked = '-----BEGIN PRIVATE KEY-----';"],
    ["email address", "var participantEmail = 'private.person@example.invalid';"],
    ["participant phone", "var participantPhone = '+60 12-345 6789';"]
  ];

  try {
    for (const [label, canary] of cases) {
      await writeFile(target, `${original}\n${canary}\n`, "utf8");
      await assert.rejects(
        execFileAsync(process.execPath, [builder, "--root", fixtureRoot]),
        new RegExp(`Public bundle contains a possible ${label}`, "i"),
        label
      );
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("deployment guides describe the permanent registry and automatic private activity-Sheet upgrade", async () => {
  const [readme, deployment] = await Promise.all([
    readFile(new URL("../README.md", import.meta.url), "utf8"),
    readFile(new URL("../apps-script/DEPLOYMENT.md", import.meta.url), "utf8")
  ]);

  for (const requiredStatement of [
    "永久注册表会继续保留",
    "每个新活动都会自动建立一份独立、私有的 Google Sheet",
    "只需在升级后第一次运行时批准一次新增的 Google Drive 权限",
    "以后新增活动不需要建立、修改或重新部署 Apps Script",
    "不会自动拆分已有且非空的旧活动资料"
  ]) {
    assert.equal(readme.includes(requiredStatement), true, requiredStatement);
  }
  for (const requiredStatement of [
    "The registry Sheet remains permanent.",
    "Every new activity automatically receives its own private Google Sheet.",
    "The first run after this upgrade requests one-time Google Drive authorization.",
    "Creating later activities requires no Apps Script setup, edits, or redeployment.",
    "Existing nonempty legacy activity data is not split automatically."
  ]) {
    assert.equal(deployment.includes(requiredStatement), true, requiredStatement);
  }
});

test("deployment docs separate existing upgrades from fresh installs and provide a non-destructive rollback", async () => {
  const deployment = await readFile(new URL("../apps-script/DEPLOYMENT.md", import.meta.url), "utf8");
  for (const requiredStatement of [
    "## Updating existing protected deployments",
    "Keep the existing protected projects and official deployment URLs.",
    "## Fresh installation",
    "Retain the prior public and staff deployment versions before upgrading.",
    "Pause participant submissions and staff or administrator mutations",
    "revert the staff deployment first, then revert the public deployment",
    "Re-test the old public registration, ticket, verification, and staff routes",
    "Code rollback does not undo registry initialization, private Sheets, or data writes.",
    "Never delete those Sheets or rows automatically during rollback."
  ]) {
    assert.equal(deployment.includes(requiredStatement), true, requiredStatement);
  }
});

test("authenticated gateway access requires allowlists, not blanket Sheet sharing", async () => {
  const [readme, deployment] = await Promise.all([
    readFile(new URL("../README.md", import.meta.url), "utf8"),
    readFile(new URL("../apps-script/DEPLOYMENT.md", import.meta.url), "utf8")
  ]);
  assert.match(readme, /工作人员与管理员的网关操作不需要直接分享永久注册表或活动 Sheet/);
  assert.match(deployment, /Gateway operations do not require direct sharing of the registry or activity Sheets/);
  assert.doesNotMatch(readme, /两种角色的人必须同时出现在两个名单，并且拥有 Sheet 权限/);
  assert.doesNotMatch(deployment, /both arrays and must have Sheet access/);
});

test("source bundle plumbing stays protected and out of the anonymous project", async () => {
  const [adminService, publicCode, internalGateway, internalService] = await Promise.all([
    readFile(new URL("../staff-apps-script/AdminService.gs", import.meta.url), "utf8"),
    readFile(new URL("../apps-script/Code.gs", import.meta.url), "utf8"),
    readFile(new URL("../apps-script/InternalGateway.gs", import.meta.url), "utf8"),
    readFile(new URL("../apps-script/InternalMutationService.gs", import.meta.url), "utf8")
  ]);
  const getter = adminService.match(/function\s+getAdminSourceBundles\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/)?.[1] || "";
  assert.match(getter, /requireAuthorizedAdminSession_\s*\(\s*\)/);
  assert.match(adminService, /PUBLIC_BACKEND_SOURCE_BUNDLE_/);
  assert.match(adminService, /STAFF_ADMIN_SOURCE_BUNDLE_/);
  assert.doesNotMatch(publicCode, /AdminSourceBundles|SourceBundles|ADMIN_EMAIL_ALLOWLIST/);
  assert.match(internalGateway, /isValidInternalRequest_\s*\(\s*request\s*\)/);
  assert.match(internalGateway, /executeInternalActionLocked_/);
  assert.doesNotMatch(internalService, /["']admin\.getSourceBundles["']/);
});

test("the paste-ready staff bundle contains every HTML template referenced by bundled runtime code", async () => {
  const staffBundle = await readFile(new URL("../source-bundles/staff-admin.txt", import.meta.url), "utf8");
  const sections = bundleSections(staffBundle);
  const runtimeSources = [...sections.entries()]
    .filter(([name]) => /\.(?:gs|html)$/.test(name) && name !== "staff-apps-script/SourceBundles.gs");
  const references = runtimeSources.flatMap(([sourceName, source]) =>
    [...source.matchAll(/HtmlService\.create(?:HtmlOutput|Template)FromFile\(\s*["']([^"']+)["']\s*\)/g)]
      .map((match) => ({ sourceName, templateName: match[1] })));

  assert.ok(references.some(({ templateName }) => templateName === "StaffCheckIn"));
  assert.ok(references.some(({ templateName }) => templateName === "Admin"));
  assert.ok(references.some(({ templateName }) => templateName === "AdminScript"));
  for (const { sourceName, templateName } of references) {
    const templatePath = `staff-apps-script/${templateName}.html`;
    assert.equal(
      sections.has(templatePath),
      true,
      `${sourceName} references missing ${templateName}.html`
    );
    const trackedTemplate = (await readFile(new URL(`../${templatePath}`, import.meta.url), "utf8"))
      .replace(/\r\n/g, "\n")
      .trimEnd();
    assert.equal(
      sections.get(templatePath).replace(/\r\n/g, "\n"),
      trackedTemplate,
      `${templateName}.html in the paste-ready bundle is stale`
    );
  }
});

test("the paste-ready staff bundle contains the internal backend client used by staff and admin services", async () => {
  const staffBundle = await readFile(new URL("../source-bundles/staff-admin.txt", import.meta.url), "utf8");
  const sections = bundleSections(staffBundle);
  const internalClient = sections.get("staff-apps-script/InternalClient.gs") || "";

  assert.equal(
    sections.has("staff-apps-script/InternalClient.gs"),
    true,
    "staff deployment bundle is missing InternalClient.gs"
  );
  assert.match(internalClient, /function\s+invokeInternalBackend_\s*\(/);
});
