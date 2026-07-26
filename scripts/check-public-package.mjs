import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL("..", import.meta.url));
const publicRoot = join(root, "public");
const allowedFiles = new Set([
  "404.html", "index.html", "register.html", "ticket.html", "verify.html",
  "css/app.css",
  "js/activity-countdown-view.js", "js/api.js", "js/config.js", "js/domain.js",
  "js/event-list-flow.js", "js/index-page.js", "js/qr.js", "js/register-page.js",
  "js/registration-flow.js", "js/ticket-page.js", "js/verify-page.js"
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
  ["staff/admin endpoint", /(?:staff|admin)[^\n]{0,80}https:\/\/script\.google\.com\/macros\/s\//i],
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
if (!/APPS_SCRIPT_WEB_APP_URL/.test(config)) fail("public endpoint configuration is missing");
if (/https:\/\/script\.google\.com\/macros\/s\//i.test(combined.replace(config, ""))) {
  fail("only js/config.js may contain the public Apps Script URL");
}

for (const file of files.filter(({ name }) => name.endsWith(".js"))) {
  await execFileAsync(process.execPath, ["--check", file.path]);
}

console.log(`Public package check passed (${names.length} approved participant files; ${files.filter(({ name }) => name.endsWith(".js")).length} JavaScript files parsed).`);
