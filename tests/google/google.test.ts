import { describe, expect, it } from "vitest";
import { parseSpreadsheetUrl } from "../../app/src/google/url";
import { GoogleError, MSG, mapHttpError } from "../../app/src/google/errors";
import { requestAccessToken } from "../../app/src/google/gis";
import { SheetsClient } from "../../app/src/google/sheets";
import { initialize, inspect, pullContent, rowToContent } from "../../app/src/google/init";
import { FakeSheets } from "./fakeSheets";
import { SEED_PACK } from "../../app/src/content/seed";
import { SHEET_HEADERS, SHEET_TABS } from "../../shared/sheetSchema";

const ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd";
const mk = (fake: FakeSheets, id = ID) => new SheetsClient(id, () => fake.validToken, fake.http);
const USER_TABS = { "Sales 2026": [["name", "amount"], ["a", 1], ["=1+1", "b"]], Notes: [["x"]] };

describe("URL parsing: only https://docs.google.com/spreadsheets/d/<id>", () => {
  const ok = [`https://docs.google.com/spreadsheets/d/${ID}/edit`, `https://docs.google.com/spreadsheets/d/${ID}/edit#gid=123`, `https://docs.google.com/spreadsheets/d/${ID}`, `  https://docs.google.com/spreadsheets/d/${ID}/edit?usp=sharing `, `https://docs.google.com/spreadsheets/d/${ID}/htmlview`];
  const bad = ["", "not a url", `http://docs.google.com/spreadsheets/d/${ID}/edit`, `https://evil.example/spreadsheets/d/${ID}/edit`, `https://docs.google.com.evil.com/spreadsheets/d/${ID}/edit`, `https://docs.google.com/document/d/${ID}/edit`, "https://docs.google.com/spreadsheets/d/short/edit", `https://docs.google.com/spreadsheets/u/0/`, `javascript:alert(1)`, `https://drive.google.com/file/d/${ID}/view`];
  it.each(ok)("accepts %s", (u) => expect(parseSpreadsheetUrl(u)?.spreadsheetId).toBe(ID));
  it.each(bad)("rejects %s", (u) => expect(parseSpreadsheetUrl(u)).toBeNull());
  it("gid is a tab id, never the spreadsheet id", () => {
    expect(parseSpreadsheetUrl(`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=987`)).toEqual({ spreadsheetId: ID, gid: 987 });
  });
});

describe("error matrix (plan.md §8.4) wording and mapping", () => {
  it("maps statuses to the exact user messages", () => {
    expect(mapHttpError(401, null, "read").message).toBe("Google 연결이 만료되었습니다. 다시 연결해 주세요.");
    expect(mapHttpError(403, { error: { status: "PERMISSION_DENIED", details: [{ reason: "SERVICE_DISABLED" }] } }, "write").message).toBe("이 계정에서는 필요한 Google Sheets 권한을 사용할 수 없습니다.");
    expect(mapHttpError(403, { error: { status: "PERMISSION_DENIED", message: "The caller does not have permission" } }, "write").message).toBe("이 스프레드시트에 앱 기록을 쓸 수 없습니다.");
    expect(mapHttpError(403, { error: { status: "PERMISSION_DENIED" } }, "read").code).toBe("NO_SCOPE");
    expect(mapHttpError(404, null, "read").message).toBe("시트를 찾지 못했거나 현재 계정에서 열 수 없습니다.");
    expect(mapHttpError(429, null, "write", 7000)).toMatchObject({ code: "RATE_LIMIT", message: "Google 요청 한도로 동기화가 지연되고 있습니다.", retryAfterMs: 7000 });
    expect(mapHttpError(503, null, "write").message).toBe("원격 저장 여부를 확인 중입니다.");
    expect(MSG.OFFLINE(3)).toBe("연결이 끊겼습니다. 3건이 기기에만 저장되어 있습니다.");
    expect(MSG.DECLINED).toBe("연결하지 않았습니다. 학습 내용은 아직 시트에 저장되지 않았습니다.");
    expect(MSG.BAD_URL).toBe("유효한 Google 스프레드시트 링크를 입력해 주세요.");
    expect(MSG.FOREIGN_TABS).toBe("기존 기록용 탭이 있어 자동 초기화할 수 없습니다.");
    expect(MSG.PROFILE_MISMATCH).toBe("다른 계정의 학습 기록이 연결되어 있습니다.");
    expect(MSG.NEW_SCHEMA).toBe("앱 데이터 버전을 확인할 수 없어 쓰기를 중단했습니다.");
    expect(MSG.GIS_FAILED).toBe("Google 로그인 창을 열 수 없습니다. 브라우저 설정과 연결 상태를 확인해 주세요.");
    expect(MSG.LOCAL_FILE).toBe("로컬 파일 모드에서는 Google 로그인을 지원하지 않습니다. Google Sheets 연결은 HTTPS 실행이 필요합니다.");
  });
});

