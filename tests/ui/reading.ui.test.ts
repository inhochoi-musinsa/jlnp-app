import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser, BrowserContext, Page } from "playwright-core";
import type { ChildProcess } from "node:child_process";
import { launch, startServer } from "./helpers";
import { buildPack } from "../../shared/pack";
import { buildRecord, type ContentRecord } from "../../shared/schema";
import { makeContentId } from "../../shared/normalize";

const PORT = 18088;
const URL = `http://localhost:${PORT}/`;
let server: ChildProcess;
let browser: Browser;
beforeAll(async () => { server = await startServer(PORT); browser = await launch(); }, 30000);
afterAll(async () => { await browser?.close(); server?.kill(); });

const prov = { origin: "AI_GENERATED" as const, generatorModel: "claude-sonnet-5-5", createdAt: "2026-10-16T00:00:00Z" };
const ver = (kind: string) => ({ status: "VERIFIED" as const, selfAttested: false, verifierModel: "claude-opus-5-5", checks: (kind === "QUESTION" ? ["SCHEMA_LINT", "BLIND_SOLVE", "DISTRACTOR_CHECK", "QUALITY_CHECK"] : ["SCHEMA_LINT", "QUALITY_CHECK"]).map((id) => ({ id, result: "PASS" as const })) });

const sentence = (n: number, k: number) => `第${n}ページの${k}番目の文です。町の図書館では、毎週土曜日に子ども向けの読み聞かせ会が開かれ、多くの家族が参加しています。`;
function passage(tag: string, type: "SHORT" | "MEDIUM" | "LONG" | "INFO", nPages: number, nQ: number): ContentRecord[] {
  const pages = Array.from({ length: nPages }, (_, p) => [1, 2].map((k) => sentence(p + 1, k)).join("") + tag);
  const pid = makeContentId("PASSAGE", { pages });
  const qs = Array.from({ length: nQ }, (_, i) => buildRecord({ kind: "QUESTION", level: "N3", pool: "LEARN", tags: ["KO_FALSE_FRIEND"], payload: {
    domain: "READING_Q", stem: `${tag}の文章について、正しいものはどれですか。（問${i + 1}）`, stimulusId: pid, scoringSection: "READING",
    choices: ["a", "b", "c", "d"].map((id) => id === "a" ? { id, text: `${tag}${i}の正解` } : { id, text: `${tag}${i}の誤り${id}`, whyWrong: `${id}は本文と合わない(${tag}${i})`, howToCorrect: `本文の第${i + 1}段落を確認する(${id})` }), correctChoiceId: "a", explanationKo: `${tag} ${i} 근거는 본문 ${nPages}쪽 중에 있습니다.` }, provenance: prov, verification: ver("QUESTION") }));
  const p = buildRecord({ kind: "PASSAGE", level: "N3", pool: "LEARN", tags: [], payload: { type, pages, questionIds: qs.map((q) => q.contentId) }, provenance: prov, verification: ver("PASSAGE") });
  return [p, ...qs];
}
const FIX = [...passage("甲", "SHORT", 1, 2), ...passage("乙", "LONG", 5, 3), ...passage("丙", "INFO", 3, 3)];
const packJson = JSON.stringify(buildPack(FIX, { generator: { tool: "t", toolVersion: "1", models: {} } }));

