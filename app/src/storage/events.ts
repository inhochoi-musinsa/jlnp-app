import { canonicalJSON } from "../../../shared/normalize";
import { sha256Hex } from "../../../shared/hash";
import { EVENT_SCHEMA_VERSION, EVENT_TYPES, type EventType } from "../../../shared/sheetSchema";

export interface SyncEvent {
  eventId: string;
  profileId: string;
  deviceId: string;
  deviceSeq: number;
  occurredAt: string; // UTC ISO
  type: EventType;
  entityId: string;
  eventSchemaVersion: number;
  payloadJson: string;
  checksum: string;
}

export function uuid(): string {
  const c: Crypto | undefined = typeof crypto !== "undefined" ? crypto : undefined;
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(b); else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6]! & 0x0f) | 0x40; b[8] = (b[8]! & 0x3f) | 0x80;
  const x = Array.from(b, (v) => v.toString(16).padStart(2, "0")).join("");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

type Body = Omit<SyncEvent, "checksum">;
export const eventChecksum = (e: Body): string =>
  sha256Hex(canonicalJSON({ eventId: e.eventId, profileId: e.profileId, deviceId: e.deviceId, deviceSeq: e.deviceSeq, occurredAt: e.occurredAt, type: e.type, entityId: e.entityId, eventSchemaVersion: e.eventSchemaVersion, payloadJson: e.payloadJson }));

export function createEvent(input: { profileId: string; deviceId: string; deviceSeq: number; type: EventType; entityId: string; payload: unknown; now?: Date; eventId?: string }): SyncEvent {
  const body: Body = {
    eventId: input.eventId ?? uuid(), profileId: input.profileId, deviceId: input.deviceId, deviceSeq: input.deviceSeq,
    occurredAt: (input.now ?? new Date()).toISOString(), type: input.type, entityId: input.entityId,
    eventSchemaVersion: EVENT_SCHEMA_VERSION, payloadJson: canonicalJSON(input.payload),
  };
  return { ...body, checksum: eventChecksum(body) };
}

export type EventProblem = "SHAPE" | "TYPE" | "CHECKSUM";
/** Validates shape and recomputes the checksum. */
export function checkEvent(e: unknown): EventProblem | null {
  if (typeof e !== "object" || e === null) return "SHAPE";
  const r = e as Record<string, unknown>;
  const strs = ["eventId", "profileId", "deviceId", "occurredAt", "type", "entityId", "payloadJson", "checksum"];
  if (!strs.every((k) => typeof r[k] === "string" && (r[k] as string).length > 0)) return "SHAPE";
  if (!Number.isInteger(r.deviceSeq) || !Number.isInteger(r.eventSchemaVersion)) return "SHAPE";
  if (!(EVENT_TYPES as readonly string[]).includes(r.type as string)) return "TYPE";
  const { checksum, ...body } = r as unknown as SyncEvent;
  return eventChecksum(body) === checksum ? null : "CHECKSUM";
}

export class IntegrityConflictError extends Error {
  constructor(readonly eventId: string) { super(`INTEGRITY_CONFLICT: eventId ${eventId} exists with a different checksum`); }
}

/** Idempotent projection input: one event per eventId; the same id with another checksum is a conflict. */
export function dedupeEvents(events: SyncEvent[]): { unique: SyncEvent[]; duplicates: number; conflicts: string[] } {
  const seen = new Map<string, SyncEvent>();
  let duplicates = 0;
  const conflicts: string[] = [];
  for (const e of events) {
    const prev = seen.get(e.eventId);
    if (!prev) seen.set(e.eventId, e);
    else if (prev.checksum === e.checksum) duplicates++;
    else conflicts.push(e.eventId);
  }
  return { unique: [...seen.values()], duplicates, conflicts };
}

/** Deterministic replay order: occurredAt, then deviceId, then deviceSeq, then eventId. */
export const replayOrder = (a: SyncEvent, b: SyncEvent): number =>
  a.occurredAt < b.occurredAt ? -1 : a.occurredAt > b.occurredAt ? 1
  : a.deviceId < b.deviceId ? -1 : a.deviceId > b.deviceId ? 1
  : a.deviceSeq - b.deviceSeq || (a.eventId < b.eventId ? -1 : 1);
