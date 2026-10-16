import { beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { SyncCoordinator, SYNC, type SyncStatus } from "../../app/src/storage/sync";
import { SheetsClient, SheetsEventLog, eventToRow } from "../../app/src/google/sheets";
import { initialize, inspect } from "../../app/src/google/init";
import { AppStorage } from "../../app/src/storage/session";
import { createEvent } from "../../app/src/storage/events";
import { FakeSheets } from "./fakeSheets";
import { SEED_PACK } from "../../app/src/content/seed";
import { SHEET_TABS } from "../../shared/sheetSchema";
import { projectExamTarget, targetConflict, targetHeads } from "../../app/src/domain/target";
import { MockSheetsAdapter } from "../../app/src/storage/mockSheets";
import { MemoryStore } from "../../app/src/storage/local";

const ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd";

interface Rig { fake: FakeSheets; log: SheetsEventLog; dev: AppStorage; sync: SyncCoordinator; statuses: SyncStatus[]; sleeps: number[]; clock: { t: number } }

async function rig(opts: { fake?: FakeSheets; dev?: AppStorage; maxBatch?: number } = {}): Promise<Rig> {
  const fake = opts.fake ?? new FakeSheets();
  if (!fake.books.has(ID)) {
    fake.addBook(ID, { Sheet1: [["keep", "me"]] });
    const c = new SheetsClient(ID, () => fake.validToken, fake.http);
    await initialize(c, await inspect(c), { profileId: "p1", seed: SEED_PACK });
  }
  const log = new SheetsEventLog(new SheetsClient(ID, () => fake.validToken, fake.http));
  const dev = opts.dev ?? (await AppStorage.init(new IDBFactory()));
  const statuses: SyncStatus[] = []; const sleeps: number[] = []; const clock = { t: 1_000_000 };
  const sync = new SyncCoordinator(dev.store, log, { now: () => clock.t, sleep: async (ms) => { sleeps.push(ms); clock.t += ms; }, rng: () => 0.5, onStatus: (s) => statuses.push({ ...s }), maxBatch: opts.maxBatch });
  return { fake, log, dev, sync, statuses, sleeps, clock };
}
const events = (r: Rig) => r.fake.tab(ID, SHEET_TABS.EVENTS)!.rows.slice(1);
const addEvents = async (dev: AppStorage, n: number, type: any = "QUESTION_SUBMITTED") => { for (let i = 0; i < n; i++) await dev.record(type, `q${i}`, { i }); };

describe("batch sync with readback ACK (FAKE Sheets API; real Google is BLOCKED(GOOGLE))", () => {
  it("local first: nothing is SYNCED until the rows were read back; then pending drops to 0", async () => {
    const r = await rig();
    await addEvents(r.dev, 5);
    const before = await r.dev.pendingCount();
    expect(before).toBeGreaterThanOrEqual(5);
    const st = await r.sync.flush("manual");
    expect(st.state).toBe("IDLE");
    expect(st.pending).toBe(0);
    expect(events(r).length).toBe(before);
    expect((await r.dev.store.listEvents()).every((s) => s.status === "SYNCED")).toBe(true);
  });

  it("pending never drops without a verified ACK: a failing append leaves every event pending", async () => {
    const r = await rig();
    await addEvents(r.dev, 4);
    const n = await r.dev.pendingCount();
    r.fake.failures.push({ match: /EVENTS.*:append/, status: 403, body: { error: { status: "PERMISSION_DENIED", message: "The caller does not have permission" } } });
    const st = await r.sync.flush("manual");
    expect(st).toMatchObject({ state: "READ_ONLY", code: "READ_ONLY", message: "이 스프레드시트에 앱 기록을 쓸 수 없습니다." });
    expect(await r.dev.pendingCount()).toBe(n);
    expect(r.statuses.filter((s) => s.state === "READ_ONLY").every((s) => s.pending === n)).toBe(true);
  });

  it("sends at most 200 rows per request", async () => {
    const r = await rig();
    await addEvents(r.dev, 450);
    const total = await r.dev.pendingCount();
    r.fake.requests.length = 0;
    await r.sync.flush("manual");
    const appends = r.fake.requests.filter((q) => q.path.includes(":append"));
    expect(appends.length).toBe(Math.ceil(total / SYNC.MAX_BATCH));
    expect(events(r).length).toBe(total);
    expect(await r.dev.pendingCount()).toBe(0);
  });

  it("lost response after the write: no duplicate row, local events are marked SYNCED from the remote copy", async () => {
    const r = await rig();
    await addEvents(r.dev, 3);
    const n = await r.dev.pendingCount();
    r.fake.failures.push({ match: /EVENTS.*:append/, afterApply: true, network: true, times: 1 });
    const first = await r.sync.flush("manual");
    expect(first.state).toBe("OFFLINE");
    expect(first.message).toBe(`연결이 끊겼습니다. ${n}건이 기기에만 저장되어 있습니다.`);
    expect(await r.dev.pendingCount()).toBe(n); // still pending: no ACK yet
    expect(events(r).length).toBe(n);             // but the write really happened
    const second = await r.sync.flush("manual");   // pull() resolves it by eventId+checksum
    expect(second.state).toBe("IDLE");
    expect(events(r).length).toBe(n);              // logical duplicates: 0
    expect(await r.dev.pendingCount()).toBe(0);
  });

  it("5xx after the write: the remote log is consulted before any re-send (TST-SYNC-02)", async () => {
    const r = await rig();
    await addEvents(r.dev, 3);
    const n = await r.dev.pendingCount();
    r.fake.failures.push({ match: /EVENTS.*:append/, afterApply: true, status: 503, times: 1 });
    r.fake.requests.length = 0;
    const st = await r.sync.flush("manual");
    expect(st.state).toBe("IDLE");
    expect(events(r).length).toBe(n);
    expect(r.fake.requests.filter((q) => q.path.includes("EVENTS") && q.path.includes(":append")).length).toBe(1); // never appended twice
  });

  it("5xx before the write: re-sends after confirming the rows are absent", async () => {
    const r = await rig();
    await addEvents(r.dev, 2);
    r.fake.failures.push({ match: /EVENTS.*:append/, status: 503, times: 1 });
    const st = await r.sync.flush("manual");
    expect(st.state).toBe("IDLE");
    expect(events(r).length).toBe(await (async () => (await r.dev.store.listEvents()).length)());
  });

  it("429: exponential backoff with jitter (Retry-After honoured), then success", async () => {
    const r = await rig();
    await addEvents(r.dev, 2);
    r.fake.failures.push({ match: /EVENTS.*:append/, status: 429, times: 2 });
    const st = await r.sync.flush("manual");
    expect(st.state).toBe("IDLE");
    expect(r.sleeps).toEqual([SYNC.BACKOFF_BASE_MS * 1 * 1, SYNC.BACKOFF_BASE_MS * 2 * 1]); // rng 0.5 -> factor 1
    const r2 = await rig();
    await addEvents(r2.dev, 1);
    r2.fake.failures.push({ match: /EVENTS.*:append/, status: 429, headers: { "retry-after": "7" }, times: 1 });
    await r2.sync.flush("manual");
    expect(r2.sleeps).toEqual([7000]);
  });

  it("429 that never clears ends as RATE_LIMITED with everything still pending", async () => {
    const r = await rig();
    await addEvents(r.dev, 2);
    const n = await r.dev.pendingCount();
    r.fake.failures.push({ match: /EVENTS.*:append/, status: 429 });
    const st = await r.sync.flush("manual");
    expect(st).toMatchObject({ state: "RATE_LIMITED", message: "Google 요청 한도로 동기화가 지연되고 있습니다." });
    expect(await r.dev.pendingCount()).toBe(n);
  });

  it("401: NEEDS_AUTH keeps the outbox, a new token continues", async () => {
    const r = await rig();
    await addEvents(r.dev, 3);
    const n = await r.dev.pendingCount();
    r.fake.validToken = "tok-2";
    const log = new SheetsEventLog(new SheetsClient(ID, () => "tok-1", r.fake.http));
    const sync = new SyncCoordinator(r.dev.store, log, { now: () => r.clock.t, sleep: async () => {} });
    const st = await sync.flush("manual");
    expect(st).toMatchObject({ state: "NEEDS_AUTH", message: "Google 연결이 만료되었습니다. 다시 연결해 주세요." });
    expect(await r.dev.pendingCount()).toBe(n);
    const fresh = new SyncCoordinator(r.dev.store, new SheetsEventLog(new SheetsClient(ID, () => "tok-2", r.fake.http)), { now: () => r.clock.t, sleep: async () => {} });
    expect((await fresh.flush("manual")).state).toBe("IDLE");
    expect(await r.dev.pendingCount()).toBe(0);
  });

  it("a same-id/different-checksum row in the sheet makes the app read-only instead of overwriting", async () => {
    const r = await rig();
    const e = await r.dev.record("QUESTION_SUBMITTED", "q1", { a: 1 });
    const forged = createEvent({ profileId: "p1", deviceId: "d9", deviceSeq: 1, type: "QUESTION_SUBMITTED", entityId: "q1", payload: { a: 999 }, eventId: e.eventId });
    r.fake.tab(ID, SHEET_TABS.EVENTS)!.rows.push([forged.eventId, forged.profileId, forged.deviceId, forged.deviceSeq, forged.occurredAt, forged.type, forged.entityId, forged.eventSchemaVersion, forged.payloadJson, forged.checksum]);
    const st = await r.sync.flush("manual");
    expect(st).toMatchObject({ state: "READ_ONLY", code: "CORRUPT", message: "앱 데이터 버전을 확인할 수 없어 쓰기를 중단했습니다." });
    expect(await r.dev.pendingCount()).toBeGreaterThan(0);
    const again = await r.sync.flush("manual");
    expect(again.state).toBe("READ_ONLY"); // stays blocked
  });

  it("non-manual flushes respect the 10 s minimum interval", async () => {
    const r = await rig();
    await addEvents(r.dev, 1);
    await r.sync.flush("manual");
    await addEvents(r.dev, 1);
    r.clock.t += 2000;
    await r.sync.flush("interval");
    expect(r.sleeps.some((ms) => ms >= SYNC.MIN_INTERVAL_MS - 2000 - 1)).toBe(true);
  });

  it("20 pending triggers a flush, fewer arm a 60 s timer", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const r = await rig();
      const spy = vi.spyOn(r.sync, "flush");
      await addEvents(r.dev, 3);
      await r.sync.notifyChanged();
      expect(spy).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(SYNC.INTERVAL_MS + 10);
      expect(spy).toHaveBeenCalledWith("interval");
      vi.useRealTimers();
      await r.sync.flush("manual"); // let the interval flush settle (joins the in-flight one)
      spy.mockClear();
      await addEvents(r.dev, 25);
      await r.sync.notifyChanged();
      expect(spy).toHaveBeenCalledWith("threshold");
    } finally { vi.useRealTimers(); }
  });
});

