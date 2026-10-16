import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser, BrowserContext, Page } from "playwright-core";
import type { ChildProcess } from "node:child_process";
import seed from "../../app/seed/seed.jlptpack.json";
import { launch, startServer } from "./helpers";

const PORT = 18083;
const URL = `http://localhost:${PORT}/`;
let server: ChildProcess;
let browser: Browser;
beforeAll(async () => { server = await startServer(PORT); browser = await launch(); }, 30000);
afterAll(async () => { await browser?.close(); server?.kill(); });

// choice-set -> correct text, so a test can answer without the DOM revealing the key
const KEY = new Map<string, string>();
for (const r of seed.items as any[]) if (r.kind === "QUESTION") {
  const texts = r.payload.choices.map((c: any) => c.text).sort().join("|");
  KEY.set(texts, r.payload.choices.find((c: any) => c.id === r.payload.correctChoiceId).text);
}

async function answerOne(page: Page, mode: "correct" | "wrong"): Promise<void> {
  await page.waitForSelector(".choice");
  const texts = await page.$$eval(".choice .ctext", (els) => els.map((e) => e.textContent ?? ""));
  const correct = KEY.get([...texts].sort().join("|"))!;
  expect(correct, "question must be found in the seed").toBeTruthy();
  const idx = mode === "correct" ? texts.indexOf(correct) : texts.findIndex((t) => t !== correct);
  await page.locator(".choice").nth(idx).click();
  await page.click("#submit");
  await page.waitForSelector("#next");
  await page.click("#next");
}

async function newPage(ctx?: BrowserContext): Promise<{ page: Page; ctx: BrowserContext }> {
  const c = ctx ?? (await browser.newContext({ viewport: { width: 390, height: 844 } }));
  const page = await c.newPage();
  return { page, ctx: c };
}
const eventsOf = (page: Page) => page.evaluate(async () => {
  const db: IDBDatabase = await new Promise((r, j) => { const q = indexedDB.open("jlpt-app", 1); q.onsuccess = () => r(q.result); q.onerror = () => j(q.error); });
  const all: any[] = await new Promise((r) => { const q = db.transaction("events").objectStore("events").getAll(); q.onsuccess = () => r(q.result); });
  return all.map((x) => x.event as { type: string; payloadJson: string });
});

async function runDiagnostic(page: Page, pick: (i: number) => "correct" | "wrong"): Promise<void> {
  await page.goto(URL + "#home");
  await page.click("#start-diag");
  await page.click("#diag-go");
  for (let i = 0; i < 28; i++) await answerOne(page, pick(i));
  await page.waitForSelector("#route-label", { timeout: 10000 });
}

