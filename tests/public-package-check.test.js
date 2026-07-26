import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL("..", import.meta.url));
const checker = join(root, "scripts", "check-public-package.mjs");
const publicSource = join(root, "public");
const publicEndpoint = "https://script.google.com/macros/s/public-deployment/exec";

async function withPublicFixture(mutator, approvedEndpoint = publicEndpoint) {
  const directory = await mkdtemp(join(tmpdir(), "event-ticket-public-"));
  const publicRoot = join(directory, "public");
  await cp(publicSource, publicRoot, { recursive: true });
  try {
    await mutator(publicRoot);
    return await execFileAsync(process.execPath, [checker, "--public-dir", publicRoot], {
      env: { ...process.env, PUBLIC_APPS_SCRIPT_WEB_APP_URL: approvedEndpoint }
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function appendFixtureFile(publicRoot, fileName, value) {
  const path = join(publicRoot, fileName);
  await writeFile(path, `${await readFile(path, "utf8")}\n<!-- ${value} -->\n`, "utf8");
}

test("public package checker permits only the separately approved exact public endpoint", async () => {
  const result = await withPublicFixture(async (publicRoot) => {
    await writeFile(join(publicRoot, "js", "config.js"), `export const APPS_SCRIPT_WEB_APP_URL = "${publicEndpoint}";\n`, "utf8");
  });
  assert.match(result.stdout, /Public package check passed/);
});

test("public package checker rejects a config endpoint that differs from the separately approved value", async () => {
  await assert.rejects(
    withPublicFixture(
      (publicRoot) => writeFile(join(publicRoot, "js", "config.js"), `export const APPS_SCRIPT_WEB_APP_URL = "${publicEndpoint}";\n`, "utf8"),
      "https://script.google.com/macros/s/different-public-deployment/exec"
    ),
    /Public package check failed:.*approved exact Apps Script endpoint/i
  );
});

test("public package checker rejects adversarial private URLs and identifiers in every public file", async () => {
  const cases = [
    ["a second Apps Script deployment", "https://script.google.com/macros/s/staff-deployment/exec"],
    ["an administrator deployment query", "https://script.google.com/macros/s/public-deployment/exec?view=admin"],
    ["a Google Sheets URL", "https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit"],
    ["a generic Sheet ID", "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789"],
    ["an allowlist", "ADMIN_EMAIL_ALLOWLIST"],
    ["a password", "password=not-public"]
  ];
  for (const [label, value] of cases) {
    await assert.rejects(
      withPublicFixture((publicRoot) => appendFixtureFile(publicRoot, "index.html", value)),
      new RegExp(`Public package check failed:.*(?:${label.includes("deployment") ? "endpoint" : label.includes("Sheets") || label.includes("Sheet") ? "Sheet" : label.includes("allowlist") ? "allowlist" : "password"})`, "i"),
      label
    );
  }
});
