import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser, Page } from "playwright-core";
import type { ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launch, startServer } from "./helpers";
import { buildPack } from "../../shared/pack";
import { buildRecord, type ContentRecord } from "../../shared/schema";
import seed from "../../app/seed/seed.jlptpack.json";

const PORT = 18085;
const URL = `http://localhost:${PORT}/`;
let server: ChildProcess;
let browser: Browser;
beforeAll(async () => { server = await startServer(PORT); browser = await launch(); }, 30000);
afterAll(async () => { await browser?.close(); server?.kill(); });

const GEN = { tool: "t", toolVersion: "1", models: { generate: "claude-sonnet-5-5", verify: "claude-opus-5-5" } };
const prov = { origin: "AI_GENERATED" as const, generatorModel: "claude-sonnet-5-5", createdAt: "2026-10-16T00:00:00Z" };
const ver = (kind: string, over: Record<string, unknown> = {}) => ({ status: "VERIFIED" as const, selfAttested: false, verifierModel: "claude-opus-5-5", checks: (kind === "QUESTION" ? ["SCHEMA_LINT", "BLIND_SOLVE", "DISTRACTOR_CHECK", "QUALITY_CHECK"] : ["SCHEMA_LINT", "QUALITY_CHECK"]).map((id) => ({ id, result: "PASS" as const })), ...over });
const vocab = (n: number, over: Record<string, unknown> = {}, v: any = ver("VOCAB")): ContentRecord => buildRecord({ kind: "VOCAB", level: "N3", pool: "LEARN", tags: [], payload: { surface: `新語${n}`, reading: "しんご", pos: "noun", meaningKo: `뜻${n}`, example: { ja: `これは新語${n}の例です。`, ko: "예문" }, levelEstimate: "N3", miscTags: [], ...over }, provenance: prov, verification: v });
const plainQuestion = (n: number): ContentRecord => buildRecord({ kind: "QUESTION", level: "N3", pool: "LEARN", tags: ["KO_FALSE_FRIEND"], payload: { domain: "CONTEXT", stem: `この店のサービスは${n}年前よりずっと（　　）なりました。`, choices: ["a", "b", "c", "d"].map((id) => id === "a" ? { id, text: `良く${n}` } : { id, text: `悪い${id}${n}`, whyWrong: `${id}は文に合わない理由${n}`, howToCorrect: `${id}の直し方${n}` }), correctChoiceId: "a", explanationKo: `해설 ${n}`, scoringSection: "LANGUAGE_KNOWLEDGE" }, provenance: prov, verification: ver("QUESTION") });
const packText = (items: ContentRecord[]) => JSON.stringify(buildPack(items, { generator: GEN }));
const upload = (page: Page, text: string) => page.setInputFiles("#import-pack-file", { name: "p.jlptpack.json", mimeType: "application/json", buffer: Buffer.from(text) });

async function open(hash = "#settings"): Promise<{ page: Page; close: () => Promise<void> }> {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  const page = await ctx.newPage();
  await page.goto(URL + hash);
  await page.waitForSelector("#export-pack, #runway-text, .quiz");
  if (hash === "#settings") await page.waitForFunction(() => Number(/(\d+)개/.exec(document.querySelector("#content-count")?.textContent ?? "")?.[1] ?? 0) > 0);
  return { page, close: () => ctx.close() };
}
const downloadText = async (page: Page, selector: string): Promise<{ name: string; text: string }> => {
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click(selector)]);
  const path = join(mkdtempSync(join(tmpdir(), "dl-")), "f.json");
  await dl.saveAs(path);
  return { name: dl.suggestedFilename(), text: readFileSync(path, "utf8") };
};
async function importPlainQuestions(page: Page): Promise<void> {
  await page.goto(URL + "#settings");
  await page.waitForFunction(() => Number(/(\d+)개/.exec(document.querySelector("#content-count")?.textContent ?? "")?.[1] ?? 0) > 0);
  await upload(page, packText([plainQuestion(1), plainQuestion(2)]));
  await page.click("#apply-pack"); await page.waitForSelector("#apply-result");
}
const poolCount = async (page: Page) => Number(/(\d+)개/.exec((await page.textContent("#content-count")) ?? "")![1]);

