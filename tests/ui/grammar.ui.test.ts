import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser, BrowserContext, Page } from "playwright-core";
import type { ChildProcess } from "node:child_process";
import seed from "../../app/seed/seed.jlptpack.json";
import { launch, startServer } from "./helpers";
import { buildPack } from "../../shared/pack";
import { buildRecord, type ContentRecord } from "../../shared/schema";

const PORT = 18087;
const URL = `http://localhost:${PORT}/`;
let server: ChildProcess;
let browser: Browser;
beforeAll(async () => { server = await startServer(PORT); browser = await launch(); }, 30000);
afterAll(async () => { await browser?.close(); server?.kill(); });

const items = seed.items as any[];
const QKEY = new Map<string, string>();
for (const r of items) if (r.kind === "QUESTION") QKEY.set(r.payload.choices.map((c: any) => c.text).sort().join("|"), r.payload.choices.find((c: any) => c.id === r.payload.correctChoiceId).text);
const VOCAB = items.filter((r) => r.kind === "VOCAB").map((r) => r.payload);
function correctFor(stem: string, texts: string[]): string {
  const q = QKEY.get([...texts].sort().join("|")); if (q) return q;
  const reading = /^「(.+?)」の読み方/.exec(stem); if (reading) return VOCAB.find((v) => v.surface === reading[1]).reading;
  const meaning = /^「(.+?)」（.+?）の意味/.exec(stem); if (meaning) return VOCAB.find((v) => v.surface === meaning[1]).meaningKo;
  return VOCAB.find((v) => v.meaningKo === /（([^（）]+)）\s*$/.exec(stem.trim())![1]).surface;
}
async function answer(page: Page, mode: "correct" | "wrong" = "correct"): Promise<void> {
  await page.waitForSelector(".choice, #intro-go");
  if (await page.locator("#intro-go").count()) await page.click("#intro-go");
  await page.waitForSelector(".choice");
  const texts = await page.$$eval(".choice .ctext", (e) => e.map((x) => x.textContent ?? ""));
  const ok = correctFor(((await page.textContent("#pane-body")) ?? "").trim(), texts);
  await page.locator(".choice").nth(mode === "correct" ? texts.indexOf(ok) : texts.findIndex((t) => t !== ok)).click();
  await page.click("#submit"); await page.waitForSelector("#next"); await page.click("#next");
}
const events = (page: Page) => page.evaluate(async () => {
  const db: IDBDatabase = await new Promise((r, j) => { const q = indexedDB.open("jlpt-app"); q.onsuccess = () => r(q.result); q.onerror = () => j(q.error); });
  const all: any[] = await new Promise((r) => { const q = db.transaction("events").objectStore("events").getAll(); q.onsuccess = () => r(q.result); });
  return all.sort((a, b) => a.event.deviceSeq - b.event.deviceSeq).map((x) => ({ type: x.event.type as string, p: JSON.parse(x.event.payloadJson) }));
});
async function diagnosed(ctx: BrowserContext): Promise<Page> {
  const page = await ctx.newPage();
  await page.goto(URL + "#diag"); await page.waitForSelector("#diag-go"); await page.click("#diag-go");
  for (let i = 0; i < 28; i++) await answer(page);
  await page.waitForSelector("#route-label");
  return page;
}

