import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser, BrowserContext, Page } from "playwright-core";
import type { ChildProcess } from "node:child_process";
import seed from "../../app/seed/seed.jlptpack.json";
import { launch, startServer } from "./helpers";

const PORT = 18086;
const URL = `http://localhost:${PORT}/`;
let server: ChildProcess;
let browser: Browser;
beforeAll(async () => { server = await startServer(PORT); browser = await launch(); }, 30000);
afterAll(async () => { await browser?.close(); server?.kill(); });

const VOCAB = (seed.items as any[]).filter((r) => r.kind === "VOCAB").map((r) => r.payload);
const QKEY = new Map<string, string>();
for (const r of seed.items as any[]) if (r.kind === "QUESTION") QKEY.set(r.payload.choices.map((c: any) => c.text).sort().join("|"), r.payload.choices.find((c: any) => c.id === r.payload.correctChoiceId).text);
function correctFor(stem: string, texts: string[]): string {
  const q = QKEY.get([...texts].sort().join("|")); if (q) return q;
  const reading = /^「(.+?)」の読み方/.exec(stem); if (reading) return VOCAB.find((v) => v.surface === reading[1]).reading;
  const meaning = /^「(.+?)」（.+?）の意味/.exec(stem); if (meaning) return VOCAB.find((v) => v.surface === meaning[1]).meaningKo;
  const gloss = /（([^（）]+)）\s*$/.exec(stem.trim()); return VOCAB.find((v) => v.meaningKo === gloss![1]).surface;
}
async function answer(page: Page, mode: "correct" | "wrong"): Promise<string> {
  await page.waitForSelector(".choice, #intro-go");
  if (await page.locator("#intro-go").count()) await page.click("#intro-go"); // new grammar point: read the principle first
  await page.waitForSelector(".choice");
  const texts = await page.$$eval(".choice .ctext", (e) => e.map((x) => x.textContent ?? ""));
  const stem = ((await page.textContent("#pane-body")) ?? "").trim();
  const ok = correctFor(stem, texts);
  await page.locator(".choice").nth(mode === "correct" ? texts.indexOf(ok) : texts.findIndex((t) => t !== ok)).click();
  await page.click("#submit"); await page.waitForSelector("#next"); await page.click("#next");
  return stem;
}
const events = (page: Page) => page.evaluate(async () => {
  const db: IDBDatabase = await new Promise((r, j) => { const q = indexedDB.open("jlpt-app"); q.onsuccess = () => r(q.result); q.onerror = () => j(q.error); });
  const all: any[] = await new Promise((r) => { const q = db.transaction("events").objectStore("events").getAll(); q.onsuccess = () => r(q.result); });
  return all.sort((a, b) => a.event.deviceSeq - b.event.deviceSeq).map((x) => ({ type: x.event.type as string, p: JSON.parse(x.event.payloadJson) }));
});
async function doneDiagnostic(ctx: BrowserContext): Promise<Page> {
  const page = await ctx.newPage();
  await page.goto(URL + "#diag"); await page.waitForSelector("#diag-go"); await page.click("#diag-go");
  for (let i = 0; i < 28; i++) await answer(page, "correct");
  await page.waitForSelector("#route-label");
  return page;
}