describe("two devices (FAKE Sheets API)", () => {
  it("union of events, deduped; the latest settings/target wins and the other device is told", async () => {
    const a = await rig();
    const b = await rig({ fake: a.fake });
    await a.dev.record("EXAM_TARGET_SELECTED", "exam", { level: "N3", year: 2099, month: 7 });
    await new Promise((r) => setTimeout(r, 5));
    await b.dev.record("EXAM_TARGET_SELECTED", "exam", { level: "N3", year: 2099, month: 12 });
    await a.dev.record("QUESTION_SUBMITTED", "qa", { who: "a" });
    await b.dev.record("QUESTION_SUBMITTED", "qb", { who: "b" });
    const toastsA: number[] = [];
    (a.sync as any).o.onRemoteEvents = (evs: unknown[]) => toastsA.push(evs.length);
    await a.sync.flush("manual");
    await b.sync.flush("manual");
    await a.sync.flush("manual"); // a pulls b's events
    const all = (await a.dev.store.listEvents()).map((s) => s.event);
    const idsA = new Set(all.map((e) => e.eventId));
    const idsB = new Set((await b.dev.store.listEvents()).map((s) => s.event.eventId));
    expect(idsA.size).toBe(all.length);                          // no duplicates in the projection input
    await b.sync.flush("manual");
    expect(new Set((await b.dev.store.listEvents()).map((s) => s.event.eventId))).toEqual(idsA);
    void idsB;
    expect(projectExamTarget(all, "N3")).toMatchObject({ targetYear: 2099, targetMonth: 12 }); // latest occurredAt wins
    expect(toastsA.length).toBeGreaterThan(0);
    expect(events(a).length).toBe(all.length); // every logical event once in the sheet
  });
  it("TST-SYNC-03: target changed on both devices without seeing each other -> conflict is shown, nothing lost, resolved by the learner", async () => {
    const a = await rig();
    const b = await rig({ fake: a.fake });
    const all = async (r: Rig) => (await r.dev.store.listEvents()).map((s) => s.event);
    // both devices knew no target (basedOn = []) and chose different ones while offline
    await a.dev.record("EXAM_TARGET_SELECTED", "exam", { level: "N3", year: 2099, month: 7, basedOn: [] });
    await new Promise((r) => setTimeout(r, 5));
    await b.dev.record("EXAM_TARGET_SELECTED", "exam", { level: "N3", year: 2099, month: 12, basedOn: [] });
    await a.sync.flush("manual"); await b.sync.flush("manual"); await a.sync.flush("manual");
    const conflict = targetConflict(await all(a));
    expect(conflict?.options.map((o) => o.month).sort()).toEqual([12, 7]);
    expect(targetConflict(await all(b))?.headIds.sort()).toEqual(conflict!.headIds.sort());
    // the learner on device a picks one option; it is based on both heads
    await a.dev.record("EXAM_TARGET_SELECTED", "exam", { level: "N3", year: 2099, month: 7, basedOn: conflict!.headIds, resolved: true });
    await a.sync.flush("manual"); await b.sync.flush("manual");
    for (const r of [a, b]) {
      const evs = await all(r);
      expect(targetConflict(evs)).toBeNull();
      expect(targetHeads(evs).length).toBe(1);
      expect(projectExamTarget(evs, "N3")).toMatchObject({ targetYear: 2099, targetMonth: 7 });
    }
    expect((await all(a)).filter((e) => e.type === "EXAM_TARGET_SELECTED").length).toBe(3); // every choice is kept in the log
  });
  it("same target chosen on both devices is not a conflict; legacy events without basedOn keep the old latest-wins chain", async () => {
    const mk = (n: number, device: string, p: object, at: string) => createEvent({ profileId: "p", deviceId: device, deviceSeq: n, type: "EXAM_TARGET_SELECTED", entityId: "exam", payload: p, now: new Date(at) });
    const same = [mk(1, "d1", { level: "N3", year: 2099, month: 7, basedOn: [] }, "2099-01-01T00:00:00Z"), mk(1, "d2", { level: "N3", year: 2099, month: 7, basedOn: [] }, "2099-01-01T00:00:01Z")];
    expect(targetHeads(same).length).toBe(2);
    expect(targetConflict(same)).toBeNull();
    const legacy = [mk(1, "d1", { level: "N3", year: 2099, month: 7 }, "2099-01-01T00:00:00Z"), mk(1, "d2", { level: "N3", year: 2099, month: 12 }, "2099-01-02T00:00:00Z")];
    expect(targetConflict(legacy)).toBeNull();
    expect(projectExamTarget(legacy, "N3")).toMatchObject({ targetMonth: 12 });
  });
  it("a new device restores everything from the sheet", async () => {
    const a = await rig();
    await addEvents(a.dev, 12);
    await a.sync.flush("manual");
    const fresh = await rig({ fake: a.fake });
    await fresh.sync.flush("manual");
    const fe = (await fresh.dev.store.listEvents()).filter((s) => s.event.type === "QUESTION_SUBMITTED");
    expect(fe.length).toBe(12);
    expect((await fresh.dev.store.getMeta<number>("eventRowCursor"))).toBeGreaterThan(12);
  });
});

