import type { ContentRecord } from "../../../shared/schema";
import type { SyncEvent } from "../storage/events";

export interface FlagInfo { contentId: string; reason: string; note?: string; flaggedAt: string; contentVersion?: number; contentHash?: string }

/** Items the learner reported (CONTENT_FLAGGED) or that were retired (ENTITY_TOMBSTONED). */
export function flagProjection(events: SyncEvent[]): { flagged: Map<string, FlagInfo>; retired: Set<string> } {
  const flagged = new Map<string, FlagInfo>();
  const retired = new Set<string>();
  for (const e of events) {
    const p = JSON.parse(e.payloadJson);
    if (e.type === "CONTENT_FLAGGED" && typeof p.contentId === "string" && !flagged.has(p.contentId)) flagged.set(p.contentId, { contentId: p.contentId, reason: String(p.reason ?? "OTHER"), note: p.note, flaggedAt: e.occurredAt, contentVersion: p.contentVersion, contentHash: p.contentHash });
    if (e.type === "ENTITY_TOMBSTONED" && typeof p.contentId === "string") retired.add(p.contentId);
  }
  return { flagged, retired };
}

export type EffectiveStatus = "VERIFIED" | "UNVERIFIED" | "FLAGGED" | "RETIRED";
export function effectiveStatus(r: ContentRecord, fp: ReturnType<typeof flagProjection>): EffectiveStatus {
  if (fp.retired.has(r.contentId) || r.verification.status === "RETIRED") return "RETIRED";
  if (fp.flagged.has(r.contentId) || r.verification.status === "FLAGGED") return "FLAGGED";
  return r.verification.status === "VERIFIED" ? "VERIFIED" : "UNVERIFIED";
}

/**
 * One active version per contentId: the highest VERIFIED version, otherwise the highest version.
 * A newer version that is not VERIFIED stays a (inactive) candidate while a VERIFIED older one exists.
 */
export function activeVersions(rows: ContentRecord[]): ContentRecord[] {
  const by = new Map<string, ContentRecord[]>();
  for (const r of rows) (by.get(r.contentId) ?? by.set(r.contentId, []).get(r.contentId)!).push(r);
  const out: ContentRecord[] = [];
  for (const list of by.values()) {
    const sorted = [...list].sort((a, b) => b.contentVersion - a.contentVersion);
    out.push(sorted.find((r) => r.verification.status === "VERIFIED") ?? sorted[0]!);
  }
  return out;
}

/** Content the learner may study: active version, not flagged/retired, VERIFIED (or UNVERIFIED when the toggle is on). */
export function studyPool(rows: ContentRecord[], fp: ReturnType<typeof flagProjection>, includeUnverified: boolean): ContentRecord[] {
  return activeVersions(rows).filter((r) => {
    const s = effectiveStatus(r, fp);
    return s === "VERIFIED" || (includeUnverified && s === "UNVERIFIED");
  });
}
