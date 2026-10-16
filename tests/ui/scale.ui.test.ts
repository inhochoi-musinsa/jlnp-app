import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser } from "playwright-core";
import type { ChildProcess } from "node:child_process";
import { launch, startServer } from "./helpers";

const PORT = 18092;
const URL = `http://localhost:${PORT}/`;
let server: ChildProcess;
let browser: Browser;
beforeAll(async () => { server = await startServer(PORT); browser = await launch(); }, 30000);
afterAll(async () => { await browser?.close(); server?.kill(); });

/** Writes N synthetic events straight into the app's IndexedDB (same shape the app stores), in batches. */
async function seedEvents(page: import("playwright-core").Page, n: number): Promise<void> {
  await page.evaluate(async (count) => {
    const db: IDBDatabase = await new Promise((r, j) => { const q = indexedDB.open("jlpt-app"); q.onsuccess = () => r(q.result); q.onerror = () => j(q.error); });
    const t0 = Date.parse("2026-10-01T00:00:00Z");
    const profile: string = await new Promise((r) => { const q = db.transaction("meta").objectStore("meta").get("profileId"); q.onsuccess = () => r(q.result); });
    const start: number = (await new Promise<number>((r) => { const q = db.transaction("meta").objectStore("meta").get("deviceSeq"); q.onsuccess = () => r(Number(q.result) || 0); })) + 1;
    for (let b = 0; b < count; b += 5000) {
      const tx = db.transaction("events", "readwrite");
      const st = tx.objectStore("events");
      for (let i = b; i < Math.min(count, b + 5000); i++) {
        const day = new Date(t0 + i * 20000).toISOString().slice(0, 10);
        const k = i % 3;
        const type = k === 0 ? "QUESTION_PRESENTED" : k === 1 ? "QUESTION_SUBMITTED" : "STUDY_INTERVAL_COMPLETED";
        const payload = k === 0 ? { contentId: `q:fake${i % 500}`, exposureType: "PRACTICE", stimulusId: null } : k === 1 ? { contentId: `q:fake${i % 500}`, exposureType: "PRACTICE", isCorrect: i % 3 !== 0, order: ["a", "b", "c", "d"], elapsedActiveMs: 9000 } : { dayKey: day, activity: "STUDY", seconds: 60 };
        st.put({ event: { eventId: `bulk-${i}`, profileId: profile, deviceId: "bulk", deviceSeq: start + i, occurredAt: new Date(t0 + i * 20000).toISOString(), type, entityId: "x", eventSchemaVersion: 1, payloadJson: JSON.stringify(payload), checksum: "bulk" }, status: "ACKED" });
      }
      await new Promise<void>((r) => { tx.oncomplete = () => r(); });
    }
    db.close();
  }, n);
}

describe("T17 large local data (PC Chrome headless)", () => {
  for (const n of [20000, 100000]) {
    it(`boots and stays usable with ${n} stored events`, async () => {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const page = await ctx.newPage();
      await page.goto(URL + "#home");
      await page.waitForSelector("#runway-text");
      await seedEvents(page, n);
      const t = Date.now();
      await page.reload();
      await page.waitForSelector("#runway-text", { timeout: 60000 });
      const bootMs = Date.now() - t;
      const report = Date.now();
      await page.goto(URL + "#report");
      await page.waitForSelector("#study-summary", { timeout: 60000 });
      console.log(`events=${n} boot=${bootMs}ms report=${Date.now() - report}ms`);
      expect(bootMs).toBeLessThan(15000);
      expect(await page.textContent("#study-summary")).toMatch(/합계 \d+분/);
      await ctx.close();
    }, 180000);
  }
});
