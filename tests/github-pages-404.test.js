import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

async function read404() {
  const html = await readFile(new URL("../public/404.html", import.meta.url), "utf8");
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, "404 page must apply its explicit configured base path");
  const configured = html.match(/<meta name="github-pages-base-path" content="([^"]+)">/)?.[1];
  return { html, script, configured };
}

async function configuredLinks(basePath) {
  const { html, script } = await read404();
  const configured = html.replace(/content="\/event-ticket-system\/"/, `content="${basePath}"`);
  const meta = { content: configured.match(/github-pages-base-path" content="([^"]+)/)?.[1] };
  const homeLink = {};
  const homeAction = {};
  vm.runInNewContext(script, {
    document: {
      querySelector: () => meta,
      getElementById: (id) => id === "home-link" ? homeLink : homeAction
    }
  });
  return { homeLink, homeAction };
}

test("404 has an explicit nested-project base path and absolute home links by default", async () => {
  const { html, configured } = await read404();
  assert.equal(configured, "/event-ticket-system/");
  assert.match(html, /href="\/event-ticket-system\/"/);
  assert.doesNotMatch(html, /href="(?:\.\/|index\.html|css\/)/);
  assert.match(html, /<style>[\s\S]*?<\/style>/);
});

test("404 applies the configured root or nested project base without inferring it from the request URL", async () => {
  const root = await configuredLinks("/");
  const project = await configuredLinks("/event-ticket-system/");
  assert.equal(root.homeLink.href, "/");
  assert.equal(root.homeAction.href, "/");
  assert.equal(project.homeLink.href, "/event-ticket-system/");
  assert.equal(project.homeAction.href, "/event-ticket-system/");
});