describe("GIS token flow (fake SDK)", () => {
  const sdk = (behaviour: "ok" | "denied" | "popup_closed" | "popup_failed") => ({
    accounts: { oauth2: { initTokenClient: (c: any) => ({ requestAccessToken: () => {
      if (behaviour === "ok") c.callback({ access_token: "tok", expires_in: 3599 });
      else if (behaviour === "denied") c.callback({ error: "access_denied" });
      else c.error_callback({ type: behaviour });
    } }) } },
  });
  it("file:// never loads the SDK or touches the network", async () => {
    let loads = 0;
    await expect(requestAccessToken("cid", { protocol: "file:", loadScript: async () => { loads++; } })).rejects.toMatchObject({ code: "LOCAL_FILE", message: MSG.LOCAL_FILE });
    await expect(requestAccessToken("cid", { protocol: "content:", loadScript: async () => { loads++; } })).rejects.toMatchObject({ code: "LOCAL_FILE" });
    expect(loads).toBe(0);
  });
  it("https: loads the SDK on demand and returns an in-memory token", async () => {
    let loads = 0; let g: any;
    const r = await requestAccessToken("cid", { protocol: "https:", loadScript: async () => { loads++; g = sdk("ok"); }, google: () => g });
    expect(r.token).toBe("tok"); expect(loads).toBe(1);
    expect(r.expiresAt).toBeGreaterThan(Date.now());
  });
  it("declined / popup closed -> DECLINED message; popup failure and script failure -> GIS_FAILED", async () => {
    const run = (b: any) => requestAccessToken("cid", { protocol: "https:", google: () => sdk(b) as any });
    await expect(run("denied")).rejects.toMatchObject({ code: "DECLINED" });
    await expect(run("popup_closed")).rejects.toMatchObject({ code: "DECLINED", message: MSG.DECLINED });
    await expect(run("popup_failed")).rejects.toMatchObject({ code: "GIS_FAILED", message: MSG.GIS_FAILED });
    await expect(requestAccessToken("cid", { protocol: "https:", loadScript: async () => { throw new Error("blocked"); }, google: () => undefined })).rejects.toMatchObject({ code: "GIS_FAILED" });
  });
});