describe("T10 review engine in a real browser", () => {
  it("brief screen -> session with a same-session retry -> next day the missed card is due and shows as weak", async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await doneDiagnostic(ctx);
    await page.goto(URL + "#home");
    await page.waitForSelector("#start-review");
    expect(await page.textContent("#review-counts")).toContain("복습할 항목이 없습니다");

    // the briefing screen shows what / how many / how long / how it works BEFORE anything starts
    await page.click("#start-review");
    await page.waitForSelector("#brief-go");
    const brief = (await page.textContent("#brief-list"))!;
    expect(brief).toMatch(/무엇을: .+/); expect(brief).toMatch(/몇 개: 15개/); expect(brief).toMatch(/예상 소요: 약 \d+분/); expect(brief).toContain("다음 계속하기"); expect(brief).toContain("한 번 더 나오고");
    await page.click("#brief-go");
    await page.waitForSelector(".quiz-progress");
    expect(await page.textContent(".quiz-progress")).toBe("1 / 15");

    // answer the first card wrong: the same card comes back once, a few items later
    const firstStem = await answer(page, "wrong");
    expect(await page.textContent(".quiz-progress")).toBe("2 / 16");
    const stems: string[] = [];
    for (let i = 0; i < 4; i++) stems.push(await answer(page, "correct"));
    expect(stems.filter((s) => s === firstStem).length).toBe(1);
    // finish the rest (retry answered correctly when it comes)
    while ((await page.locator("#start-review, #sync-badge").count()) === 0) {
      if ((await page.locator(".choice").count()) === 0) break;
      await answer(page, "correct");
    }
    await page.waitForSelector("#sync-badge");
    const evs = await events(page);
    const cr = evs.filter((e) => e.type === "CARD_REVIEWED").map((e) => e.p);
    expect(cr.length).toBe(16);
    expect(cr.filter((p) => p.retry).length).toBe(1);
    expect(cr[0]).toMatchObject({ correct: false, retry: false });
    expect(cr.find((p) => p.retry)).toMatchObject({ correct: true });
    expect(evs.filter((e) => e.type === "STUDY_INTERVAL_COMPLETED").length).toBeGreaterThan(0);

    // same day: nothing more to review, no new cards beyond the cap
    expect(await page.locator("#start-review").count()).toBe(0);

    // tomorrow (dev clock): the missed card is due, the correct ones are due after 1 day too
    const tomorrow = await ctx.newPage();
    const t = new Date(Date.now() + 24 * 3600 * 1000 + 3600 * 1000).toISOString();
    await tomorrow.addInitScript((iso) => { (window as any).__JLPT_TEST_NOW__ = iso; }, t);
    await tomorrow.goto(URL + "#home");
    await tomorrow.waitForSelector("#start-review");
    expect(await tomorrow.textContent("#review-counts")).toMatch(/기한 도래 1[0-9]개/);
    expect(await tomorrow.textContent("#review-counts")).toMatch(/틀리기 쉬운 항목 [1-9]\d*개/);
    // distribution bar for 어휘·한자 exists with an accessible label
    const bar = await tomorrow.getAttribute("[data-area='어휘·한자'] .stagebar", "aria-label");
    expect(bar).toContain("학습 중");
    // weak review is reachable from the learn tab with its own briefing
    await tomorrow.goto(URL + "#learn");
    await tomorrow.waitForSelector("#start-weak");
    await tomorrow.click("#start-weak");
    await tomorrow.waitForSelector("#brief-go");
    expect(await tomorrow.textContent("h1")).toBe("약점 복습");
    await ctx.close();
  }, 120000);

  it("due cards come first and wrong answers drop a stage (state replay through the UI)", async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await doneDiagnostic(ctx);
    await page.goto(URL + "#review"); await page.click("#brief-go");
    for (let i = 0; i < 15; i++) await answer(page, "correct");
    await page.waitForSelector("#sync-badge");
    const day2 = await ctx.newPage();
    await day2.addInitScript((iso) => { (window as any).__JLPT_TEST_NOW__ = iso; }, new Date(Date.now() + 25 * 3600 * 1000).toISOString());
    await day2.goto(URL + "#review"); await day2.waitForSelector("#brief-go");
    expect(await day2.textContent("#brief-list")).toMatch(/기한 도래 15개/);
    await day2.click("#brief-go");
    await answer(day2, "wrong");
    for (let i = 0; i < 20; i++) { if ((await day2.locator(".choice").count()) === 0) break; await answer(day2, "correct"); }
    const evs = (await events(day2)).filter((e) => e.type === "CARD_REVIEWED").map((e) => e.p);
    expect(evs.length).toBeGreaterThanOrEqual(31);
    await ctx.close();
  }, 120000);
});
