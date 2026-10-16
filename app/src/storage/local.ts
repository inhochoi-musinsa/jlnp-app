import { IntegrityConflictError, type SyncEvent } from "./events";
import type { LocalStore, Snapshot, StoredEvent, SyncStatus } from "./interface";
import type { ContentRecord } from "../../../shared/schema";

export class MemoryStore implements LocalStore {
  readonly kind = "memory" as const;
  private events = new Map<string, StoredEvent>();
  private meta = new Map<string, unknown>();
  private content = new Map<string, ContentRecord>();
  private snaps = new Map<string, Snapshot>();
  async putSnapshot(s: Snapshot) { this.snaps.set(s.id, s); }
  async listSnapshots() { return [...this.snaps.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)); }
  async deleteSnapshot(id: string) { this.snaps.delete(id); }
  async appendEvent(e: SyncEvent, status: SyncStatus = "PENDING") {
    const prev = this.events.get(e.eventId);
    if (prev) { if (prev.event.checksum !== e.checksum) throw new IntegrityConflictError(e.eventId); if (status === "SYNCED" && prev.status !== "SYNCED") prev.status = "SYNCED"; return "DUPLICATE" as const; }
    this.events.set(e.eventId, { event: e, status });
    return "ADDED" as const;
  }
  async putContent(records: ContentRecord[]) { for (const r of records) this.content.set(`${r.contentId}@${r.contentVersion}`, r); }
  async listContent() { return [...this.content.values()]; }
  async listEvents() { return [...this.events.values()]; }
  async listPending(limit = Infinity) { return [...this.events.values()].filter((s) => s.status === "PENDING").map((s) => s.event).slice(0, limit); }
  async markSynced(ids: string[], at: string) { for (const id of ids) { const s = this.events.get(id); if (s) { s.status = "SYNCED"; s.syncedAt = at; } } }
  async getMeta<T>(key: string) { return this.meta.get(key) as T | undefined; }
  async setMeta(key: string, value: unknown) { this.meta.set(key, value); }
  async clearAll() { this.events.clear(); this.meta.clear(); this.content.clear(); }
}

const DB_NAME = "jlpt-app";
/** v1: events/meta. v2: + content. v3: + snapshots. Each step only adds a store, so no existing row is ever rewritten. */
export const DB_VERSION = 3;
const UPGRADES: Record<number, (db: IDBDatabase) => void> = {
  1: (db) => { db.createObjectStore("events", { keyPath: "event.eventId" }).createIndex("status", "status"); db.createObjectStore("meta"); },
  2: (db) => { db.createObjectStore("content"); },
  3: (db) => { db.createObjectStore("snapshots", { keyPath: "id" }); },
};
const req = <T>(r: IDBRequest<T>): Promise<T> => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const done = (tx: IDBTransaction): Promise<void> => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error ?? new Error("tx aborted")); });

export class IndexedDbStore implements LocalStore {
  readonly kind = "indexeddb" as const;
  /** The database version found on disk when an older one was upgraded (null: new database or already current). */
  upgradedFrom: number | null = null;
  private constructor(private db: IDBDatabase) {}

  static async open(factory: IDBFactory = indexedDB, name = DB_NAME): Promise<IndexedDbStore> {
    const open = factory.open(name, DB_VERSION);
    let from: number | null = null;
    open.onupgradeneeded = (ev) => {
      const db = open.result;
      const old = ev.oldVersion;
      if (old > 0) from = old;
      for (let v = old + 1; v <= DB_VERSION; v++) UPGRADES[v]?.(db);
    };
    const store = new IndexedDbStore(await req(open));
    store.upgradedFrom = from;
    return store;
  }

  async putSnapshot(s: Snapshot) { const tx = this.db.transaction("snapshots", "readwrite"); tx.objectStore("snapshots").put(s); await done(tx); }
  async listSnapshots() { return ((await req(this.db.transaction("snapshots").objectStore("snapshots").getAll())) as Snapshot[]).sort((a, b) => a.createdAt.localeCompare(b.createdAt)); }
  async deleteSnapshot(id: string) { const tx = this.db.transaction("snapshots", "readwrite"); tx.objectStore("snapshots").delete(id); await done(tx); }

  async appendEvent(e: SyncEvent, status: SyncStatus = "PENDING") {
    const tx = this.db.transaction("events", "readwrite");
    const store = tx.objectStore("events");
    const prev = (await req(store.get(e.eventId))) as StoredEvent | undefined;
    if (prev) {
      if (prev.event.checksum === e.checksum && status === "SYNCED" && prev.status !== "SYNCED") store.put({ ...prev, status: "SYNCED" });
      await done(tx);
      if (prev.event.checksum !== e.checksum) throw new IntegrityConflictError(e.eventId);
      return "DUPLICATE" as const;
    }
    store.add({ event: e, status } satisfies StoredEvent);
    await done(tx); // resolves only when the write is committed
    return "ADDED" as const;
  }
  async listEvents() { return (await req(this.db.transaction("events").objectStore("events").getAll())) as StoredEvent[]; }
  async listPending(limit = Infinity) {
    const all = (await req(this.db.transaction("events").objectStore("events").index("status").getAll("PENDING"))) as StoredEvent[];
    return all.map((s) => s.event).sort((a, b) => (a.deviceId === b.deviceId ? a.deviceSeq - b.deviceSeq : a.occurredAt < b.occurredAt ? -1 : 1)).slice(0, limit);
  }
  async markSynced(ids: string[], at: string) {
    const tx = this.db.transaction("events", "readwrite");
    const store = tx.objectStore("events");
    for (const id of ids) {
      const s = (await req(store.get(id))) as StoredEvent | undefined;
      if (s) store.put({ ...s, status: "SYNCED", syncedAt: at });
    }
    await done(tx);
  }
  async getMeta<T>(key: string) { return (await req(this.db.transaction("meta").objectStore("meta").get(key))) as T | undefined; }
  async setMeta(key: string, value: unknown) { const tx = this.db.transaction("meta", "readwrite"); tx.objectStore("meta").put(value, key); await done(tx); }
  async putContent(records: ContentRecord[]) {
    const tx = this.db.transaction("content", "readwrite");
    for (const r of records) tx.objectStore("content").put(r, `${r.contentId}@${r.contentVersion}`);
    await done(tx);
  }
  async listContent() { return (await req(this.db.transaction("content").objectStore("content").getAll())) as ContentRecord[]; }
  async clearAll() { const tx = this.db.transaction(["events", "meta", "content"], "readwrite"); tx.objectStore("events").clear(); tx.objectStore("meta").clear(); tx.objectStore("content").clear(); await done(tx); } // snapshots are kept on purpose
}

export interface StorageProbe { kind: "indexeddb" | "memory"; reason?: string }

/** Opens IndexedDB and does a real write/read round trip; falls back to memory with a reason. */
export async function openBestStore(factory: IDBFactory | undefined = typeof indexedDB !== "undefined" ? indexedDB : undefined): Promise<{ store: LocalStore; probe: StorageProbe }> {
  if (!factory) return { store: new MemoryStore(), probe: { kind: "memory", reason: "IndexedDB is not available" } };
  try {
    const store = await IndexedDbStore.open(factory);
    await store.setMeta("probe", "ok");
    if ((await store.getMeta("probe")) !== "ok") throw new Error("probe read-back mismatch");
    return { store, probe: { kind: "indexeddb" } };
  } catch (err) {
    return { store: new MemoryStore(), probe: { kind: "memory", reason: err instanceof Error ? err.message : String(err) } };
  }
}
