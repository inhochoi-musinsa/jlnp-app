import { GoogleError, MSG, type GErrorCode } from "../google/errors";
import type { SyncEvent } from "./events";
import type { LocalStore, RemoteEventLog } from "./interface";

export type SyncStateName = "IDLE" | "SYNCING" | "PENDING" | "NEEDS_AUTH" | "OFFLINE" | "READ_ONLY" | "RATE_LIMITED" | "ERROR";
export interface SyncStatus { state: SyncStateName; pending: number; code?: GErrorCode; message?: string; lastSyncedAt?: string; remoteCursor: number }

/** execution_plan §7 constants (limits recorded in docs/qa/limits.md). */
export const SYNC = { MAX_BATCH: 200, MIN_INTERVAL_MS: 10000, THRESHOLD: 20, INTERVAL_MS: 60000, PULL_CHUNK: 500, BACKOFF_BASE_MS: 2000, MAX_RATE_RETRIES: 5, MAX_UNSURE_RETRIES: 2 } as const;
const CURSOR_KEY = "eventRowCursor";

export interface SyncOptions {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  rng?: () => number;
  onStatus?: (s: SyncStatus) => void;
  /** Called with events that arrived from another device (for conflict toasts). */
  onRemoteEvents?: (events: SyncEvent[]) => void;
  maxBatch?: number;
}

class CorruptError extends Error { constructor(readonly eventId: string) { super(`same eventId ${eventId} with a different checksum`); } }

/**
 * Local-first batching: events are written to the outbox first; this class ships them to the remote log and
 * flips them to SYNCED only after reading the written rows back and matching eventId + checksum.
 */
export class SyncCoordinator {
  private status: SyncStatus = { state: "IDLE", pending: 0, remoteCursor: 0 };
  private busy: Promise<SyncStatus> | null = null;
  private lastFlushAt = -Infinity;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readOnly = false;
  private now: () => number; private sleep: (ms: number) => Promise<void>; private rng: () => number;

  constructor(private store: LocalStore, private remote: RemoteEventLog, private o: SyncOptions = {}) {
    this.now = o.now ?? Date.now;
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.rng = o.rng ?? Math.random;
  }

  get current(): SyncStatus { return this.status; }
  private set(p: Partial<SyncStatus>): void { this.status = { ...this.status, ...p }; this.o.onStatus?.(this.status); }
  private async refreshPending(): Promise<number> { const n = (await this.store.listPending()).length; this.set({ pending: n }); return n; }

  /** Call after every local write: flush at >= 20 pending, otherwise within 60 s. */
  async notifyChanged(): Promise<void> {
    const n = await this.refreshPending();
    if (this.readOnly) return;
    if (n >= SYNC.THRESHOLD) { void this.flush("threshold"); return; }
    if (n > 0 && !this.timer) this.timer = setTimeout(() => { this.timer = null; void this.flush("interval"); }, SYNC.INTERVAL_MS);
  }

  /** reason: threshold | interval | hidden | end | manual. Non-manual flushes respect the 10 s minimum interval. */
  flush(reason: "threshold" | "interval" | "hidden" | "end" | "manual"): Promise<SyncStatus> {
    if (this.busy) return this.busy;
    this.busy = this.run(reason).finally(() => { this.busy = null; });
    return this.busy;
  }

  private async run(reason: string): Promise<SyncStatus> {
    if (this.readOnly) return this.status;
    const since = this.now() - this.lastFlushAt;
    if (reason !== "manual" && reason !== "end" && since < SYNC.MIN_INTERVAL_MS) await this.sleep(SYNC.MIN_INTERVAL_MS - since);
    this.set({ state: "SYNCING", message: undefined, code: undefined });
    try {
      await this.pull();
      for (let guard = 0; ; guard++) {
        const batch = await this.store.listPending(this.o.maxBatch ?? SYNC.MAX_BATCH);
        if (!batch.length) break;
        const before = (await this.store.listPending()).length;
        await this.pushBatch(batch);
        // No verified ACK this round (rows not visible yet): stop instead of spinning; the next flush re-checks.
        if ((await this.store.listPending()).length >= before || guard > 1000) { this.set({ state: "PENDING", message: MSG.UNSURE }); this.lastFlushAt = this.now(); return this.status; }
        this.lastFlushAt = this.now();
        this.set({ state: "SYNCING", code: undefined, message: undefined });
      }
      const pending = await this.refreshPending();
      this.set({ state: pending ? "PENDING" : "IDLE", lastSyncedAt: new Date(this.now()).toISOString() });
    } catch (e) {
      await this.fail(e);
    }
    this.lastFlushAt = this.now();
    return this.status;
  }

