import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser, BrowserContext, Page } from "playwright-core";
import type { ChildProcess } from "node:child_process";
import { launch, startServer } from "./helpers";
import { buildPack } from "../../shared/pack";
import { buildRecord, type ContentRecord } from "../../shared/schema";

const PORT = 18091;
const URL = `http://localhost:${PORT}/`;
let server: ChildProcess;
let browser: Browser;
beforeAll(async () => { server = await startServer(PORT); browser = await launch(); }, 30000);
afterAll(async () => { await browser?.close(); server?.kill(); });

const prov = { origin: "AI_GENERATED" as const, generatorModel: "claude-sonnet-5-5", createdAt: "2026-10-16T00:00:00Z" };
const ver = (q: boolean) => ({ status: "VERIFIED" as const, selfAttested: false, verifierModel: "claude-opus-5-5", checks: (q ? ["SCHEMA_LINT", "BLIND_SOLVE", "DISTRACTOR_CHECK", "QUALITY_CHECK"] : ["SCHEMA_LINT", "QUALITY_CHECK"]).map((id) => ({ id, result: "PASS" as const })) });
const STEMS = ["駅から会社まで歩いて十分（　　）かかりません。", "このレポートは来週の月曜日（　　）に出してください。", "雨が降り（　　）なので、傘を持って行きます。", "先生は学生の質問に丁寧に答えて（　　）。"];
const q = (n: number, pool: "LEARN" | "ASSESS") => buildRecord({ kind: "QUESTION", level: "N3", pool, tags: [], payload: { domain: "GRAMMAR_FORM", stem: STEMS[n]!, scoringSection: "LANGUAGE_KNOWLEDGE", choices: ["a", "b", "c", "d"].map((id) => id === "a" ? { id, text: `正解${n}` } : { id, text: `誤り${id}${n}`, whyWrong: `${id}は文に合わない(${n})`, howToCorrect: `${id}を直す方法(${n})` }), correctChoiceId: "a", explanationKo: `해설 ${n}입니다.` }, provenance: prov, verification: ver(true) });
const FIX: ContentRecord[] = [q(0, "ASSESS"), q(1, "ASSESS"), q(2, "ASSESS"), q(3, "LEARN")];
const packJson = JSON.stringify(buildPack(FIX, { generator: { tool: "t", toolVersion: "1", models: {} } }));

async function open(ctx: BrowserContext): Promise<Page> {
  const page = await ctx.newPage();
  await page.goto(URL + "#settings");
  await page.waitForFunction(() => Number(/(\d+)개/.exec(document.querySelector("#content-count")?.textContent ?? "")?.[1] ?? 0) > 0);
  await page.setInputFiles("#import-pack-file", { name: "a.json", mimeType: "application/json", buffer: Buffer.from(packJson) });
  await page.click("#apply-pack"); await page.waitForSelector("#apply-result");
  return page;
}
const FORBIDDEN = /합격\s*(확률|가능성\s*\d|률)|예상\s*점수|과락\s*(확률|\d)/;

describe("T16 assessment, readiness and report (PC Chrome headless)", () => {
  it("ASSESS questions never appear in learning; the learning pool still works", async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await open(ctx);
    await page.goto(URL + "#study");
    await page.waitForSelector(".choice");
    const stem = (await page.textContent(".qline, #pane-body")) ?? "";
    expect(stem).toContain("先生は学生の質問");
    for (const s of STEMS.slice(0, 3)) expect(stem).not.toContain(s.slice(0, 8));
    await page.click(".quiz-head .ghost");
    await ctx.close();
  }, 60000);

  it("assessment menu -> set -> report: n<20 is 자료 부족, SVG charts, no probability text, listening has the TTS badge", async () => {
    const ctx = await browser.newContext({ viewport: { width: 320, height: 568 } });
    const page = await open(ctx);
    await page.goto(URL + "#learn");
    await page.click("#open-assess");
    await page.waitForSelector("#start-assess-LANGUAGE_KNOWLEDGE");
    expect(await page.textContent("body")).toContain("실전 제한시간 적응도: 미측정");
    expect(await page.locator("#start-assess-READING").count()).toBe(0);
    await page.click("#start-assess-LANGUAGE_KNOWLEDGE");
    for (let i = 0; i < 3; i++) {
      await page.waitForSelector(".choice");
      expect(await page.locator(".choice").count()).toBe(4);
      await page.locator(".choice").nth(i === 1 ? 1 : 0).click(); // one wrong answer
      await page.click("#submit"); await page.waitForSelector("#next"); await page.click("#next");
    }
    await page.waitForSelector("#study-summary");
    await page.waitForFunction(() => /맞은 수\/푼 수: \d \/ 3/.test(document.body.textContent ?? ""), null, { timeout: 5000 });
    expect(page.url()).toContain("#report");
    const body = (await page.textContent("body")) ?? "";
    expect(body).toContain("자료 부족");
    expect(body).toMatch(/맞은 수\/푼 수: \d \/ 3/);
    expect(body).not.toMatch(FORBIDDEN);
    expect(await page.locator("svg.chart").count()).toBeGreaterThanOrEqual(3);
    expect(await page.textContent("#tts-badge")).toBe("TTS 음원 기반");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    await page.evaluate(() => document.documentElement.style.setProperty("--fs", "24px")); // XL text on the narrowest phone
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    await page.evaluate(() => document.documentElement.style.removeProperty("--fs"));
    // the assessed questions are now used up
    await page.goto(URL + "#assess");
    await page.waitForSelector("h1");
    expect(await page.locator("#start-assess-LANGUAGE_KNOWLEDGE").count()).toBe(0);
    await ctx.close();
  }, 90000);

  it("recording an official result is stored as declared by the user and listed", async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await open(ctx);
    await page.goto(URL + "#report");
    await page.waitForSelector("#official-card");
    await page.click("#official-card summary");
    await page.fill("#off-year", "2026");
    await page.fill("#off-LANGUAGE_KNOWLEDGE", "40"); await page.fill("#off-READING", "35"); await page.fill("#off-LISTENING", "25");
    await page.selectOption("#off-pass", "yes");
    await page.click("#off-save");
    await page.waitForSelector("#off-list");
    expect(await page.textContent("#off-list")).toContain("직접 입력");
    await ctx.close();
  }, 60000);
});