describe("T06 diagnostic, target and plan in a real browser", () => {
  it("TST-DIAG all correct -> TARGET_FOCUS; listening is not measured; plan excludes listening", async () => {
    const { page, ctx } = await newPage();
    await runDiagnostic(page, () => "correct");
    expect(await page.textContent("#route-label")).toBe("목표 등급 중심");
    expect(await page.textContent("body")).toContain("청해: 미측정");
    await page.click("#diag-home");
    await page.waitForSelector("#plan-list");
    const plan = await page.textContent("#plan-list");
    expect(plan).toContain("청해: 제외");
    expect(plan).not.toMatch(/청해: \d+분/);
    expect(await page.textContent("#brief")).toContain("시작 전 안내");
    expect(await page.textContent("#brief")).toContain("자동으로 넘어가지 않습니다");
    const evs = await eventsOf(page);
    const types = evs.map((e) => e.type);
    expect(types).toContain("DIAGNOSTIC_STARTED");
    expect(types).toContain("DIAGNOSTIC_COMPLETED");
    expect(types.filter((t) => t === "QUESTION_SUBMITTED").length).toBe(28);
    // each question exposed exactly once as DIAGNOSTIC
    const subs = evs.filter((e) => e.type === "QUESTION_SUBMITTED").map((e) => JSON.parse(e.payloadJson));
    expect(new Set(subs.map((s) => s.contentId)).size).toBe(28);
    expect(subs.every((s) => s.exposureType === "DIAGNOSTIC")).toBe(true);
    await ctx.close();
  }, 120000);

  it("kana mistakes route to KANA_FOUNDATION", async () => {
    const { page, ctx } = await newPage();
    await runDiagnostic(page, (i) => (i < 3 ? "wrong" : "correct")); // 3 wrong kana answers -> 5/8
    expect(await page.textContent("#route-label")).toBe("가나·기초부터");
    await ctx.close();
  }, 120000);

  it("TST-DIAG-02: leave mid-way, reload, resume exactly where it stopped without re-submitting", async () => {
    const { page, ctx } = await newPage();
    await page.goto(URL + "#home");
    await page.click("#start-diag");
    await page.click("#diag-go");
    for (let i = 0; i < 5; i++) await answerOne(page, "correct");
    expect(await page.textContent(".quiz-progress")).toBe("6 / 28");
    await page.reload(); // refresh in the middle of question 6
    await page.waitForSelector("#diag-go, #start-diag, .quiz-progress");
    await page.goto(URL + "#diag");
    await page.waitForSelector("#diag-go");
    expect(await page.textContent("body")).toContain("5 / 28 완료");
    await page.click("#diag-go");
    await page.waitForSelector(".quiz-progress");
    expect(await page.textContent(".quiz-progress")).toBe("6 / 28");
    await answerOne(page, "correct");
    const subs = (await eventsOf(page)).filter((e) => e.type === "QUESTION_SUBMITTED").map((e) => JSON.parse(e.payloadJson).contentId);
    expect(subs.length).toBe(6);
    expect(new Set(subs).size).toBe(6);
    await ctx.close();
  }, 120000);

  it("target: set, change, past-session guard, official date; nothing is deleted", async () => {
    const { page, ctx } = await newPage();
    await page.goto(URL + "#settings");
    await page.waitForSelector("#save-target");
    expect(await page.textContent("#target-current")).toContain("아직 설정되지 않았");
    await page.fill("#target-year", "2099"); await page.selectOption("#target-month", "7"); await page.click("#save-target");
    await page.waitForFunction(() => document.querySelector("#target-current")?.textContent?.includes("2099년 7월"));
    expect(await page.textContent("#target-current")).toMatch(/2099년 7월 \(예상 7월 5일 \/ 공식 미확정\)/);
    const before = (await eventsOf(page)).length;
    await page.fill("#target-year", "2099"); await page.selectOption("#target-month", "12"); await page.click("#save-target");
    await page.waitForFunction(() => document.querySelector("#target-current")?.textContent?.includes("2099년 12월"));
    expect((await eventsOf(page)).length).toBeGreaterThan(before); // history only grows
    await page.fill("#target-year", "2020"); await page.selectOption("#target-month", "7"); await page.click("#save-target");
    await page.waitForSelector("text=선택 회차가 이미 지났습니다");
    expect(await page.textContent("#target-current")).toContain("2099년 12월"); // unchanged
    await page.locator("details summary").click();
    await page.fill("#confirm-date", "2099-12-06"); await page.fill("#confirm-url", "http://example.com");
    await page.click("#save-confirm");
    await page.waitForSelector("text=공식 공고의 https 주소");
    await page.fill("#confirm-url", "https://www.jlpt.or.kr/");
    await page.click("#save-confirm");
    await page.waitForFunction(() => document.querySelector("#target-current")?.textContent?.includes("공식 12월 6일 확정"));
    await page.click("a[href='#home']");
    await page.waitForSelector("#target-text");
    expect(await page.textContent("#target-text")).toContain("공식 12월 6일 확정");
    await ctx.close();
  }, 60000);

  it("practice session exposes LEARN questions once, records study time, and returns home", async () => {
    const { page, ctx } = await newPage();
    await runDiagnostic(page, () => "correct");
    await page.click("#diag-home");
    await page.click("#start-study");
    await page.waitForSelector(".quiz-progress");
    const n = await page.textContent(".quiz-progress");
    expect(n).toMatch(/1 \/ \d+/);
    const total = Number(n!.split("/")[1]);
    for (let i = 0; i < total; i++) await answerOne(page, "correct");
    await page.waitForSelector("#plan-list, #sync-badge");
    const evs = await eventsOf(page);
    expect(evs.filter((e) => JSON.parse(e.payloadJson).exposureType === "PRACTICE" && e.type === "QUESTION_SUBMITTED").length).toBe(total);
    expect(evs.some((e) => e.type === "STUDY_INTERVAL_COMPLETED")).toBe(true);
    await page.goto(URL + "#home");
    await page.waitForSelector("#sync-badge");
    expect(await page.locator("#start-study").count()).toBe(0); // nothing left to practise: no fake "done" plan
    await ctx.close();
  }, 120000);

  it("every real diagnostic screen (incl. passages) fits one screen at 320x568 with the largest font", async () => {
    const ctx = await browser.newContext({ viewport: { width: 320, height: 568 } });
    await ctx.addInitScript(() => { try { localStorage.setItem("jlpt.settings.hint", JSON.stringify({ fontScale: "XL" })); } catch {} });
    const { page } = await newPage(ctx);
    await page.goto(URL + "#home");
    await page.click("#start-diag");
    await page.click("#diag-go");
    const check = async (label: string) => {
      const r = await page.evaluate(() => {
        const vh = innerHeight, vw = innerWidth, de = document.documentElement;
        const cs = [...document.querySelectorAll(".choice")].map((c) => c.getBoundingClientRect());
        const a = document.querySelector(".actions .primary")!.getBoundingClientRect();
        return { v: de.scrollHeight - vh, hs: de.scrollWidth - vw, n: cs.length, inside: cs.every((c) => c.top >= 0 && c.bottom <= vh + 0.5 && c.right <= vw + 0.5), act: a.bottom <= vh + 0.5 && a.top >= 0 };
      });
      expect(r, label).toMatchObject({ n: 4, inside: true, act: true });
      expect(r.v, label).toBeLessThanOrEqual(1);
      expect(r.hs, label).toBeLessThanOrEqual(1);
    };
    for (let i = 0; i < 28; i++) {
      await page.waitForSelector(".choice");
      await check(`Q${i + 1} question`);
      const texts = await page.$$eval(".choice .ctext", (els) => els.map((e) => e.textContent ?? ""));
      const correct = KEY.get([...texts].sort().join("|"))!;
      await page.locator(".choice").nth(texts.indexOf(correct)).click();
      await page.click("#submit");
      await page.waitForSelector("#next");
      await check(`Q${i + 1} feedback`);
      await page.click("#next");
    }
    await ctx.close();
  }, 240000);
});
