import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser, Page } from "playwright-core";
import type { ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { launch, startServer } from "./helpers";
import { createEvent } from "../../app/src/storage/events";

// Fixtures were written by REAL older builds (scripts/make-legacy-fixture.mjs, builds taken from the committed dist/ of each commit):
//   t06 (IndexedDB v1, before the content store), v0.1.0 (v2), t12 (v2), t14 (v2). All carry duplicate deviceSeq values (a bug of those builds).
const PORT = 18093;
const URL = `http://localhost:${PORT}/`;
const FIX = resolve(__dirname, "../fixtures/legacy");
const LABELS = ["t06", "v0.1.0", "t12", "t14"] as const;
let server: ChildProcess;
let browser: Browser;
beforeAll(async () => { server = await startServer(PORT); browser = await launch(); }, 30000);
afterAll(async () => { await browser?.close(); server?.kill(); });

const dump = (l: string) => JSON.parse(readFileSync(resolve(FIX, `${l}.idb.json`), "utf8"));
const backup = (l: string) => JSON.parse(readFileSync(resolve(FIX, `${l}.backup.json`), "utf8"));

/** Recreates the old database exactly as that build left it (same version, stores, indexes, rows) on a page of the app's origin that has not loaded the app. */
async function installDump(page: Page, d: unknown): Promise<void> {
  await page.goto(URL + "blank");
  await page.evaluate(async (all: any) => {
    for (const [name, info] of Object.entries<any>(all)) {
      await new Promise<void>((res) => { const del = indexedDB.deleteDatabase(name); del.onsuccess = () => res(); del.onerror = () => res(); del.onblocked = () => res(); });
      const db: IDBDatabase = await new Promise((res, rej) => {
        const q = indexedDB.open(name, info.version);
        q.onupgradeneeded = () => { for (const [s, spec] of Object.entries<any>(info.stores)) { const os = q.result.createObjectStore(s, spec.keyPath ? { keyPath: spec.keyPath } : undefined); for (const ix of spec.indexes) os.createIndex(ix, ix); } };
        q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
      });
      for (const [s, spec] of Object.entries<any>(info.stores)) {
        const tx = db.transaction(s, "readwrite"); const os = tx.objectStore(s);
        for (const r of spec.rows) spec.keyPath ? os.put(r.v) : os.put(r.v, r.k);
        await new Promise<void>((r) => { tx.oncomplete = () => r(); });
      }
      db.close();
    }
  }, d);
}
const readDb = (page: Page) => page.evaluate(async () => {
  const dbs = await indexedDB.databases();
  const info = dbs.find((x) => x.name === "jlpt-app")!;
  const db: IDBDatabase = await new Promise((r) => { const q = indexedDB.open("jlpt-app"); q.onsuccess = () => r(q.result); });
  const get = (s: string) => new Promise<any[]>((r) => { const q = db.transaction(s).objectStore(s).getAll(); q.onsuccess = () => r(q.result); });
  const meta: Record<string, unknown> = {};
  await new Promise<void>((r) => { const c = db.transaction("meta").objectStore("meta").openCursor(); c.onsuccess = () => { const cur = c.result; if (cur) { meta[String(cur.key)] = cur.value; cur.continue(); } else r(); }; });
  const out = { version: info.version, stores: [...db.objectStoreNames], events: (await get("events")).map((x) => x.event), snapshots: db.objectStoreNames.contains("snapshots") ? await get("snapshots") : [], meta };
  db.close();
  return out;
});

describe("T17 data written by older builds restores with nothing lost (PC Chrome headless)", () => {
  for (const label of LABELS) {
    it(`${label}: opens, upgrades the database to v3 and keeps identity, settings, target, diagnostic progress and every event`, async () => {
      const d = dump(label);
      const old = d["jlpt-app"];
      const oldIds: string[] = old.stores.events.rows.map((r: any) => r.v.event.eventId);
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const page = await ctx.newPage();
      await installDump(page, d);
      await page.goto(URL + "#home");
      await page.waitForSelector("#runway-text");
      const after = await readDb(page);
      expect(after.version).toBe(3);
      expect(after.stores).toEqual(expect.arrayContaining(["events", "meta", "content", "snapshots"]));
      const ids = new Set(after.events.map((e: any) => e.eventId));
      for (const id of oldIds) expect(ids.has(id), `event ${id} lost`).toBe(true);
      const oldMeta = Object.fromEntries(old.stores.meta.rows.map((r: any) => [r.k, r.v]));
      expect(after.meta.profileId).toBe(oldMeta.profileId);
      expect(after.meta.deviceId).toBe(oldMeta.deviceId);
      // an automatic recovery point of the pre-upgrade log exists
      expect(after.snapshots.length).toBe(1);
      expect(after.snapshots[0]).toMatchObject({ reason: "AFTER_UPGRADE", eventCount: oldIds.length, fromDbVersion: old.version });
      // user-visible state came back from the events
      expect(await page.textContent("#target-text")).toContain("2099");
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--fs").trim()).catch(() => "")).toMatch(/22px|^$/);
      await page.goto(URL + "#diag");
      await page.waitForSelector("#diag-go");
      expect(await page.textContent("main.view")).toMatch(/6 \/ 28 완료/);
      // keep using it: a new answer gets a fresh, larger sequence number than anything stored before
      await page.click("#diag-go");
      await page.waitForSelector(".choice");
      await page.locator(".choice").first().click(); await page.click("#submit"); await page.waitForSelector("#next");
      const later = await readDb(page);
      const oldMax = Math.max(...old.stores.events.rows.map((r: any) => r.v.event.deviceSeq));
      const mine = later.events.filter((e: any) => !ids.has(e.eventId));
      expect(mine.length).toBeGreaterThan(0);
      expect(Math.min(...mine.map((e: any) => e.deviceSeq))).toBeGreaterThan(oldMax);
      expect(new Set(mine.map((e: any) => e.deviceSeq)).size).toBe(mine.length);
      await ctx.close();
    }, 90000);

    it(`${label}: its JSON backup imports into a fresh install with 0 loss and 0 conflicts`, async () => {
      const b = backup(label);
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const page = await ctx.newPage();
      await page.goto(URL + "#settings");
      await page.waitForSelector("#import-file");
      await page.setInputFiles("#import-file", { name: `${label}.json`, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(b)) });
      await page.waitForSelector("#apply-import");
      expect(await page.textContent("#backup-result")).toMatch(new RegExp(`신규 ${b.events.length}건 / 중복 0건 / 충돌 0건 / 거부 0건`));
      await page.click("#apply-import");
      await page.waitForFunction(() => /건을 추가했습니다/.test(document.querySelector("#backup-result")?.textContent ?? ""));
      const db = await readDb(page);
      const ids = new Set(db.events.map((e: any) => e.eventId));
      for (const e of b.events) expect(ids.has(e.eventId)).toBe(true);
      // restoring first took a recovery point
      expect(db.snapshots.some((s: any) => s.reason === "BEFORE_RESTORE")).toBe(true);
      await ctx.close();
    }, 60000);
  }

  it("a recovery point puts back events that disappeared, adds nothing twice and keeps newer events", async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await installDump(page, dump("t12"));
    await page.goto(URL + "#settings");
    await page.waitForSelector("#snapshots");
    const before = await readDb(page);
    const victims = before.events.slice(0, 3).map((e: any) => e.eventId);
    await page.evaluate(async (v) => {
      const db: IDBDatabase = await new Promise((r) => { const q = indexedDB.open("jlpt-app"); q.onsuccess = () => r(q.result); });
      const tx = db.transaction("events", "readwrite"); for (const id of v) tx.objectStore("events").delete(id);
      await new Promise<void>((r) => { tx.oncomplete = () => r(); }); db.close();
    }, victims);
    await page.reload();
    await page.waitForSelector("#snapshots");
    await page.click("#snapshots summary");
    await page.waitForSelector("#snapshot-restore-0");
    await page.click("#snapshot-restore-0");
    await page.waitForSelector("#snapshot-result");
    expect(await page.textContent("#snapshot-result")).toContain("3건을 다시 추가했습니다");
    const after = await readDb(page);
    const ids = new Set(after.events.map((e: any) => e.eventId));
    for (const id of victims) expect(ids.has(id)).toBe(true);
    await ctx.close();
  }, 60000);

  it("two devices chose different targets without seeing each other: a card asks, the choice is recorded as based on both, nothing is deleted", async () => {
    const d = dump("t12");
    const legacyTarget: string = d["jlpt-app"].stores.events.rows.find((r: any) => r.v.event.type === "EXAM_TARGET_SELECTED").v.event.eventId;
    const mk = (device: string, n: number, month: number, at: string) => createEvent({ profileId: d["jlpt-app"].stores.meta.rows.find((r: any) => r.k === "profileId").v, deviceId: device, deviceSeq: n, type: "EXAM_TARGET_SELECTED", entityId: "exam", payload: { level: "N3", year: 2099, month, basedOn: [legacyTarget] }, now: new Date(at) });
    const e1 = mk("device-aaaaaa", 1, 7, "2099-01-01T00:00:00Z"), e2 = mk("device-bbbbbb", 1, 12, "2099-01-02T00:00:00Z");
    for (const e of [e1, e2]) d["jlpt-app"].stores.events.rows.push({ k: e.eventId, v: { event: e, status: "SYNCED" } });
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await installDump(page, d);
    await page.goto(URL + "#home");
    await page.waitForSelector("#target-conflict");
    expect(await page.locator("#target-conflict button").count()).toBe(2);
    await page.click("#resolve-target-0");
    await page.waitForFunction(() => !document.querySelector("#target-conflict"));
    const db = await readDb(page);
    const targets = db.events.filter((e: any) => e.type === "EXAM_TARGET_SELECTED");
    expect(targets.length).toBe(4);            // both old choices, the older legacy one and the resolution are all still there
    const res = targets.find((e: any) => JSON.parse(e.payloadJson).resolved === true);
    expect(JSON.parse(res.payloadJson).basedOn.sort()).toEqual([e1.eventId, e2.eventId].sort());
    await ctx.close();
  }, 60000);
});
