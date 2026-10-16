import { checkEvent, dedupeEvents, type SyncEvent } from "./events";
import type { LocalStore } from "./interface";
import { SHEET_SCHEMA_VERSION, EVENT_SCHEMA_VERSION } from "../../../shared/sheetSchema";

export const BACKUP_FORMAT = "jlpt-backup";
export const BACKUP_FORMAT_VERSION = 1;
const MAX_BACKUP_BYTES = 50 * 1024 * 1024;

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  formatVersion: number;
  createdAt: string;
  appVersion: string;
  sheetSchemaVersion: number;
  eventSchemaVersion: number;
  profileId: string | null;
  /** Informational projections; the events are the source of truth. */
  settings?: unknown;
  examTarget?: unknown;
  contentPackRefs: { packId: string; packVersion: string }[];
  events: SyncEvent[];
}

const SECRET_KEYS = /token|secret|password|api[_-]?key|authorization/i;

export async function exportBackup(store: LocalStore, info: { appVersion: string; profileId: string | null; settings?: unknown; examTarget?: unknown; now?: Date }): Promise<BackupFile> {
  const events = (await store.listEvents()).map((s) => s.event);
  return {
    format: BACKUP_FORMAT, formatVersion: BACKUP_FORMAT_VERSION, createdAt: (info.now ?? new Date()).toISOString(), appVersion: info.appVersion,
    sheetSchemaVersion: SHEET_SCHEMA_VERSION, eventSchemaVersion: EVENT_SCHEMA_VERSION, profileId: info.profileId,
    settings: info.settings, examTarget: info.examTarget, contentPackRefs: [], events,
  };
}

export const backupFileName = (now = new Date()): string => `jlpt-backup_${now.toISOString().slice(0, 10).replace(/-/g, "")}.json`;

export interface ImportPreview {
  ok: boolean;
  fatal?: string;
  total: number;
  newEvents: number;
  duplicates: number;
  conflicts: string[];
  invalid: { index: number; reason: string }[];
  profileMismatch: boolean;
  toAdd: SyncEvent[];
}

/** Parses and checks a backup WITHOUT writing anything (preview first, then apply after the user approves). */
export async function previewImport(text: string, store: LocalStore, currentProfileId: string | null): Promise<ImportPreview> {
  const empty = (fatal: string): ImportPreview => ({ ok: false, fatal, total: 0, newEvents: 0, duplicates: 0, conflicts: [], invalid: [], profileMismatch: false, toAdd: [] });
  if (text.length > MAX_BACKUP_BYTES) return empty("백업 파일이 너무 큽니다.");
  let data: any;
  try { data = JSON.parse(text); } catch { return empty("JSON 형식이 아닙니다."); }
  if (data?.format !== BACKUP_FORMAT) return empty("이 앱의 백업 파일이 아닙니다.");
  if (typeof data.formatVersion !== "number" || data.formatVersion > BACKUP_FORMAT_VERSION) return empty("지원하지 않는 백업 버전입니다. 앱을 최신으로 업데이트하세요.");
  if (typeof data.eventSchemaVersion === "number" && data.eventSchemaVersion > EVENT_SCHEMA_VERSION) return empty("앱 데이터 버전을 확인할 수 없어 쓰기를 중단했습니다.");
  if (!Array.isArray(data.events)) return empty("events 목록이 없습니다.");

  const invalid: ImportPreview["invalid"] = [];
  const valid: SyncEvent[] = [];
  data.events.forEach((e: unknown, index: number) => {
    const p = checkEvent(e);
    if (p) invalid.push({ index, reason: p }); else valid.push(e as SyncEvent);
  });
  const inFile = dedupeEvents(valid);
  const existing = new Map((await store.listEvents()).map((s) => [s.event.eventId, s.event]));
  const toAdd: SyncEvent[] = [];
  const conflicts = [...inFile.conflicts];
  let duplicates = inFile.duplicates;
  for (const e of inFile.unique) {
    const prev = existing.get(e.eventId);
    if (!prev) toAdd.push(e);
    else if (prev.checksum === e.checksum) duplicates++;
    else conflicts.push(e.eventId);
  }
  const profileMismatch = !!(currentProfileId && data.profileId && data.profileId !== currentProfileId);
  return { ok: true, total: data.events.length, newEvents: toAdd.length, duplicates, conflicts, invalid, profileMismatch, toAdd };
}

/** Applies a previewed import. Conflicting/invalid events are never written. */
export async function applyImport(store: LocalStore, preview: ImportPreview): Promise<{ added: number; skipped: number }> {
  if (!preview.ok) throw new Error("preview is not importable");
  let added = 0, skipped = 0;
  for (const e of preview.toAdd) {
    try { (await store.appendEvent(e)) === "ADDED" ? added++ : skipped++; } catch { skipped++; }
  }
  return { added, skipped };
}

/** Defensive scan used by tests: a backup must never contain credential-looking keys. */
export function containsSecretKeys(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsSecretKeys);
  if (value && typeof value === "object") return Object.entries(value).some(([k, v]) => SECRET_KEYS.test(k) || containsSecretKeys(v));
  return false;
}
