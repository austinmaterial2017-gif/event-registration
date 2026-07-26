import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

async function render404At(location) {
  const html = await readFile(new URL("../public/404.html", import.meta.url), "utf8");
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, "404 page must contain its base-path resolver");
  const styles = { attributes: {} };
  const home = { attributes: {} };
  vm.runInNewContext(script, {
    location,
    document: { getElementById: (id) => id === "page-styles" ? styles : home }
  });
  return { html, styles, home };
}

test("404 resolves assets and home link inside a nested GitHub Pages project", async () => {
  const { html, styles, home } = await render404At({ hostname: "organisation.github.io", pathname: "/event-ticket-system/missing/page" });
  assert.match(html, /id="page-styles"/);
  assert.equal(styles.href, "/event-ticket-system/css/app.css");
  assert.equal(home.href, "/event-ticket-system/");
});

test("404 uses the site root for a user GitHub Pages site or custom domain", async () => {
  const userSite = await render404At({ hostname: "organisation.github.io", pathname: "/missing" });
  const customDomain = await render404At({ hostname: "events.example.org", pathname: "/missing" });
  assert.equal(userSite.home.href, "/");
  assert.equal(customDomain.styles.href, "/css/app.css");
});