describe("non-destructive initialisation (FAKE Sheets API, not real Google)", () => {
  it("empty book: creates only _JLPT_ tabs, headers, META, seed rows; user tabs are byte-identical", async () => {
    const fake = new FakeSheets(); fake.addBook(ID, USER_TABS);
    const before = fake.snapshot(ID, Object.keys(USER_TABS));
    const c = mk(fake);
    const ins = await inspect(c);
    expect(ins.state).toBe("EMPTY");
    const r = await initialize(c, ins, { profileId: "p1", seed: SEED_PACK });
    expect(r.created.length).toBe(5);
    expect(r.contentAdded).toBe(SEED_PACK.items.length);
    expect(fake.snapshot(ID, Object.keys(USER_TABS))).toEqual(before);
    for (const [k, title] of Object.entries(SHEET_TABS)) expect(fake.tab(ID, title)!.rows[0]).toEqual([...SHEET_HEADERS[k as keyof typeof SHEET_HEADERS]]);
    const meta = new Map(fake.tab(ID, SHEET_TABS.META)!.rows.slice(1).map((r) => [r[0], JSON.parse(String(r[1]))]));
    expect(meta.get("schemaVersion")).toBe(1);
    expect(meta.get("ownerProfileId")).toBe("p1");
    expect(meta.get("activePackRevision")).toBe(SEED_PACK.manifest.manifestHash);
    expect(meta.get("contentRowCount")).toBe(SEED_PACK.items.length);
    expect((await inspect(c)).state).toBe("READY");
  });
  it("second run adds nothing (no duplicate tabs or seed rows)", async () => {
    const fake = new FakeSheets(); fake.addBook(ID, USER_TABS);
    const c = mk(fake);
    await initialize(c, await inspect(c), { profileId: "p1", seed: SEED_PACK });
    const rows = fake.tab(ID, SHEET_TABS.CONTENT)!.rows.length;
    const tabs = fake.books.get(ID)!.tabs.length;
    const r2 = await initialize(c, await inspect(c), { profileId: "p1", seed: SEED_PACK });
    expect(r2).toEqual({ created: [], contentAdded: 0 });
    expect(fake.tab(ID, SHEET_TABS.CONTENT)!.rows.length).toBe(rows);
    expect(fake.books.get(ID)!.tabs.length).toBe(tabs);
  });
  it("interrupted midway -> re-run completes only the missing steps, no duplicates, active revision written last", async () => {
    const fake = new FakeSheets(); fake.addBook(ID, USER_TABS);
    const c = mk(fake);
    fake.failures.push({ match: /CONTENT.*:append/, status: 503, times: 1 });
    await expect(initialize(c, await inspect(c), { profileId: "p1", seed: SEED_PACK })).rejects.toBeInstanceOf(GoogleError);
    const mid = new Map(fake.tab(ID, SHEET_TABS.META)!.rows.slice(1).map((r) => [r[0], r[1]]));
    expect(mid.has("activePackRevision")).toBe(false); // never exposed half-way
    const ins = await inspect(c);
    expect(["PARTIAL", "READY"]).toContain(ins.state);
    await initialize(c, ins, { profileId: "p1", seed: SEED_PACK });
    const ids = fake.tab(ID, SHEET_TABS.CONTENT)!.rows.slice(1).map((r) => `${r[0]}@${r[1]}`);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(SEED_PACK.items.length);
    expect((await inspect(c)).state).toBe("READY");
  });
  it("foreign _JLPT_ tab -> FOREIGN_TABS with zero writes", async () => {
    const fake = new FakeSheets(); fake.addBook(ID, { ...USER_TABS, _JLPT_META: [["a", "b"], ["x", "y"]] });
    const c = mk(fake);
    const ins = await inspect(c);
    expect(ins.state).toBe("FOREIGN");
    await expect(initialize(c, ins, { profileId: "p1", seed: SEED_PACK })).rejects.toMatchObject({ code: "FOREIGN_TABS", message: MSG.FOREIGN_TABS });
    expect(fake.writeCount).toBe(0);
  });
  it("newer schema -> read-only; other owner profile -> PROFILE_MISMATCH; both write nothing", async () => {
    const fake = new FakeSheets(); fake.addBook(ID, USER_TABS);
    const c = mk(fake);
    await initialize(c, await inspect(c), { profileId: "p1", seed: SEED_PACK });
    const before = fake.writeCount;
    await expect(initialize(c, await inspect(c), { profileId: "someone-else", seed: SEED_PACK })).rejects.toMatchObject({ code: "PROFILE_MISMATCH" });
    fake.tab(ID, SHEET_TABS.META)!.rows.push(["schemaVersion", "99", "t", "c"]);
    const ins = await inspect(c);
    expect(ins.state).toBe("NEW_SCHEMA");
    await expect(initialize(c, ins, { profileId: "p1", seed: SEED_PACK })).rejects.toMatchObject({ code: "NEW_SCHEMA" });
    expect(fake.writeCount).toBe(before);
  });
  it("RAW writes keep formula-looking strings as text", async () => {
    const fake = new FakeSheets(); fake.addBook(ID, USER_TABS);
    const c = mk(fake);
    await c.addTabs(["_JLPT_EVENTS"]);
    await c.appendRows("_JLPT_EVENTS", [["=HYPERLINK(\"http://x\")", "+1"]], 2);
    expect(fake.tab(ID, "_JLPT_EVENTS")!.rows[0]).toEqual(["=HYPERLINK(\"http://x\")", "+1"]);
  });
  it("read-only book: the first write fails as READ_ONLY and nothing else is touched", async () => {
    const fake = new FakeSheets(); fake.addBook(ID, USER_TABS, { readOnly: true });
    const c = mk(fake);
    await expect(initialize(c, await inspect(c), { profileId: "p1", seed: SEED_PACK })).rejects.toMatchObject({ code: "READ_ONLY", message: MSG.READ_ONLY });
    expect(fake.books.get(ID)!.tabs.length).toBe(2);
  });
  it("wrong / unreachable book and expired token", async () => {
    const fake = new FakeSheets(); fake.addBook(ID, USER_TABS);
    await expect(mk(fake, "nope_nope_nope_nope_nope_nope").getMeta()).rejects.toMatchObject({ code: "NOT_FOUND" });
    fake.validToken = "tok-2"; // the old token is now stale
    await expect(new SheetsClient(ID, () => "tok-1", fake.http).getMeta()).rejects.toMatchObject({ code: "NEEDS_AUTH", message: MSG.EXPIRED });
    await expect(new SheetsClient(ID, () => null, fake.http).getMeta()).rejects.toMatchObject({ code: "NEEDS_AUTH" });
  });
  it("only the user-supplied spreadsheet id is ever requested", async () => {
    const fake = new FakeSheets(); fake.addBook(ID, USER_TABS); fake.addBook("OTHER_BOOK_ID_0000000000000", { Secret: [["s"]] });
    const c = mk(fake);
    await initialize(c, await inspect(c), { profileId: "p1", seed: SEED_PACK });
    expect(fake.requests.every((r) => r.path.includes(`/spreadsheets/${ID}`))).toBe(true);
    expect(fake.books.get("OTHER_BOOK_ID_0000000000000")!.tabs.length).toBe(1);
  });
});

