import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser, BrowserContext, Page } from "playwright-core";
import type { ChildProcess } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launch, startServer } from "./helpers";
import { buildPack } from "../../shared/pack";
import { buildRecord, type ContentRecord } from "../../shared/schema";
import { audioKeyFor, type Segment } from "../../shared/audio";
import { silentMp3 } from "../../tools/content/src/tts";

const PORT = 18089;
const URL = `http://localhost:${PORT}/`;
const audioDir = mkdtempSync(join(tmpdir(), "jlpt-audio-"));
let server: ChildProcess;
let browser: Browser;
beforeAll(async () => { process.env.AUDIO_DIR = audioDir; server = await startServer(PORT); browser = await launch(); }, 30000);
afterAll(async () => { await browser?.close(); server?.kill(); rmSync(audioDir, { recursive: true, force: true }); });

const prov = { origin: "AI_GENERATED" as const, generatorModel: "claude-sonnet-5-5", createdAt: "2026-10-16T00:00:00Z" };
const ver = (q: boolean) => ({ status: "VERIFIED" as const, selfAttested: false, verifierModel: "claude-opus-5-5", checks: (q ? ["SCHEMA_LINT", "BLIND_SOLVE", "DISTRACTOR_CHECK", "QUALITY_CHECK"] : ["SCHEMA_LINT", "QUALITY_CHECK"]).map((id) => ({ id, result: "PASS" as const })) });

function listening(tag: string, withFile: boolean): ContentRecord[] {
  const segments: Segment[] = withFile ? [{ speaker: "F", text: "すみません、駅はどこですか。", pauseMs: 300 }, { speaker: "M", text: "あの角を右です。" }] : [{ speaker: "M", text: "明日の会議は何時からでしたか。" }, { speaker: "F", text: "午後三時に変わりました。" }];
  const key = audioKeyFor(segments, "macos-say", "Kyoko", 1);
  if (withFile) { mkdirSync(audioDir, { recursive: true }); writeFileSync(join(audioDir, `${key}.mp3`), silentMp3(300)); }
  const q = buildRecord({ kind: "QUESTION", level: "N3", pool: "LEARN", tags: [], payload: { domain: "LISTENING_Q", stem: withFile ? "男の人は駅への行き方をどう言いましたか。" : "会議は何時になりましたか。", scoringSection: "LISTENING", choices: ["a", "b", "c", "d"].map((id) => id === "a" ? { id, text: "角を右" } : { id, text: `誤り${id}${tag}`, whyWrong: `${id}は男の人の発言と合わない(${tag})`, howToCorrect: `もう一度聞いて${id}を確認する(${tag})` }), correctChoiceId: "a", explanationKo: `${tag} 해설입니다.` }, provenance: prov, verification: ver(true) });
  const l = buildRecord({ kind: "LISTENING", level: "N3", pool: "LEARN", tags: [], payload: { taskType: "POINT", segments, questionId: q.contentId, audio: { key, source: "GENERATED_FILE", engine: "macos-say", voice: "Kyoko", speed: 1 } }, provenance: prov, verification: ver(false) });
  return [l, q];
}
const dict = buildRecord({ kind: "LISTENING", level: "N3", pool: "LEARN", tags: [], payload: { taskType: "UTTERANCE", dictation: true, segments: [{ speaker: "F", text: "図書館", reading: "としょかん" }] }, provenance: prov, verification: ver(false) });
const mk = (recs: ContentRecord[]) => JSON.stringify(buildPack(recs, { generator: { tool: "t", toolVersion: "1", models: {} } }));
const packWithFile = mk([...listening("甲", true), dict]);
const packMissing = mk(listening("乙", false));

async function openWithPack(ctx: BrowserContext, packJson = packWithFile): Promise<Page> {
  const page = await ctx.newPage();
  await page.goto(URL + "#settings");
  await page.waitForFunction(() => Number(/(\d+)개/.exec(document.querySelector("#content-count")?.textContent ?? "")?.[1] ?? 0) > 0);
  await page.setInputFiles("#import-pack-file", { name: "l.json", mimeType: "application/json", buffer: Buffer.from(packJson) });
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
  return { v: de.scrollHeight - vh, hs: de.scrollWidth - vw, n: cs.length, inside: cs.every((c) => c.top >= 0 && c.bottom <= vh + 0.5), act: a.bottom <= vh + 0.5 };
});