describe("large logs (FAKE Sheets API)", () => {
  it("a new device restores 12,000 remote events in 500-row chunks without loss or duplicates; pushing 1,000 uses 200-row batches", async () => {
    const a = await rig();
    // write the remote rows directly (what many earlier sessions on another device would have left behind)
    const tab = a.fake.tab(ID, SHEET_TABS.EVENTS)!;
    const rows: string[][] = [];
    for (let i = 0; i < 12000; i++) {
      const e = createEvent({ profileId: "p1", deviceId: "other", deviceSeq: i + 1, type: "QUESTION_SUBMITTED", entityId: `q${i}`, payload: { i }, eventId: `bulk-${i}` });
      rows.push(eventToRow(e).map(String));
    }
    const head = tab.rows[0]!;
    tab.rows = [head, ...rows];
    const fresh = await rig({ fake: a.fake });
    const before = a.fake.requests.length;
    await fresh.sync.flush("manual");
    const got = (await fresh.dev.store.listEvents()).filter((s) => s.event.deviceId === "other");
    expect(got.length).toBe(12000);
    expect(new Set(got.map((s) => s.event.eventId)).size).toBe(12000);
    const reads = a.fake.requests.slice(before).filter((r) => r.method === "GET").length;
    expect(reads).toBeLessThanOrEqual(Math.ceil(12000 / SYNC.PULL_CHUNK) + 6);
    await addEvents(fresh.dev, 1000);
    const b2 = a.fake.requests.length;
    await fresh.sync.flush("manual");
    expect(a.fake.requests.slice(b2).filter((r) => /:append/.test(r.path)).length).toBe(5);
    expect(await fresh.dev.pendingCount()).toBe(0);
  }, 120000);
});

describe("MockSheetsAdapter contract (labelled MOCK)", () => {
  it("drives the same coordinator and the same invariants", async () => {
    const store = new MemoryStore();
    const dev = await AppStorage.init(null);
    const mock = new MockSheetsAdapter();
    const sync = new SyncCoordinator(dev.store, mock, { sleep: async () => {} });
    await addEvents(dev, 3);
    mock.failNext("LOST_RESPONSE");
    expect((await sync.flush("manual")).state).toBe("OFFLINE");
    expect(mock.rows.length).toBe(await dev.pendingCount());
    expect((await sync.flush("manual")).state).toBe("IDLE");
    expect(mock.rows.length).toBe((await dev.store.listEvents()).length);
    void store;
  });
});
