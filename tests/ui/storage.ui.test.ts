import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser } from "playwright-core";
import type { ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launch, startServer, fileUrl } from "./helpers";

const PORT = 18082;
const URL = `http://localhost:${PORT}/`;
let server: ChildProcess;
let browser: Browser;
beforeAll(async () => { server = await startServer(PORT); browser = await launch(); }, 30000);
afterAll(async () => { await browser?.close(); server?.kill(); });

const BREAK_IDB = () => {
  const bad = { open() { throw new DOMException("denied for test", "SecurityError"); } };
  Object.defineProperty(window, "indexedDB", { value: bad, configurable: true });
};

describe("T04 storage in a real browser", () => {
  it("IndexedDB persists across reload: settings event survives and pending count is shown", async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto(URL + "#settings");
    await page.waitForSelector("#export-backup");
    await page.getByLabel("크게", { exact: true }).check();
    await page.waitForTimeout(300);
    const n = await page.evaluate(async () => {
      const db: IDBDatabase = await new Promise((r, j) => { const q = indexedDB.open("jlpt-app", 1); q.onsuccess = () => r(q.result); q.onerror = () => j(q.error); });
      const all: any[] = await new Promise((r) => { const q = db.transaction("events").objectStore("events").getAll(); q.onsuccess = () => r(q.result); });
      return all.map((x) => x.event.type);
    });
    expect(n).toContain("PROFILE_CREATED");
    expect(n).toContain("SETTINGS_UPDATED");
    await page.reload();
    await page.waitForSelector("#export-backup");
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--fs").trim())).toBe("19px");
    expect(await page.locator("#backup-result").count()).toBe(1);
    expect(await page.getByText("현재 실행에서만 유지됨").count()).toBe(0); // persistent here
    await ctx.close();
  });

  it("when storage is unusable the warning is shown on home and settings", async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.addInitScript(BREAK_IDB);
    const page = await ctx.newPage();
    await page.goto(URL + "#home");
    await page.waitForSelector("#sync-badge");
    await page.waitForSelector("text=현재 실행에서만 유지됨 — 백업 권장");
    await page.goto(URL + "#settings");
    await page.waitForSelector("text=현재 실행에서만 유지됨 — 백업 권장");
    await ctx.close();
  });

  it("file:// with unusable storage shows the same warning and still renders", async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.addInitScript(BREAK_IDB);
    const page = await ctx.newPage();
    await page.goto(fileUrl() + "#home");
    await page.waitForSelector("text=현재 실행에서만 유지됨 — 백업 권장");
    expect(await page.textContent(".banner")).toContain("로컬 모드");
    await ctx.close();
  });

  it("backup download -> restore in a fresh browser profile; second restore adds nothing", async () => {
    const a = await browser.newContext({ acceptDownloads: true, viewport: { width: 390, height: 844 } });
    const pa = await a.newPage();
    await pa.goto(URL + "#settings");
    await pa.waitForSelector("#export-backup");
    await pa.getByLabel("아주 크게").check();
    await pa.waitForTimeout(300);
    const [dl] = await Promise.all([pa.waitForEvent("download"), pa.click("#export-backup")]);
    const path = join(mkdtempSync(join(tmpdir(), "jlpt-bk-")), "backup.json");
    await dl.saveAs(path);
    const text = readFileSync(path, "utf8");
    const data = JSON.parse(text);
    expect(data.format).toBe("jlpt-backup");
    expect(data.events.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(data)).not.toMatch(/token|secret|password/i);
    await a.close();

    const b = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const pb = await b.newPage();
    await pb.goto(URL + "#settings");
    await pb.waitForSelector("#import-file");
    await pb.setInputFiles("#import-file", path);
    await pb.waitForSelector("#apply-import");
    const first = await pb.textContent("#backup-result");
    expect(first).toMatch(/신규 \d+건/);
    await pb.click("#apply-import");
    await pb.waitForSelector("text=건을 추가했습니다");
    await pb.setInputFiles("#import-file", []);
    await pb.setInputFiles("#import-file", path);
    await pb.waitForFunction(() => document.querySelector("#backup-result")?.textContent?.includes("신규 0건"));
    expect(await pb.locator("#apply-import").isDisabled()).toBe(true);
    await b.close();
  }, 30000);
});