  private async fail(e: unknown): Promise<void> {
    const n = await this.refreshPending();
    if (e instanceof CorruptError) { this.readOnly = true; this.set({ state: "READ_ONLY", code: "CORRUPT", message: MSG.NEW_SCHEMA }); return; }
    if (!(e instanceof GoogleError)) { this.set({ state: "ERROR", message: e instanceof Error ? e.message : String(e) }); return; }
    switch (e.code) {
      case "NEEDS_AUTH": this.set({ state: "NEEDS_AUTH", code: e.code, message: MSG.EXPIRED }); break;
      case "OFFLINE": this.set({ state: "OFFLINE", code: e.code, message: MSG.OFFLINE(n) }); break;
      case "RATE_LIMIT": this.set({ state: "RATE_LIMITED", code: e.code, message: MSG.QUOTA }); break;
      case "READ_ONLY": case "NO_SCOPE": case "NOT_FOUND": this.readOnly = true; this.set({ state: "READ_ONLY", code: e.code, message: e.message }); break;
      default: this.set({ state: "ERROR", code: e.code, message: e.message });
    }
  }

  /** Reads rows after the cursor; events written by other devices become local SYNCED events (idempotent). */
  async pull(): Promise<number> {
    let cursor = (await this.store.getMeta<number>(CURSOR_KEY)) ?? 0;
    let fresh = 0;
    for (;;) {
      const { events, nextCursor } = await this.remote.readEventsAfter(cursor, SYNC.PULL_CHUNK);
      const added: SyncEvent[] = [];
      for (const e of events) {
        try { if ((await this.store.appendEvent(e, "SYNCED")) === "ADDED") added.push(e); }
        catch { throw new CorruptError(e.eventId); }
      }
      if (added.length) { fresh += added.length; this.o.onRemoteEvents?.(added); }
      cursor = nextCursor;
      await this.store.setMeta(CURSOR_KEY, cursor);
      this.set({ remoteCursor: cursor });
      if (events.length < SYNC.PULL_CHUNK) break;
    }
    return fresh;
  }

  private async pushBatch(batch: SyncEvent[]): Promise<void> {
    const ids = new Set(batch.map((e) => e.eventId));
    let todo = batch;
    let unsure = 0, rate = 0;
    for (;;) {
      try {
        const range = await this.remote.appendEvents(todo);
        const back = await this.remote.readEventRows(range.firstRow, range.lastRow);
        const byId = new Map(back.map((e) => [e.eventId, e]));
        const ok: string[] = [];
        for (const e of todo) {
          const r = byId.get(e.eventId);
          if (!r) continue; // not visible yet: stays pending and is verified on the next pass
          if (r.checksum !== e.checksum) throw new CorruptError(e.eventId);
          ok.push(e.eventId);
        }
        await this.store.markSynced(ok, new Date(this.now()).toISOString());
        await this.refreshPending();
        return;
      } catch (e) {
        if (e instanceof GoogleError && e.code === "RATE_LIMIT") {
          if (++rate > SYNC.MAX_RATE_RETRIES) throw e;
          const wait = e.retryAfterMs ?? SYNC.BACKOFF_BASE_MS * 2 ** (rate - 1) * (0.5 + this.rng());
          this.set({ state: "RATE_LIMITED", code: "RATE_LIMIT", message: MSG.QUOTA });
          await this.sleep(wait);
          continue;
        }
        if (e instanceof GoogleError && e.code === "UNSURE") {
          // The write may or may not have happened. Look at the remote log (pull marks matching local events
          // SYNCED) BEFORE sending anything again, so a lost response never produces a duplicate row.
          if (++unsure > SYNC.MAX_UNSURE_RETRIES) throw e;
          this.set({ state: "SYNCING", message: MSG.UNSURE });
          await this.pull();
          const still = new Set((await this.store.listPending()).map((x) => x.eventId));
          todo = batch.filter((x) => ids.has(x.eventId) && still.has(x.eventId));
          if (!todo.length) { await this.refreshPending(); return; }
          continue;
        }
        throw e; // OFFLINE and everything else: next flush starts with pull(), which also resolves a lost response
      }
    }
  }
}