async function openWithPack(ctx: BrowserContext): Promise<Page> {
  const page = await ctx.newPage();
  await page.goto(URL + "#settings");
  await page.waitForFunction(() => Number(/(\d+)개/.exec(document.querySelector("#content-count")?.textContent ?? "")?.[1] ?? 0) > 0);
  await page.setInputFiles("#import-pack-file", { name: "reading.json", mimeType: "application/json", buffer: Buffer.from(packJson) });
  await page.click("#apply-pack"); await page.waitForSelector("#apply-result");
  return page;
}
const events = (page: Page) => page.evaluate(async () => {
  const db: IDBDatabase = await new Promise((r, j) => { const q = indexedDB.open("jlpt-app"); q.onsuccess = () => r(q.result); q.onerror = () => j(q.error); });
  const all: any[] = await new Promise((r) => { const q = db.transaction("events").objectStore("events").getAll(); q.onsuccess = () => r(q.result); });
  return all.sort((a, b) => a.event.deviceSeq - b.event.deviceSeq).map((x) => ({ type: x.event.type as string, p: JSON.parse(x.event.payloadJson) }));
});
const oneScreen = (page: Page) => page.evaluate(() => {
  const vh = innerHeight, vw = innerWidth, de = document.documentElement;
  const cs = [...document.querySelectorAll(".choice")].map((c) => c.getBoundingClientRect());
  const a = document.querySelector(".actions .primary")!.getBoundingClientRect();
  const q = document.querySelector("#qline")?.getBoundingClientRect();
  return { v: de.scrollHeight - vh, hs: de.scrollWidth - vw, n: cs.length, inside: cs.every((c) => c.top >= 0 && c.bottom <= vh + 0.5 && c.right <= vw + 0.5), act: a.bottom <= vh + 0.5 && a.top >= 0, q: !q || (q.top >= 0 && q.bottom <= vh), fonts: [...new Set([...document.querySelectorAll(".choice")].map((c) => getComputedStyle(c).fontSize))] };
});