describe("T11 grammar principles and confusing letters (PC Chrome headless)", () => {
  it("learn tab -> grammar point explanation -> practice; every wrong choice shows its own reason and fix", async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto(URL + "#learn");
    await page.waitForSelector("#open-grammar");
    await page.click("#open-grammar");
    await page.waitForSelector("text=설명 보기");
    // open the points until one with practice questions is found (not every point has linked questions)
    const n = await page.locator("text=설명 보기").count();
    expect(n).toBe(4);
    for (let i = 0; i < n; i++) {
      await page.locator("text=설명 보기").nth(i).click();
      await page.waitForSelector("text=뉘앙스:");
      if (await page.locator("#practice-point").count()) break;
      await page.click("text=돌아가기");
      await page.waitForSelector("text=설명 보기");
    }
    const text = (await page.textContent("main"))!;
    for (const w of ["뜻:", "접속:", "뉘앙스:", "예문"]) expect(text).toContain(w);
    await page.click("#practice-point");
    await page.waitForSelector(".choice");
    // answer wrong, then inspect the three wrong choices one by one
    const texts = await page.$$eval(".choice .ctext", (e) => e.map((x) => x.textContent ?? ""));
    const ok = QKEY.get([...texts].sort().join("|"))!;
    await page.locator(".choice").nth(texts.findIndex((t) => t !== ok)).click();
    await page.click("#submit"); await page.waitForSelector("#next");
    const whys = new Set<string>();
    for (let i = 0; i < 4; i++) {
      if (texts[i] === ok) continue;
      await page.locator(".choice").nth(i).click();
      const pane = (await page.textContent("#pane-body"))!;
      expect(pane).toContain("왜 틀렸나"); expect(pane).toContain("고치려면");
      whys.add(pane);
    }
    expect(whys.size).toBe(3);
    await ctx.close();
  }, 60000);

  it("a new grammar point in the review session starts with its principle (no choices on that screen), then the question", async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await diagnosed(ctx);
    await page.goto(URL + "#review"); await page.click("#brief-go");
    await page.waitForSelector("#intro-go");
    expect(await page.locator(".choice").count()).toBe(0);
    const pane = (await page.textContent("#pane-body"))!;
    expect(pane).toContain("새 문법:"); expect(pane).toContain("뜻:");
    await page.click("#intro-go");
    await page.waitForSelector(".choice");
    expect(await page.locator(".choice").count()).toBe(4);
    // finish the session; grammar answers are card reviews of the point
    for (let i = 0; i < 40; i++) { if ((await page.locator(".choice, #intro-go").count()) === 0) break; await answer(page); }
    const evs = await events(page);
    const g = evs.filter((e) => e.type === "CARD_REVIEWED" && String(e.p.contentId).startsWith("gram:"));
    expect(g.length).toBeGreaterThanOrEqual(1);
    expect(evs.filter((e) => e.type === "QUESTION_SUBMITTED" && e.p.refId).length).toBeGreaterThanOrEqual(1); // the linked question is marked as seen
    await ctx.close();
  }, 120000);

  it("confusing-letter quiz is its own menu; it needs imported content and does not touch the review stages", async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
    const page = await ctx.newPage();
    await page.goto(URL + "#learn");
    await page.waitForSelector("text=혼동 글자 콘텐츠가 아직 없습니다");
    expect(await page.locator("#start-kana").count()).toBe(0);
    // import four confusing pairs
    const prov = { origin: "AI_GENERATED" as const, generatorModel: "claude-sonnet-5-5", createdAt: "2026-10-16T00:00:00Z" };
    const ver = { status: "VERIFIED" as const, selfAttested: false, verifierModel: "claude-opus-5-5", checks: ["SCHEMA_LINT", "QUALITY_CHECK"].map((id) => ({ id, result: "PASS" as const })) };
    const k = (a: string, b: string, ra: string, rb: string, note: string): ContentRecord => buildRecord({ kind: "KANA", level: "N5", pool: "LEARN", tags: [], payload: { chars: [a, b], readings: { [a]: ra, [b]: rb }, confusionNoteKo: note }, provenance: prov, verification: ver });
    const pack = buildPack([k("シ", "ツ", "시", "츠", "シ는 점이 옆으로, ツ는 위에서 아래로 찍힙니다."), k("ソ", "ン", "소", "응", "ソ는 위의 점이 길게 위로, ン은 아래에서 위로 올라갑니다."), k("ぬ", "め", "누", "메", "ぬ는 끝에 고리가 있습니다."), k("ね", "れ", "네", "레", "ね는 끝이 고리로 말립니다.")], { generator: { tool: "t", toolVersion: "1", models: {} } });
    await page.goto(URL + "#settings");
    await page.waitForFunction(() => Number(/(\d+)개/.exec(document.querySelector("#content-count")?.textContent ?? "")?.[1] ?? 0) > 0);
    await page.setInputFiles("#import-pack-file", { name: "kana.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(pack)) });
    await page.click("#apply-pack"); await page.waitForSelector("#apply-result");
    await page.goto(URL + "#learn");
    await page.waitForSelector("#start-kana");
    await page.click("#start-kana");
    await page.waitForSelector("#brief-go");
    expect(await page.textContent("h1")).toBe("혼동 글자");
    expect(await page.textContent("#brief-list")).toMatch(/몇 개: \d+개/);
    await page.click("#brief-go");
    await page.waitForSelector(".choice");
    expect(await page.locator(".choice").count()).toBe(4);
    // answer one wrong, look at the look-alike's explanation
    await page.locator(".choice").first().click();
    await page.click("#submit"); await page.waitForSelector("#next");
    for (let i = 0; i < 4; i++) {
      await page.locator(".choice").nth(i).click();
      const pane = (await page.textContent("#pane-body"))!;
      expect(pane.length).toBeGreaterThan(5);
    }
    await page.click("#next");
    await page.click(".quiz-head button"); // 나가기
    const evs = await events(page);
    expect(evs.some((e) => e.type === "QUESTION_SUBMITTED" && typeof e.p.kanaPair === "string")).toBe(true);
    expect(evs.filter((e) => e.type === "CARD_REVIEWED").length).toBe(0);
    await ctx.close();
  }, 60000);
});