describe("T14 listening (PC Chrome headless, TTS files are local test fixtures)", () => {
  it("learn tab shows the TTS limit notice; audio panel replaces the passage; one screen at 320x568", async () => {
    const ctx = await browser.newContext({ viewport: { width: 320, height: 568 } });
    const page = await openWithPack(ctx);
    await page.goto(URL + "#learn");
    await page.waitForSelector("#start-listening");
    expect(await page.textContent("#listening-limit")).toContain("실제 시험 음성과");
    await page.click("#start-listening");
    await page.waitForSelector("#brief-go"); await page.click("#brief-go");
    await page.waitForSelector("#play-audio");
    expect(await page.locator(".choice").count()).toBe(4);
    expect(await page.textContent("#audio-source")).toContain("TTS 음원 파일");
    expect(await page.textContent("#tts-notice")).toContain("TTS 음원 기반");
    expect(await oneScreen(page)).toMatchObject({ v: 0, hs: 0, n: 4, inside: true, act: true });
    await ctx.close();
  }, 60000);

  it("plays the generated file (HEAD ok), records source and plays; answer needs manual next; script/replay in feedback", async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await openWithPack(ctx);
    await page.goto(URL + "#listening-run");
    await page.waitForSelector("#play-audio");
    const req = page.waitForRequest((r) => r.url().includes("/audio/") && r.url().endsWith(".mp3") && r.method() === "GET", { timeout: 5000 }).catch(() => null);
    await page.click("#play-audio");
    expect(await req).not.toBeNull();
    await page.waitForFunction(() => /재생 1/.test(document.querySelector("#audio-status")?.textContent ?? ""), null, { timeout: 5000 });
    await page.locator(".choice").first().click();
    await page.click("#submit"); await page.waitForSelector("#next");
    await page.waitForSelector("#toggle-passage");
    expect(await page.locator("#replay-audio").count()).toBe(1);
    await page.waitForFunction(async () => { const db: IDBDatabase = await new Promise((r) => { const q = indexedDB.open("jlpt-app"); q.onsuccess = () => r(q.result); }); const n: number = await new Promise((r) => { const q = db.transaction("events").objectStore("events").count(); q.onsuccess = () => r(q.result); }); return n >= 5; });
    const ev = (await events(page)).filter((e) => e.type === "QUESTION_SUBMITTED");
    expect(ev.length).toBe(1);
    expect(ev[0]!.p.audioSource).toBe("GENERATED_FILE");
    expect(ev[0]!.p.plays).toBeGreaterThanOrEqual(1);
    await ctx.close();
  }, 60000);

  it("missing audio file with browser voice off: clear error, plays stay 0, answer still possible", async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await openWithPack(ctx, packMissing);
    await page.goto(URL + "#settings");
    await page.waitForSelector("#tts-fallback");
    await page.uncheck("#tts-fallback");
    await page.goto(URL + "#listening-run"); await page.waitForSelector("#play-audio");
    await page.click("#play-audio");
    await page.waitForSelector("#audio-error");
    expect(await page.textContent("#audio-error")).toContain("음원");
    expect(await page.textContent("#audio-status")).toContain("재생 0");
    await page.locator(".choice").first().click(); await page.click("#submit"); await page.waitForSelector("#next");
    await ctx.close();
  }, 60000);

  it("dictation: write kana, diff on mistake, next is manual, event recorded", async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await openWithPack(ctx);
    await page.goto(URL + "#learn");
    await page.waitForSelector("#start-dictation");
    await page.goto(URL + "#dictation-run");
    await page.waitForSelector("#dictation-input");
    await page.fill("#dictation-input", "としょうかん");
    await page.click("#check");
    await page.waitForSelector("#dictation-feedback");
    expect(await page.textContent("#dictation-verdict")).toContain("틀렸");
    expect(await page.textContent("#dictation-expected")).toContain("としょかん");
    expect(await page.locator("#dictation-diff").count()).toBe(1);
    expect(await page.locator("#replay-dictation").count()).toBe(1);
    await page.click("#next");
    await page.waitForSelector(".done");
    const ev = (await events(page)).filter((e) => e.type === "QUESTION_SUBMITTED" && e.p.dictation);
    expect(ev.length).toBe(1);
    expect(ev[0]!.p.isCorrect).toBe(false);
    await ctx.close();
  }, 60000);
});
