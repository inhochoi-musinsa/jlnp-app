import { beforeEach, describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { createEvent, checkEvent, dedupeEvents, IntegrityConflictError, replayOrder } from "../../app/src/storage/events";
import { IndexedDbStore, MemoryStore, openBestStore } from "../../app/src/storage/local";
import { AppStorage } from "../../app/src/storage/session";
import { applyImport, containsSecretKeys, exportBackup, previewImport } from "../../app/src/storage/backup";
import { MockSheetsAdapter } from "../../app/src/storage/mockSheets";
import { GoogleError } from "../../app/src/google/errors";
import type { LocalStore } from "../../app/src/storage/interface";

const mk = (n: number, over: Record<string, unknown> = {}) =>
  createEvent({ profileId: "p1", deviceId: "d1", deviceSeq: n, type: "QUESTION_SUBMITTED", entityId: `q${n}`, payload: { n, ...over }, now: new Date(Date.UTC(2026, 9, 16, 0, 0, n)), eventId: `e-${n}` });

const stores: [string, () => Promise<LocalStore>][] = [
  ["memory", async () => new MemoryStore()],
  ["indexeddb(fake)", async () => IndexedDbStore.open(new IDBFactory(), "t")],
];

describe.each(stores)("TST-SYNC-01 outbox semantics: %s", (_n, make) => {
  let s: LocalStore;
  beforeEach(async () => { s = await make(); });

  it("same eventId + same checksum is applied once", async () => {
    const e = mk(1);
    expect(await s.appendEvent(e)).toBe("ADDED");
    expect(await s.appendEvent({ ...e })).toBe("DUPLICATE");
    expect((await s.listEvents()).length).toBe(1);
  });
  it("same eventId + different checksum is an integrity conflict and never overwrites", async () => {
    await s.appendEvent(mk(1));
    await expect(s.appendEvent(mk(1, { tampered: true }))).rejects.toBeInstanceOf(IntegrityConflictError);
    expect(JSON.parse((await s.listEvents())[0]!.event.payloadJson).tampered).toBeUndefined();
  });
  it("pending shrinks only through markSynced", async () => {
    for (let i = 1; i <= 3; i++) await s.appendEvent(mk(i));
    expect((await s.listPending()).length).toBe(3);
    await s.markSynced(["e-1", "e-2"], "2026-10-16T00:00:00Z");
    expect((await s.listPending()).map((e) => e.eventId)).toEqual(["e-3"]);
    expect((await s.listPending(0)).length).toBe(0);
  });
  it("meta round trip and clearAll", async () => {
    await s.setMeta("k", { a: 1 });
    expect(await s.getMeta("k")).toEqual({ a: 1 });
    await s.clearAll();
    expect(await s.getMeta("k")).toBeUndefined();
  });
});

describe("events", () => {
  it("checksum detects tampering and bad shape/type", () => {
    const e = mk(1);
    expect(checkEvent(e)).toBeNull();
    expect(checkEvent({ ...e, payloadJson: "{}" })).toBe("CHECKSUM");
    expect(checkEvent({ ...e, type: "NOPE" })).toBe("TYPE");
    expect(checkEvent({ ...e, deviceSeq: "1" })).toBe("SHAPE");
    expect(checkEvent(null)).toBe("SHAPE");
  });
  it("dedupe + replay order are deterministic", () => {
    const a = mk(1), b = mk(2);
    const r = dedupeEvents([b, a, { ...a }, mk(1, { x: 1 })]);
    expect(r.unique.length).toBe(2);
    expect(r.duplicates).toBe(1);
    expect(r.conflicts).toEqual(["e-1"]);
    expect([b, a].sort(replayOrder).map((e) => e.eventId)).toEqual(["e-1", "e-2"]);
  });
});

describe("AppStorage", () => {
  it("creates identity once and records PROFILE_CREATED; reopen keeps identity", async () => {
    const f = new IDBFactory();
    const a = await AppStorage.init(f);
    const b = await AppStorage.init(f);
    expect(b.profileId).toBe(a.profileId);
    expect(b.deviceId).toBe(a.deviceId);
    const evs = (await b.store.listEvents()).filter((s) => s.event.type === "PROFILE_CREATED");
    expect(evs.length).toBe(1);
  });
  it("concurrent record() calls (not awaited, as the quiz does) get unique, call-ordered sequence numbers", async () => {
    const a = await AppStorage.init(new IDBFactory());
    const types = ["QUESTION_PRESENTED", "QUESTION_SUBMITTED", "ANSWER_REVEALED", "CARD_REVIEWED", "SETTINGS_UPDATED"] as const;
    const out = await Promise.all(types.map((t) => a.record(t, "x", { contentId: "c" })));
    const seqs = out.map((e) => e.deviceSeq);
    expect(new Set(seqs).size).toBe(types.length);
    expect(seqs).toEqual([...seqs].sort((x, y) => x - y));
    expect(await a.store.getMeta("deviceSeq")).toBe(Math.max(...seqs));
    const stored = (await a.store.listEvents()).map((s) => s.event.deviceSeq);
    expect(new Set(stored).size).toBe(stored.length);
  });
  it("a stored counter that lags behind the log is repaired on open (never reuse a sequence number)", async () => {
    const f = new IDBFactory();
    const a = await AppStorage.init(f);
    for (let i = 0; i < 5; i++) await a.record("QUESTION_SUBMITTED", `q${i}`, { i });
    const maxSeq = Math.max(...(await a.store.listEvents()).map((x) => x.event.deviceSeq));
    await a.store.setMeta("deviceSeq", 2); // what an older build could leave behind
    const b = await AppStorage.init(f);
    const e = await b.record("QUESTION_SUBMITTED", "later", {});
    expect(e.deviceSeq).toBe(maxSeq + 1);
  });
  it("recovery points: rotate to the newest 5, skip an empty or oversized log, restore only adds missing events", async () => {
    const f = new IDBFactory();
    const a = await AppStorage.init(f);
    for (let i = 0; i < 6; i++) { await a.record("QUESTION_SUBMITTED", `q${i}`, { i }); await a.takeSnapshot("MANUAL", "t"); }
    const snaps = await a.listSnapshots();
    expect(snaps.length).toBe(5);
    expect(snaps[snaps.length - 1]!.eventCount).toBe((await a.store.listEvents()).length);
    expect(JSON.parse(snaps[0]!.backup).format).toBe("jlpt-backup");
    const empty = await AppStorage.init(new IDBFactory(), );
    await empty.store.clearAll();
    expect(await empty.takeSnapshot("MANUAL", "t")).toBeNull();
    const all = (await a.store.listEvents()).map((x) => x.event.eventId);
    const r1 = await a.restoreSnapshot(snaps[snaps.length - 1]!.id, "t");
    expect(r1.added).toBe(0);                                                     // nothing missing -> nothing added twice
    expect((await a.store.listEvents()).length).toBe(all.length);
    expect((await a.listSnapshots()).some((x) => x.reason === "BEFORE_RESTORE")).toBe(true);
  });
  it("a snapshot survives clearAll() (explicit deletion of the log must not erase the way back)", async () => {
    const a = await AppStorage.init(new IDBFactory());
    await a.record("QUESTION_SUBMITTED", "q", {});
    const s = (await a.takeSnapshot("MANUAL", "t"))!;
    await a.store.clearAll();
    expect((await a.listSnapshots()).map((x) => x.id)).toContain(s.id);
  });
  it("deviceSeq increases monotonically across reopen", async () => {
    const f = new IDBFactory();
    const a = await AppStorage.init(f);
    const e1 = await a.record("SETTINGS_UPDATED", "settings", { x: 1 });
    const b = await AppStorage.init(f);
    const e2 = await b.record("SETTINGS_UPDATED", "settings", { x: 2 });
    expect(e2.deviceSeq).toBe(e1.deviceSeq + 1);
  });
  it("settings projection restores the latest SETTINGS_UPDATED", async () => {
    const a = await AppStorage.init(new IDBFactory());
    await a.record("SETTINGS_UPDATED", "settings", { fontScale: "L" });
    await a.record("SETTINGS_UPDATED", "settings", { fontScale: "XL", furiganaMode: "HIDDEN" });
    expect(await a.projectSettings()).toMatchObject({ fontScale: "XL", furiganaMode: "HIDDEN" });
  });
  it("falls back to memory with a reason when IndexedDB is unusable", async () => {
    const broken = { open() { throw new Error("SecurityError: storage denied"); } } as unknown as IDBFactory;
    const r = await openBestStore(broken);
    expect(r.probe.kind).toBe("memory");
    expect(r.probe.reason).toContain("denied");
    const st = await AppStorage.init(broken);
    expect(st.persistent).toBe(false);
    expect((await st.pendingCount())).toBeGreaterThan(0); // still recorded in memory, but flagged non-persistent
  });
});

describe("backup / restore", () => {
  it("export -> import into a fresh store restores everything; second import adds 0 (no duplicates)", async () => {
    const src = await AppStorage.init(new IDBFactory());
    for (let i = 0; i < 25; i++) await src.record("QUESTION_SUBMITTED", `q${i}`, { i });
    const file = await exportBackup(src.store, { appVersion: "0.0.1", profileId: src.profileId, settings: { fontScale: "L" } });
    const text = JSON.stringify(file);
    expect(containsSecretKeys(file)).toBe(false);

    const dst = await AppStorage.init(new IDBFactory());
    const before = (await dst.store.listEvents()).length;
    const p1 = await previewImport(text, dst.store, null);
    expect(p1.ok).toBe(true);
    expect(p1.newEvents).toBe(26 - 0 - (p1.duplicates)); // 25 + PROFILE_CREATED
    const r1 = await applyImport(dst.store, p1);
    expect(r1.added).toBe(p1.newEvents);
    const afterFirst = (await dst.store.listEvents()).length;
    expect(afterFirst).toBe(before + r1.added);

    const p2 = await previewImport(text, dst.store, null);
    expect(p2.newEvents).toBe(0);
    expect(p2.duplicates).toBe(p2.total);
    await applyImport(dst.store, p2);
    expect((await dst.store.listEvents()).length).toBe(afterFirst);
  });
  it("preview writes nothing, flags tampered/invalid/foreign files, and flags profile mismatch", async () => {
    const src = await AppStorage.init(new IDBFactory());
    await src.record("QUESTION_SUBMITTED", "q1", { a: 1 });
    const file = await exportBackup(src.store, { appVersion: "0.0.1", profileId: src.profileId });
    const dst = await AppStorage.init(new IDBFactory());
    const n = (await dst.store.listEvents()).length;

    const tampered = structuredClone(file);
    tampered.events[1]!.payloadJson = '{"a":2}';
    const pt = await previewImport(JSON.stringify(tampered), dst.store, null);
    expect(pt.invalid[0]?.reason).toBe("CHECKSUM");
    expect(pt.newEvents).toBe(file.events.length - 1);

    expect((await previewImport("not json", dst.store, null)).ok).toBe(false);
    expect((await previewImport(JSON.stringify({ format: "other" }), dst.store, null)).ok).toBe(false);
    expect((await previewImport(JSON.stringify({ ...file, formatVersion: 99 }), dst.store, null)).ok).toBe(false);
    expect((await previewImport(JSON.stringify({ ...file, eventSchemaVersion: 99 }), dst.store, null)).fatal).toContain("쓰기를 중단");
    const mm = await previewImport(JSON.stringify(file), dst.store, "another-profile");
    expect(mm.profileMismatch).toBe(true);
    expect((await dst.store.listEvents()).length).toBe(n); // preview never writes
  });
  it("conflicting events (same id, other checksum) are reported and never written", async () => {
    const dst = await AppStorage.init(new IDBFactory());
    const local = await dst.record("QUESTION_SUBMITTED", "q1", { a: 1 });
    const forged = { ...mk(1, { a: 2 }), eventId: local.eventId };
    // re-sign so it passes the checksum test but differs from the stored event
    const { eventChecksum } = await import("../../app/src/storage/events");
    const { checksum: _c, ...body } = forged;
    const signed = { ...body, checksum: eventChecksum(body) };
    const text = JSON.stringify({ format: "jlpt-backup", formatVersion: 1, eventSchemaVersion: 1, profileId: null, events: [signed] });
    const p = await previewImport(text, dst.store, null);
    expect(p.conflicts).toEqual([local.eventId]);
    expect(p.newEvents).toBe(0);
  });
});

describe("MockSheetsAdapter (MOCK ONLY, not evidence of real Google behaviour)", () => {
  it("append + readback, rows match checksums", async () => {
    const m = new MockSheetsAdapter();
    const evs = [mk(1), mk(2)];
    const range = await m.appendEvents(evs);
    expect(range).toEqual({ firstRow: 1, lastRow: 2 });
    expect((await m.readEventRows(1, 2)).map((e) => e.checksum)).toEqual(evs.map((e) => e.checksum));
    expect((await m.readEventsAfter(1, 10)).events.map((e) => e.eventId)).toEqual(["e-2"]);
  });
  it("failure injection: 5xx before write, lost response after write", async () => {
    const m = new MockSheetsAdapter();
    m.failNext("HTTP_5XX");
    await expect(m.appendEvents([mk(1)])).rejects.toBeInstanceOf(GoogleError);
    expect(await m.rowCount()).toBe(0);
    m.failNext("LOST_RESPONSE");
    await expect(m.appendEvents([mk(1)])).rejects.toBeInstanceOf(GoogleError);
    expect(await m.rowCount()).toBe(1); // written although the caller saw an error
  });
});

describe("T12: an app update keeps the records written by an older app version", () => {
  it("opens a version-1 database (events + meta only) with the current code and keeps every event", async () => {
    const factory = new IDBFactory();
    // what app version 0.0.x/0.1.0 wrote: DB_VERSION 1, no `content` store
    await new Promise<void>((resolve, reject) => {
      const open = factory.open("jlpt-app", 1);
      open.onupgradeneeded = () => { const db = open.result; db.createObjectStore("events", { keyPath: "event.eventId" }).createIndex("status", "status"); db.createObjectStore("meta"); };
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction(["events", "meta"], "readwrite");
        for (let i = 1; i <= 5; i++) tx.objectStore("events").add({ event: mk(i), status: i % 2 ? "PENDING" : "SYNCED" });
        tx.objectStore("meta").put("dev-old", "deviceId");
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
      open.onerror = () => reject(open.error);
    });
    const store = await IndexedDbStore.open(factory);
    expect((await store.listEvents()).length).toBe(5);
    expect((await store.listPending()).length).toBe(3);
    expect(await store.getMeta("deviceId")).toBe("dev-old");
    await store.putContent([]); // the new content store exists after the upgrade
    const st = await AppStorage.init(factory);
    expect(st.deviceId).toBe("dev-old");
  });
});