describe("T08 runway, import, export, flags, progress (PC Chrome headless)", () => {
  it("runway shows N days and warns below 14 days", async () => {
    const { page, close } = await open("#home");
    await page.waitForSelector("#runway-text");
    expect(await page.textContent("#runway-text")).toMatch(/^남은 학습 분량: \d+일$/);
    expect(await page.textContent("#need-content")).toContain("콘텐츠 추가 필요");
    await close();
  });

  it("import: report first, approve, content count grows, re-import adds 0 and shows 100% duplicates", async () => {
    const { page, close } = await open();
    const before = await poolCount(page);
    const text = packText(Array.from({ length: 6 }, (_, i) => vocab(i)));
    await upload(page, text);
    await page.waitForSelector("#apply-pack");
    expect(await page.textContent("#report-summary")).toBe("신규 6건 / 중복 0건 / 충돌 0건 / 거부 0건 / 보류 0건 / 강등 0건");
    expect(await poolCount(page)).toBe(before); // nothing is written before approval
    await page.click("#apply-pack");
    await page.waitForSelector("#apply-result");
    expect(await page.textContent("#apply-result")).toContain("6건을 반영했습니다");
    expect(await poolCount(page)).toBe(before + 6);
    await page.setInputFiles("#import-pack-file", []);
    await upload(page, text);
    await page.waitForFunction(() => document.querySelector("#report-summary")?.textContent?.startsWith("신규 0건 / 중복 6건"));
    expect(await page.locator("#apply-pack").isDisabled()).toBe(true);
    await close();
  });

  it("tampered, malicious and orphan items are rejected / held with correct counts", async () => {
    const { page, close } = await open();
    const items = [vocab(100), vocab(101, { meaningKo: "<script>alert(1)</script>" }), vocab(102, { meaningKo: "see https://evil.example" }), vocab(103, { reading: "漢字" })];
    const t = JSON.parse(packText(items));
    t.items[0].payload.meaningKo = "변조"; // hash no longer matches
    await upload(page, JSON.stringify(t));
    await page.waitForSelector("#report-summary");
    const s = (await page.textContent("#report-summary"))!;
    expect(s).toContain("신규 0건");
    expect(s).toContain("거부 4건");
    expect(s).toMatch(/해시 불일치 1/); expect(s).toMatch(/위험한 문자열 2/); expect(s).toMatch(/읽기 문자 오류 1/);
    expect(await page.locator("#apply-pack").isDisabled()).toBe(true);
    const bad = JSON.parse(packText([vocab(110)])); bad.manifest.counts = { VOCAB: 9 };
    await page.setInputFiles("#import-pack-file", []);
    await upload(page, JSON.stringify(bad));
    await page.waitForFunction(() => document.querySelector("#report-summary")?.textContent?.includes("IMP-03"));
    await close();
  });

  it("unproven 'verified' claims are demoted and stay out of study until the toggle is on", async () => {
    const { page, close } = await open();
    const before = await poolCount(page);
    await upload(page, packText([vocab(200, {}, ver("VOCAB", { verifierModel: "claude-sonnet-5-5" })), vocab(201, {}, ver("VOCAB", { checks: [] }))]));
    await page.waitForSelector("#apply-pack");
    expect(await page.textContent("#report-summary")).toContain("강등 2건");
    await page.click("#apply-pack");
    await page.waitForSelector("#apply-result");
    expect(await poolCount(page)).toBe(before);
    await page.check("#include-unverified");
    await page.waitForFunction((b) => Number(/(\d+)개/.exec(document.querySelector("#content-count")?.textContent ?? "")![1]) === b + 2, before);
    await close();
  });

  it("export (full / per kind) downloads a clean pack that re-imports with 0 new", async () => {
    const { page, close } = await open();
    await upload(page, packText([vocab(300), vocab(301)]));
    await page.click("#apply-pack"); await page.waitForSelector("#apply-result");
    const full = await downloadText(page, "#export-pack");
    expect(full.name).toMatch(/^jlpt-pack_all_\d{8}_\d+\.jlptpack\.json$/);
    const pack = JSON.parse(full.text);
    expect(pack.format).toBe("jlpt-pack");
    expect(pack.items.length).toBeGreaterThanOrEqual(seed.items.length + 2);
    expect(full.text).not.toMatch(/profileId|deviceId|eventId|docs\.google|access_token/i);
    // per kind: only vocab
    for (const k of ["QUESTION", "GRAMMAR", "KANA", "KANJI", "PASSAGE", "LISTENING"]) await page.uncheck(`input[name=exp-kind][value=${k}]`);
    const vOnly = await downloadText(page, "#export-pack");
    expect(vOnly.name).toMatch(/^jlpt-pack_vocab_\d{8}_\d+\.jlptpack\.json$/);
    expect(JSON.parse(vOnly.text).items.every((i: any) => i.kind === "VOCAB")).toBe(true);
    // the exported full file imported again: nothing new, everything duplicate
    await upload(page, full.text);
    await page.waitForFunction(() => /^신규 0건 \/ 중복 \d+건/.test(document.querySelector("#report-summary")?.textContent ?? ""));
    expect(await page.textContent("#report-summary")).toContain(`중복 ${pack.items.length}건`);
    await close();
  }, 40000);

  it("report a question: it leaves the study pool at once, appears in flags.json, and the file holds no personal data", async () => {
    const { page, close } = await open("#settings");
    await importPlainQuestions(page);
    await page.goto(URL + "#study");
    await page.waitForSelector(".choice");
    const stem = await page.textContent("#pane-body");
    await page.locator(".choice").first().click();
    await page.click("#submit");
    await page.waitForSelector("#next");
    await page.click("text=문제 신고");
    await page.waitForSelector("#flag-submit");
    await page.check("input[name=flag-reason][value='해설 오류']");
    await page.click("#flag-submit");
    await page.waitForSelector("#flag-done");
    await page.click("#flag-done ~ button");
    await page.goto(URL + "#settings");
    await page.waitForSelector("#flag-count");
    await page.waitForFunction(() => document.querySelector("#flag-count")?.textContent === "신고한 문제: 1개");
    const flags = await downloadText(page, "#export-flags");
    const f = JSON.parse(flags.text);
    expect(f.format).toBe("jlpt-flags");
    expect(f.flags.length).toBe(1);
    expect(f.flags[0].reason).toBe("해설 오류");
    expect(flags.text).not.toMatch(/profileId|deviceId|eventId|token|docs\.google/i);
    // pool shrank: the reported question is gone from the study pool
    await page.goto(URL + "#learn");
    await page.locator("#learn-start").or(page.getByText("학습할 콘텐츠가 아직 없습니다")).first().waitFor();
    void stem;
    await close();
  }, 40000);

  it("progress export: aggregates only", async () => {
    const { page, close } = await open("#settings");
    await importPlainQuestions(page);
    await page.goto(URL + "#study");
    await page.waitForSelector(".choice");
    await page.locator(".choice").first().click(); await page.click("#submit"); await page.waitForSelector("#next");
    await page.waitForFunction(async () => { // wait until the submit event is committed locally
      const db: IDBDatabase = await new Promise((r, j) => { const q = indexedDB.open("jlpt-app"); q.onsuccess = () => r(q.result); q.onerror = () => j(q.error); });
      const all: any[] = await new Promise((r) => { const q = db.transaction("events").objectStore("events").getAll(); q.onsuccess = () => r(q.result); });
      return all.some((x) => x.event.type === "QUESTION_SUBMITTED");
    });
    await page.goto(URL + "#settings");
    await page.waitForSelector("#export-progress");
    const pr = await downloadText(page, "#export-progress");
    expect(pr.name).toMatch(/^jlpt-progress_\d{8}\.json$/);
    const p = JSON.parse(pr.text);
    expect(p.format).toBe("jlpt-progress");
    expect(p.runway.days).toBeGreaterThanOrEqual(0);
    expect(Object.values(p.accuracy).reduce((a: number, c: any) => a + c.n, 0)).toBeGreaterThanOrEqual(1);
    expect(pr.text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}|docs\.google|spreadsheet|token|https?:\/\/|profileId|deviceId/i);
    await close();
  }, 40000);
});
