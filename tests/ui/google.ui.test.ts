import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser, BrowserContext } from "playwright-core";
import type { ChildProcess } from "node:child_process";
import { launch, startServer, fileUrl } from "./helpers";
import { FakeSheets } from "../google/fakeSheets";
import { SHEET_TABS } from "../../shared/sheetSchema";

// Everything Google here is a FAKE (stub GIS script + in-memory Sheets API behind Playwright routes).
// A pass proves the UI wiring only. It is NOT a real Google end-to-end test.
const PORT = 18084;
const URL = `http://localhost:${PORT}/`;
const ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd";
let server: ChildProcess;
let browser: Browser;
beforeAll(async () => { server = await startServer(PORT); browser = await launch(); }, 30000);
afterAll(async () => { await browser?.close(); server?.kill(); });

const GIS_STUB = `window.google={accounts:{oauth2:{initTokenClient:function(c){return{requestAccessToken:function(){setTimeout(function(){c.callback({access_token:'tok-1',expires_in:3599})},10)}}}}}};`;
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization,content-type", "access-control-allow-methods": "GET,POST,OPTIONS" };

async function fakeGoogle(ctx: BrowserContext, fake: FakeSheets, hits: { gis: number; other: string[] }) {
  await ctx.route("https://accounts.google.com/gsi/client", (r) => { hits.gis++; return r.fulfill({ status: 200, contentType: "text/javascript", body: GIS_STUB }); });
  await ctx.route("https://sheets.googleapis.com/**", async (r) => {
    const req = r.request();
    if (req.method() === "OPTIONS") return r.fulfill({ status: 204, headers: CORS });
    const res = await fake.http(req.url(), { method: req.method(), headers: req.headers(), body: req.postData() ?? undefined });
    return r.fulfill({ status: res.status, headers: { ...CORS, "content-type": "application/json" }, body: await res.text() });
  });
  ctx.on("request", (q) => { const u = q.url(); if (!u.startsWith(URL) && !u.startsWith("data:") && !u.includes("accounts.google.com") && !u.includes("sheets.googleapis.com")) hits.other.push(u); });
}

describe("settings > 시트 연결 (UI wiring against a FAKE Google)", () => {
  it("connect -> paste link -> approve init -> synced badge; user's own tab is untouched", async () => {
    const fake = new FakeSheets(); fake.addBook(ID, { "My Data": [["a", 1], ["=SUM(1,2)", "text"]] });
    const before = fake.snapshot(ID, ["My Data"]);
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.addInitScript(() => { (window as any).__JLPT_TEST_CLIENT_ID__ = "test-client"; });
    const hits = { gis: 0, other: [] as string[] };
    await fakeGoogle(ctx, fake, hits);
    const page = await ctx.newPage();
    await page.goto(URL + "#settings");
    await page.waitForSelector("#gconnect");
    expect(hits.gis).toBe(0); // the SDK is not loaded before the click
    await page.click("#gconnect");
    await page.waitForSelector("#sheet-url");
    expect(hits.gis).toBe(1);
    await page.fill("#sheet-url", "https://example.com/not-a-sheet");
    await page.click("#sheet-check");
    await page.waitForSelector("text=유효한 Google 스프레드시트 링크를 입력해 주세요.");
    expect(fake.requests.length).toBe(0);
    await page.click("#gretry");
    await page.waitForSelector("#sheet-url");
    await page.fill("#sheet-url", `https://docs.google.com/spreadsheets/d/${ID}/edit#gid=0`);
    await page.click("#sheet-check");
    await page.waitForSelector("text=이 시트에 _JLPT_* 전용 탭을 생성합니다. 기존 탭은 수정하지 않습니다.");
    expect(fake.writeCount).toBe(0);
    await page.click("#init-approve");
    await page.waitForSelector("#conn-ready");
    expect(fake.snapshot(ID, ["My Data"])).toEqual(before);
    expect(fake.tab(ID, SHEET_TABS.CONTENT)!.rows.length).toBeGreaterThan(40);
    await page.goto(URL + "#home");
    await page.waitForFunction(() => document.querySelector("#sync-badge")?.textContent === "동기화 완료", null, { timeout: 15000 });
    expect(fake.tab(ID, SHEET_TABS.EVENTS)!.rows.length).toBeGreaterThan(1);
    expect(hits.other).toEqual([]); // nothing but our own origin, the (fake) GIS script and the Sheets API
    await ctx.close();
  }, 60000);

  it("expired token: badge says 다시 연결 필요, the events stay on the device, 다시 연결 resumes", async () => {
    const fake = new FakeSheets(); fake.addBook(ID, { Sheet1: [] });
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.addInitScript(() => { (window as any).__JLPT_TEST_CLIENT_ID__ = "test-client"; });
    await fakeGoogle(ctx, fake, { gis: 0, other: [] });
    const page = await ctx.newPage();
    await page.goto(URL + "#settings");
    await page.click("#gconnect"); await page.fill("#sheet-url", `https://docs.google.com/spreadsheets/d/${ID}/edit`);
    await page.click("#sheet-check"); await page.click("#init-approve"); await page.waitForSelector("#conn-ready");
    fake.validToken = "tok-rotated";
    await page.getByLabel("크게", { exact: true }).check(); // creates a SETTINGS_UPDATED event
    await page.click("#sync-now-2");
    await page.goto(URL + "#home");
    await page.waitForFunction(() => document.querySelector("#sync-badge")?.textContent === "다시 연결 필요");
    expect(await page.textContent("body")).toContain("Google 연결이 만료되었습니다. 다시 연결해 주세요.");
    fake.validToken = "tok-1"; // the stub hands out tok-1 again
    await page.click("#reconnect");
    await page.waitForFunction(() => document.querySelector("#sync-badge")?.textContent === "동기화 완료", null, { timeout: 15000 });
    await ctx.close();
  }, 60000);

  it("file:// shows the exact notice, no connect button, and never requests Google", async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const reqs: string[] = [];
    ctx.on("request", (q) => reqs.push(q.url()));
    const page = await ctx.newPage();
    await page.goto(fileUrl() + "#settings");
    await page.waitForSelector(".tabbar");
    expect(await page.textContent("body")).toContain("로컬 파일 모드에서는 Google 로그인을 지원하지 않습니다. Google Sheets 연결은 HTTPS 실행이 필요합니다.");
    expect(await page.locator("#gconnect").count()).toBe(0);
    expect(reqs.filter((u) => /google/.test(u))).toEqual([]);
    await ctx.close();
  });

  it("no client id in the build: honest notice instead of a dead button", async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto(URL + "#settings");
    await page.waitForSelector("#conn-body");
    expect(await page.textContent("#conn-body")).toContain("Google Client ID가 이 빌드에 설정되어 있지 않습니다");
    expect(await page.locator("#gconnect").count()).toBe(0);
    await ctx.close();
  });
});
