import type { SyncEvent } from "./events";
import type { ContentRecord } from "../../../shared/schema";

export type SyncStatus = "PENDING" | "SYNCED";
export interface StoredEvent { event: SyncEvent; status: SyncStatus; syncedAt?: string }

export type SnapshotReason = "MANUAL" | "BEFORE_RESTORE" | "AFTER_UPGRADE";
/** A local recovery point: a complete JSON backup kept inside the device database (never deleted by a restore). */
export interface Snapshot { id: string; createdAt: string; reason: SnapshotReason; appVersion: string; eventCount: number; fromDbVersion?: number; backup: string }

/** Device cache + outbox. `kind` tells the UI whether data survives a reload. */
export interface LocalStore {
  readonly kind: "indexeddb" | "memory";
  /** Adds the event as PENDING. Same id + same checksum is a no-op; another checksum throws IntegrityConflictError. */
  appendEvent(e: SyncEvent, status?: SyncStatus): Promise<"ADDED" | "DUPLICATE">;
  listEvents(): Promise<StoredEvent[]>;
  listPending(limit?: number): Promise<SyncEvent[]>;
  markSynced(eventIds: string[], at: string): Promise<void>;
  getMeta<T = unknown>(key: string): Promise<T | undefined>;
  setMeta(key: string, value: unknown): Promise<void>;
  /** Content cache (rows pulled from the sheet or imported). Key: contentId@contentVersion. */
  putContent(records: ContentRecord[]): Promise<void>;
  listContent(): Promise<ContentRecord[]>;
  putSnapshot(s: Snapshot): Promise<void>;
  listSnapshots(): Promise<Snapshot[]>;
  deleteSnapshot(id: string): Promise<void>;
  /** Explicit, user-confirmed deletion only. */
  clearAll(): Promise<void>;
}

export interface AppendRange { firstRow: number; lastRow: number } // 1-based data rows (header excluded)

/** Remote event log (Sheets `_JLPT_EVENTS`). The real adapter arrives in T07; tests use MockSheetsAdapter. */
export interface RemoteEventLog {
  appendEvents(events: SyncEvent[]): Promise<AppendRange>;
  readEventRows(firstRow: number, lastRow: number): Promise<SyncEvent[]>;
  readEventsAfter(rowCursor: number, limit: number): Promise<{ events: SyncEvent[]; nextCursor: number }>;
  rowCount(): Promise<number>;
}