describe("incremental content loading (§4.7)", () => {
  it("reads 500 rows per request and only new rows on the next pull", async () => {
    const fake = new FakeSheets(); fake.addBook(ID, USER_TABS);
    const c = mk(fake);
    await initialize(c, await inspect(c), { profileId: "p1", seed: SEED_PACK });
    // grow the content tab to 1,100 rows with copies of a real row under new ids
    const tab = fake.tab(ID, SHEET_TABS.CONTENT)!;
    const proto = tab.rows[1]!;
    while (tab.rows.length - 1 < 1100) tab.rows.push([`vocab:synthetic${tab.rows.length}`, ...proto.slice(1)]);
    const before = fake.requests.length;
    const a = await pullContent(c, 0);
    expect(a.records.length + a.bad).toBe(1100);
    expect(a.nextCursor).toBe(1100);
    expect(fake.requests.length - before).toBe(3); // 500 + 500 + 100
    for (let i = 0; i < 5; i++) tab.rows.push([`vocab:new${i}`, ...proto.slice(1)]);
    const b = await pullContent(c, a.nextCursor);
    expect(b.records.length).toBe(5);
    expect(b.nextCursor).toBe(1105);
  });
  it("rows round-trip to identical records (hash included)", async () => {
    const fake = new FakeSheets(); fake.addBook(ID, USER_TABS);
    const c = mk(fake);
    await initialize(c, await inspect(c), { profileId: "p1", seed: SEED_PACK });
    const { records } = await pullContent(c, 0);
    const orig = new Map(SEED_PACK.items.map((r) => [r.contentId, r]));
    expect(records.length).toBe(SEED_PACK.items.length);
    for (const r of records) expect(JSON.stringify(sortKeys(r))).toBe(JSON.stringify(sortKeys(orig.get(r.contentId))));
    expect(rowToContent(["x"])).toBeNull();
  });
});
const sortKeys = (v: any): any => Array.isArray(v) ? v.map(sortKeys) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v;