describe("T13 reading (PC Chrome headless)", () => {
  it("learn tab offers the next passage; brief, paged passage with a pinned question line, 4 fixed choices", async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await openWithPack(ctx);
    await page.goto(URL + "#learn");
    await page.waitForSelector("#start-reading");
    expect(await page.textContent("body")).toContain("다음 지문:");
    await page.click("#start-reading");
    await page.waitForSelector("#brief-go");
    expect(await page.textContent("h1")).toBe("독해");
    expect(await page.textContent("#brief-list")).toMatch(/몇 개: \d+개/);
    await page.click("#brief-go");
    await page.waitForSelector(".choice");
    expect(await page.locator("#qline").count()).toBe(1);
    expect(await page.locator(".choice").count()).toBe(4);
    await ctx.close();
  }, 60000);

  it("a LONG passage keeps its own page breaks; paging works; question and choices never move", async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await openWithPack(ctx);
    let seen5 = false;
    for (let day = 0; day < 3 && !seen5; day++) { // one new passage per (test) day: walk through them until the 5-page one
      const page = await ctx.newPage();
      await page.addInitScript((iso) => { (window as any).__JLPT_TEST_NOW__ = iso; }, new Date(Date.now() + day * 26 * 3600 * 1000).toISOString());
      await page.goto(URL + "#reading"); await page.waitForSelector("#brief-go"); await page.click("#brief-go"); await page.waitForSelector(".choice");
      if ((await page.textContent("#pager"))?.includes("/ 5")) {
        seen5 = true;
        const first = await page.textContent("#pane-body");
        const qline = await page.textContent("#qline");
        const choicesBefore = await page.$$eval(".choice", (e) => e.map((x) => x.textContent));
        await page.click("#pager button >> nth=1");
        expect(await page.textContent("#pager")).toContain("2 / 5");
        expect(await page.textContent("#pane-body")).not.toBe(first);
        expect(await page.textContent("#pane-body")).toContain("第2ページ"); // content page 2 starts its own pane page
        expect(await page.textContent("#qline")).toBe(qline);
        expect(await page.$$eval(".choice", (e) => e.map((x) => x.textContent))).toEqual(choicesBefore);
        await page.click("#pager button >> nth=0");
        expect(await page.textContent("#pane-body")).toBe(first);
      }
      await page.close();
    }
    expect(seen5, "the 5-page passage must have been reached").toBe(true);
    await ctx.close();
  }, 60000);

  it("feedback keeps the question line and the 4 choices; [지문 보기] toggles back to the passage", async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await openWithPack(ctx);
    await page.goto(URL + "#reading"); await page.waitForSelector("#brief-go"); await page.click("#brief-go"); await page.waitForSelector(".choice");
    const q = await page.textContent("#qline");
    await page.locator(".choice").nth(1).click(); await page.click("#submit"); await page.waitForSelector("#next");
    expect(await page.textContent("#qline")).toBe(q);
    expect(await page.locator(".choice").count()).toBe(4);
    expect(await page.textContent("#pane-body")).toMatch(/正解|오답|해설|근거/);
    await page.click("#toggle-passage");
    expect(await page.textContent("#pane-body")).toContain("ページの");
    expect(await page.textContent("#toggle-passage")).toBe("해설 보기");
    await page.click("#toggle-passage");
    expect(await page.textContent("#toggle-passage")).toBe("지문 보기");
    await ctx.close();
  }, 60000);

  it("every viewport x font size: question and feedback fit one screen for SHORT, LONG (5 pages) and INFO passages", async () => {
    const VP = [{ width: 320, height: 568 }, { width: 360, height: 640 }, { width: 390, height: 844 }];
    for (const vp of VP) for (const sc of ["S", "M", "L", "XL"]) {
      const ctx = await browser.newContext({ viewport: vp });
      await ctx.addInitScript((s) => { try { localStorage.setItem("jlpt.settings.hint", JSON.stringify({ fontScale: s })); } catch {} }, sc);
      const page = await openWithPack(ctx);
      for (let day = 0; day < 3; day++) {
        // each passage on its own (test) day because the intake is one new passage per day
        const p2 = await ctx.newPage();
        const t = new Date(Date.now() + day * 26 * 3600 * 1000).toISOString();
        await p2.addInitScript((iso) => { (window as any).__JLPT_TEST_NOW__ = iso; }, t);
        await p2.goto(URL + "#reading"); await p2.waitForSelector("#brief-go"); await p2.click("#brief-go");
        for (let q = 0; q < 3; q++) {
          if ((await p2.locator(".choice").count()) === 0) break;
          const a = await oneScreen(p2);
          expect(a, `${vp.width}x${vp.height} ${sc} day${day} q${q} question`).toMatchObject({ n: 4, inside: true, act: true, q: true });
          expect(a.v).toBeLessThanOrEqual(1); expect(a.hs).toBeLessThanOrEqual(1);
          await p2.locator(".choice").nth(1).click(); await p2.click("#submit"); await p2.waitForSelector("#next");
          const b = await oneScreen(p2);
          expect(b, `${vp.width}x${vp.height} ${sc} day${day} q${q} feedback`).toMatchObject({ n: 4, inside: true, act: true, q: true });
          expect(b.fonts).toEqual(a.fonts);
          await p2.click("#toggle-passage"); // passage view in feedback must fit as well
          expect(await oneScreen(p2), "passage view in feedback").toMatchObject({ n: 4, inside: true, act: true, q: true });
          await p2.click("#next");
        }
        await p2.close();
      }
      await page.close(); await ctx.close();
    }
  }, 280000);

  it("records stimulusId exposure, allows one new passage per day, and counts reading accuracy", async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
    const page = await openWithPack(ctx);
    await page.goto(URL + "#reading"); await page.waitForSelector("#brief-go"); await page.click("#brief-go"); await page.waitForSelector(".choice");
    let n = 0;
    while ((await page.locator(".choice").count()) > 0) { await page.locator(".choice").first().click(); await page.click("#submit"); await page.waitForSelector("#next"); await page.click("#next"); n++; if (n > 6) break; await page.waitForSelector(".choice, #sync-badge, .done"); }
    expect(n).toBeGreaterThanOrEqual(2);
    const evs = await events(page);
    const shown = evs.filter((e) => e.type === "QUESTION_PRESENTED");
    expect(shown.length).toBe(n);
    expect(shown.every((e) => typeof e.p.stimulusId === "string" && e.p.stimulusId.startsWith("pass:"))).toBe(true);
    expect(new Set(shown.map((e) => e.p.stimulusId)).size).toBe(1);
    // same day: no second new passage
    await page.goto(URL + "#learn");
    await page.waitForFunction(() => document.body.textContent?.includes("오늘의 새 지문은 이미 읽었습니다."));
    expect(await page.locator("#start-reading").count()).toBe(0);
    await ctx.close();
  }, 60000);
});
