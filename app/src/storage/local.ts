import { IntegrityConflictError, type SyncEvent } from "./events";
import type { LocalStore, StoredEvent } from "./interface";

export class MemoryStore implements LocalStore {
  readonly kind = "memory" as const;
  private events = new Map<string, StoredEvent>();
  private meta = new Map<string, unknown>();
  async appendEvent(e: SyncEvent) {
    const prev = this.events.get(e.eventId);
    if (prev) { if (prev.event.checksum !== e.checksum) throw new IntegrityConflictError(e.eventId); return "DUPLICATE" as const; }
    this.events.set(e.eventId, { event: e, status: "PENDING" });
    return "ADDED" as const;
  }
  async listEvents() { return [...this.events.values()]; }
  async listPending(limit = Infinity) { return [...this.events.values()].filter((s) => s.status === "PENDING").map((s) => s.event).slice(0, limit); }
  async markSynced(ids: string[], at: string) { for (const id of ids) { const s = this.events.get(id); if (s) { s.status = "SYNCED"; s.syncedAt = at; } } }
  async getMeta<T>(key: string) { return this.meta.get(key) as T | undefined; }
  async setMeta(key: string, value: unknown) { this.meta.set(key, value); }
  async clearAll() { this.events.clear(); this.meta.clear(); }
}

const DB_NAME = "jlpt-app";
const DB_VERSION = 1;
const req = <T>(r: IDBRequest<T>): Promise<T> => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const done = (tx: IDBTransaction): Promise<void> => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error ?? new Error("tx aborted")); });

export class IndexedDbStore implements LocalStore {
  readonly kind = "indexeddb" as const;
  private constructor(private db: IDBDatabase) {}

  static async open(factory: IDBFactory = indexedDB, name = DB_NAME): Promise<IndexedDbStore> {
    const open = factory.open(name, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains("events")) db.createObjectStore("events", { keyPath: "event.eventId" }).createIndex("status", "status");
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
    };
    return new IndexedDbStore(await req(open));
  }

  async appendEvent(e: SyncEvent) {
    const tx = this.db.transaction("events", "readwrite");
    const store = tx.objectStore("events");
    const prev = (await req(store.get(e.eventId))) as StoredEvent | undefined;
    if (prev) {
      await done(tx);
      if (prev.event.checksum !== e.checksum) throw new IntegrityConflictError(e.eventId);
      return "DUPLICATE" as const;
    }
    store.add({ event: e, status: "PENDING" } satisfies StoredEvent);
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
  async clearAll() { const tx = this.db.transaction(["events", "meta"], "readwrite"); tx.objectStore("events").clear(); tx.objectStore("meta").clear(); await done(tx); }
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
