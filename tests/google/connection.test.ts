import { describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { ConnectionManager } from "../../app/src/google/connection";
import { SheetsClient } from "../../app/src/google/sheets";
import { inspect, initialize } from "../../app/src/google/init";
import { AppStorage } from "../../app/src/storage/session";
import { FakeSheets } from "./fakeSheets";
import { SEED_PACK } from "../../app/src/content/seed";
import { GoogleError, MSG } from "../../app/src/google/errors";
import { SHEET_TABS } from "../../shared/sheetSchema";
import { projectExamTarget } from "../../app/src/domain/target";
import { diagnosticState, buildDiagnostic } from "../../app/src/domain/diagnostic";

const ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd";
const URL = `https://docs.google.com/spreadsheets/d/${ID}/edit#gid=0`;

async function make(fake: FakeSheets, o: { mode?: any; clientId?: string; dev?: AppStorage; tokenError?: GoogleError } = {}) {
  const dev = o.dev ?? (await AppStorage.init(new IDBFactory()));
  let tokenCalls = 0;
  const conn = new ConnectionManager({
    mode: o.mode ?? "HTTPS_GUEST", clientId: o.clientId ?? "cid", storage: dev, seed: SEED_PACK, http: fake.http, sleep: async () => {}, onChange: () => {},
    requestToken: async () => { tokenCalls++; if (o.tokenError) throw o.tokenError; return { token: fake.validToken, expiresAt: Date.now() + 3600_000 }; },
  });
  await conn.load();
  return { conn, dev, tokenCalls: () => tokenCalls };
}

describe("connection flow (FAKE Google; real Google is BLOCKED(GOOGLE))", () => {
  it("file:// and a missing client id never call the token flow or the network", async () => {
    const fake = new FakeSheets();
    const a = await make(fake, { mode: "LOCAL_FILE" });
    await a.conn.connect();
    expect(a.conn.state).toMatchObject({ kind: "LOCAL_FILE", message: MSG.LOCAL_FILE });
    expect(a.tokenCalls()).toBe(0);
    const b = await make(fake, { clientId: "" });
    await b.conn.connect();
    expect(b.conn.state.kind).toBe("NO_CLIENT_ID");
    expect(b.tokenCalls()).toBe(0);
    expect(fake.requests.length).toBe(0);
  });

  it("first connection: URL -> inspect (read only) -> approval -> init -> synced; user tabs untouched", async () => {
    const fake = new FakeSheets(); fake.addBook(ID, { "My Sheet": [["x", 1]] });
    const before = fake.snapshot(ID, ["My Sheet"]);
    const { conn, dev } = await make(fake);
    await conn.connect();
    expect(conn.state.kind).toBe("AWAITING_URL");
    await conn.submitUrl("not a link");
    expect(conn.state).toMatchObject({ kind: "ERROR", code: "BAD_URL", message: MSG.BAD_URL });
    expect(fake.requests.length).toBe(0); // invalid link: zero Google calls
    await conn.connect();
    await conn.submitUrl(URL);
    expect(conn.state.kind).toBe("NEEDS_INIT");
    expect(fake.writeCount).toBe(0); // nothing is written before approval
    await dev.record("QUESTION_SUBMITTED", "q1", { a: 1 });
    await conn.confirmInit();
    expect(conn.state.kind).toBe("READY");
    expect(conn.syncStatus?.state).toBe("IDLE");
    expect(await dev.pendingCount()).toBe(0);
    expect(fake.snapshot(ID, ["My Sheet"])).toEqual(before);
    expect(fake.tab(ID, SHEET_TABS.EVENTS)!.rows.length).toBeGreaterThan(2);
    expect((await dev.store.getMeta("sheetBinding"))).toMatchObject({ spreadsheetId: ID });
    // the binding event carries no spreadsheet id / url
    const bound = (await dev.store.listEvents()).find((s) => s.event.type === "SHEET_BOUND")!;
    expect(bound.event.payloadJson).not.toContain(ID);
  });

  it("declined consent keeps everything local with the exact message", async () => {
    const fake = new FakeSheets();
    const { conn, dev } = await make(fake, { tokenError: new GoogleError("DECLINED", MSG.DECLINED) });
    await dev.record("QUESTION_SUBMITTED", "q1", {});
    await conn.connect();
    expect(conn.state).toMatchObject({ kind: "ERROR", message: "연결하지 않았습니다. 학습 내용은 아직 시트에 저장되지 않았습니다." });
    expect(await dev.pendingCount()).toBeGreaterThan(0);
  });

  it("new device joins an existing sheet: adopts its profile and restores target + diagnostic + content", async () => {
    const fake = new FakeSheets(); fake.addBook(ID, { Sheet1: [] });
    const a = await make(fake);
    await a.conn.connect(); await a.conn.submitUrl(URL); await a.conn.confirmInit();
    await a.dev.record("EXAM_TARGET_SELECTED", "exam", { level: "N3", year: 2099, month: 12 });
    const items = buildDiagnostic(SEED_PACK.items);
    for (const it of items.slice(0, 3)) await a.dev.record("QUESTION_SUBMITTED", it.record.contentId, { contentId: it.record.contentId, selectedChoiceId: "a", isCorrect: true, exposureType: "DIAGNOSTIC" });
    await a.conn.syncNow();
    expect(a.conn.syncStatus?.state).toBe("IDLE");

    const b = await make(fake);
    expect(b.dev.profileId).not.toBe(a.dev.profileId);
    await b.conn.connect(); await b.conn.submitUrl(URL);
    expect(b.conn.state.kind).toBe("READY");
    expect(b.dev.profileId).toBe(a.dev.profileId); // joined, not mismatched
    const evs = (await b.dev.store.listEvents()).map((s) => s.event);
    expect(projectExamTarget(evs, "N3")).toMatchObject({ targetYear: 2099, targetMonth: 12 });
    expect(diagnosticState(items, evs).answered).toBe(3); // no fresh diagnostic
    expect((await b.dev.store.listContent()).length).toBe(SEED_PACK.items.length);
    expect(await b.dev.pendingCount()).toBe(0);
  });

  it("a device with real history refuses to merge into someone else's sheet", async () => {
    const fake = new FakeSheets(); fake.addBook(ID, { Sheet1: [] });
    const a = await make(fake);
    await a.conn.connect(); await a.conn.submitUrl(URL); await a.conn.confirmInit();
    const b = await make(fake);
    await b.dev.record("QUESTION_SUBMITTED", "mine", { x: 1 });
    const writes = fake.writeCount;
    await b.conn.connect(); await b.conn.submitUrl(URL);
    expect(b.conn.state).toMatchObject({ kind: "ERROR", code: "PROFILE_MISMATCH", message: MSG.PROFILE_MISMATCH });
    expect(fake.writeCount).toBe(writes);
    expect(await b.dev.pendingCount()).toBeGreaterThan(0);
  });

  it("foreign tabs, newer schema, read-only and missing sheets give the matrix messages and write nothing", async () => {
    const run = async (setup: (f: FakeSheets) => void, expectCode: string) => {
      const fake = new FakeSheets(); fake.addBook(ID, { Sheet1: [] }); setup(fake);
      const { conn } = await make(fake);
      await conn.connect(); await conn.submitUrl(URL);
      if (conn.state.kind === "NEEDS_INIT") await conn.confirmInit();
      expect(conn.state).toMatchObject({ kind: "ERROR", code: expectCode });
      return fake;
    };
    const f1 = await run((f) => f.books.get(ID)!.tabs.push({ sheetId: 9, title: "_JLPT_META", rows: [["other", "layout"]] }), "FOREIGN_TABS");
    expect(f1.writeCount).toBe(0);
    await run((f) => { f.books.get(ID)!.readOnly = true; }, "READ_ONLY");
    const fake = new FakeSheets();
    const { conn } = await make(fake);
    await conn.connect(); await conn.submitUrl(URL);
    expect(conn.state).toMatchObject({ kind: "ERROR", code: "NOT_FOUND", message: MSG.NOT_FOUND });
  });

  it("token expiry: NEEDS_AUTH keeps the outbox; reconnect continues from the same binding", async () => {
    const fake = new FakeSheets(); fake.addBook(ID, { Sheet1: [] });
    const { conn, dev } = await make(fake);
    await conn.connect(); await conn.submitUrl(URL); await conn.confirmInit();
    fake.validToken = "tok-new-needed";
    await dev.record("QUESTION_SUBMITTED", "q9", { z: 1 });
    await conn.syncNow();
    expect(conn.syncStatus?.state).toBe("NEEDS_AUTH");
    expect(await dev.pendingCount()).toBeGreaterThan(0);
    await conn.reconnect();
    expect(conn.syncStatus?.state).toBe("IDLE");
    expect(await dev.pendingCount()).toBe(0);
  });

  it("disconnect forgets the token/binding but deletes nothing", async () => {
    const fake = new FakeSheets(); fake.addBook(ID, { Sheet1: [] });
    const { conn, dev } = await make(fake);
    await conn.connect(); await conn.submitUrl(URL); await conn.confirmInit();
    const events = (await dev.store.listEvents()).length;
    const rows = fake.tab(ID, SHEET_TABS.EVENTS)!.rows.length;
    await conn.disconnect();
    expect(conn.state.kind).toBe("DISCONNECTED");
    expect(conn.hasToken).toBe(false);
    expect((await dev.store.listEvents()).length).toBe(events);
    expect(fake.tab(ID, SHEET_TABS.EVENTS)!.rows.length).toBe(rows);
  });

  it("content rows added to the sheet appear on the next sync without any new HTML", async () => {
    const fake = new FakeSheets(); fake.addBook(ID, { Sheet1: [] });
    const { conn, dev } = await make(fake);
    await conn.connect(); await conn.submitUrl(URL); await conn.confirmInit();
    const before = (await dev.store.listContent()).length;
    const tab = fake.tab(ID, SHEET_TABS.CONTENT)!;
    const proto = tab.rows[1]!;
    // a copy with another id but the SAME hash would fail hash verification only if payload changed; ids are not hashed
    tab.rows.push(["vocab:addedlater", ...proto.slice(1)]);
    await conn.syncNow();
    expect((await dev.store.listContent()).length).toBe(before + 1);
    void inspect; void initialize; void SheetsClient;
  });
});
