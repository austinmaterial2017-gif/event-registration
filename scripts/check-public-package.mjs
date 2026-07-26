import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL("..", import.meta.url));
const directoryOption = process.argv.indexOf("--public-dir");
const publicRoot = directoryOption === -1 ? join(root, "public") : process.argv[directoryOption + 1];
if (!publicRoot) throw new Error("Public package check failed: --public-dir requires a directory.");
const approvedEndpoint = process.env.PUBLIC_APPS_SCRIPT_WEB_APP_URL || "";
const attestedStaffEndpoint = process.env.STAFF_APPS_SCRIPT_WEB_APP_URL || "";
const endpointPattern = /^https:\/\/script\.google\.com\/macros\/s\/[^/?#]+\/exec$/;
const allowedFiles = new Set([
  "404.html", "index.html", "register.html", "ticket.html", "verify.html",
  "assets/owl-mascot.svg",
  "css/app.css",
  "js/activity-countdown-view.js", "js/activity-ticket-view.js", "js/api.js", "js/config.js", "js/domain.js",
  "js/event-list-flow.js", "js/index-page.js", "js/qr.js", "js/register-page.js",
  "js/registration-flow.js", "js/registration-success.js", "js/ticket-page.js", "js/verify-page.js"
]);

async function filesIn(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesIn(path) : [path];
  }));
  return nested.flat();
}

function publicName(path) {
  return relative(publicRoot, path).split(sep).join("/");
}

function fail(message) {
  throw new Error(`Public package check failed: ${message}`);
}

const paths = await filesIn(publicRoot);
const names = paths.map(publicName).sort();
for (const name of names) if (!allowedFiles.has(name)) fail(`unexpected file ${name}`);
for (const name of allowedFiles) if (!names.includes(name)) fail(`missing required file ${name}`);

const files = await Promise.all(paths.map(async (path) => ({
  name: publicName(path), text: await readFile(path, "utf8"), path
})));
const combined = files.map(({ name, text }) => `\n===== ${name} =====\n${text}`).join("");

const forbidden = [
  ["Google Sheets URL", /https?:\/\/(?:docs|sheets)\.google\.com\/(?:spreadsheets|a\/[^/]+\/spreadsheets)\//i],
  ["Google Sheet ID", /\b1[A-Za-z0-9_-]{20,}\b/],
  ["Google Sheet ID", /(?:spreadsheetId|sheetId|ACTIVE_SPREADSHEET_ID)\s*[:=]\s*["'][A-Za-z0-9_-]{20,}/i],
  ["password field or value", /(?:password|passwd|pwd)\b/i],
  ["allowlist", /allowlist/i],
  ["Apps Script server source", /function\s+(?:doGet|doPost|setupSystem|switchAdminSheet|checkInTicket)\s*\(/],
  ["administrator HTML", /<title>[^<]*管理|id=["']admin-|StaffCheckIn\.html|AdminScript\.html/i],
  ["private participant email literal", /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i],
  ["private participant phone literal", /(?:phone|mobile|tel)\s*[:=]\s*["']\+?\d[\d -]{7,}\d["']/i],
  ["hard-coded ticket token", /(?:token|verificationValue)\s*[:=]\s*["'][A-Za-z0-9_-]{16,}["']/i]
];
for (const [label, pattern] of forbidden) if (pattern.test(combined)) fail(`contains ${label}`);

const config = files.find(({ name }) => name === "js/config.js")?.text || "";
const configLines = config.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
const allowedConfigLine = /^export const (APPS_SCRIPT_WEB_APP_URL|PUBLIC_BASE_URL) = "([^"]+)";$/;
const configValues = new Map();
for (const line of configLines) {
  const match = line.match(allowedConfigLine);
  if (!match) fail("public endpoint configuration must contain only approved exact exports.");
  if (configValues.has(match[1])) fail(`duplicate public configuration export ${match[1]}.`);
  configValues.set(match[1], match[2]);
}
if (!configValues.has("APPS_SCRIPT_WEB_APP_URL")) {
  fail("public endpoint configuration must include APPS_SCRIPT_WEB_APP_URL.");
}
const configuredEndpoint = configValues.get("APPS_SCRIPT_WEB_APP_URL");
const usesPlaceholder = configuredEndpoint === "PASTE_APPS_SCRIPT_WEB_APP_URL_HERE";
if (!usesPlaceholder && (!endpointPattern.test(approvedEndpoint) || configuredEndpoint !== approvedEndpoint)) {
  fail("public endpoint must be the separately approved exact Apps Script endpoint.");
}
const endpointOccurrences = [...combined.matchAll(/https:\/\/script\.google\.com\/macros\/s\/[^\s"'<)]+/gi)];
if (!usesPlaceholder && !endpointPattern.test(attestedStaffEndpoint)) {
  fail("staff endpoint must be manually attested as an exact Apps Script endpoint.");
}
if (!usesPlaceholder && approvedEndpoint === attestedStaffEndpoint) {
  fail("manually attested public and staff endpoints must differ.");
}
if (attestedStaffEndpoint && endpointOccurrences.some((match) => match[0] === attestedStaffEndpoint)) {
  fail("contains the manually attested staff endpoint.");
}
if (usesPlaceholder && endpointOccurrences.length) {
  fail("contains an Apps Script endpoint outside the placeholder configuration.");
}
if (!usesPlaceholder &&
    (endpointOccurrences.length !== 1 || endpointOccurrences[0][0] !== approvedEndpoint)) {
  fail("contains an unexpected Apps Script endpoint.");
}

for (const file of files.filter(({ name }) => name.endsWith(".js"))) {
  await execFileAsync(process.execPath, ["--check", file.path]);
}

console.log(`Public package check passed (${names.length} approved participant files; ${files.filter(({ name }) => name.endsWith(".js")).length} JavaScript files parsed).`);
