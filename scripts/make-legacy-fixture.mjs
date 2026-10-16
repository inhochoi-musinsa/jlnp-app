// Dev/QA only. Drives an OLD build of the app (a git worktree you built yourself) to create learner data, then writes
//   <out>/<label>.idb.json    raw dump of the IndexedDB stores as that version wrote them
//   <out>/<label>.backup.json the JSON backup that version exports
// The current build must restore both without losing anything (tests/ui/legacy.ui.test.ts).
// usage: node scripts/make-legacy-fixture.mjs <worktreeDir> <label> [outDir]
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

const [dir, label, out = "tests/fixtures/legacy"] = process.argv.slice(2);
if (!dir || !label) { console.error("usage: make-legacy-fixture.mjs <worktreeDir> <label> [outDir]"); process.exit(2); }
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const html = await readFile(resolve(dir, "dist/index.html"));
const srv = createServer((req, res) => { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(html); });
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
const port = srv.address().port;
const URL = `http://localhost:${port}/`;
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
const page = await ctx.newPage();
await page.goto(URL + "#settings");
await page.waitForSelector("#save-target");
await page.check("input[name=font][value=XL]").catch(() => {});
await page.fill("#target-year", "2099"); await page.selectOption("#target-month", "12"); await page.click("#save-target");
await page.waitForTimeout(500);
// answer a handful of diagnostic questions with this old build's own UI
await page.goto(URL + "#diag-run");
for (let i = 0; i < 6; i++) {
  await page.waitForSelector(".choice", { timeout: 5000 }).catch(() => {});
  if (!(await page.locator(".choice").count())) break;
  await page.locator(".choice").nth(i % 4).click();
  await page.click("#submit"); await page.waitForSelector("#next"); await page.click("#next");
}
await page.waitForTimeout(800);
await page.goto(URL + "#settings");
await page.waitForSelector("#export-backup");
const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#export-backup")]);
const backup = await readFile(await dl.path(), "utf8");
const dump = await page.evaluate(async () => {
  const dbs = await indexedDB.databases();
  const out = {};
  for (const info of dbs) {
    const db = await new Promise((r, j) => { const q = indexedDB.open(info.name); q.onsuccess = () => r(q.result); q.onerror = () => j(q.error); });
    const stores = {};
    for (const s of [...db.objectStoreNames]) {
      const all = await new Promise((r) => { const tx = db.transaction(s); const os = tx.objectStore(s); const rows = []; const c = os.openCursor(); c.onsuccess = () => { const cur = c.result; if (cur) { rows.push({ k: cur.key, v: cur.value }); cur.continue(); } else r(rows); }; });
      stores[s] = { keyPath: db.transaction(s).objectStore(s).keyPath, indexes: [...db.transaction(s).objectStore(s).indexNames], rows: all };
    }
    out[info.name] = { version: info.version, stores };
    db.close();
  }
  return out;
});
await mkdir(out, { recursive: true });
await writeFile(resolve(out, `${label}.backup.json`), JSON.stringify(JSON.parse(backup), null, 1));
await writeFile(resolve(out, `${label}.idb.json`), JSON.stringify(dump));
const ev = Object.values(dump)[0]?.stores?.events?.rows?.length ?? 0;
console.log(`${label}: ${ev} events, idb version ${Object.values(dump)[0]?.version}`);
await browser.close(); srv.close();
