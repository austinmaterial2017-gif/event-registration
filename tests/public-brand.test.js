import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("public pages use the 现代X好未来 brand and approved palette", async () => {
  const pages = await Promise.all(
    [
      "public/index.html",
      "public/register.html",
      "public/ticket.html",
      "public/verify.html",
      "public/v.html",
      "public/404.html",
    ].map(read),
  );
  const css = await read("public/css/app.css");

  pages.forEach((page) => {
    assert.match(page, /现代X好未来/);
    assert.doesNotMatch(page, /微光现场/);
  });
  pages.slice(0, 4).forEach((page) => {
    assert.match(page, /href="css\/app\.css\?v=20260728-timer"/);
  });
  assert.match(pages[0], /src="js\/index-page\.js\?v=20260728-timer"/);
  assert.match(pages[0], />请选择你参加的活动</);
  assert.doesNotMatch(pages[0], /SUMMER PROGRAMME|为好奇心|把想见的人/);

  ["#9d202b", "#65040b", "#fff1c8", "#ffd58b"].forEach((color) => {
    assert.match(css.toLowerCase(), new RegExp(color));
  });
});
