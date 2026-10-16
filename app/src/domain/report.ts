import type { SyncEvent } from "../storage/events";
import { daysBetween, todayKey } from "./target";

export interface DayMinutes { day: string; minutes: number }

/** Active study minutes per calendar day for the last `days` days (oldest first), from STUDY_INTERVAL_COMPLETED events. */
export function dailyMinutes(events: SyncEvent[], today: string, days = 28): DayMinutes[] {
  const sec = new Map<string, number>();
  for (const e of events) {
    if (e.type !== "STUDY_INTERVAL_COMPLETED") continue;
    const p = JSON.parse(e.payloadJson);
    if (typeof p.dayKey === "string") sec.set(p.dayKey, (sec.get(p.dayKey) ?? 0) + (Number(p.seconds) || 0));
  }
  const base = Date.parse(`${today}T00:00:00Z`);
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(base - (days - 1 - i) * 86400000).toISOString().slice(0, 10);
    return { day: d, minutes: Math.round((sec.get(d) ?? 0) / 60) };
  });
}

export const studiedDays = (m: DayMinutes[]): number => m.filter((d) => d.minutes > 0).length;

export interface OfficialResult { level: string; year: number; month: number; sectionScores: Record<string, number>; passed: boolean | null; reportedAt: string }
/** What the learner typed in about a real exam; stored as given and never combined with app accuracy. */
export function officialResults(events: SyncEvent[]): OfficialResult[] {
  const out: OfficialResult[] = [];
  for (const e of events) {
    if (e.type !== "OFFICIAL_RESULT_REPORTED") continue;
    const p = JSON.parse(e.payloadJson);
    if (p.source !== "USER_DECLARED") continue;
    out.push({ level: String(p.level), year: Number(p.year), month: Number(p.month), sectionScores: p.sectionScores ?? {}, passed: typeof p.passed === "boolean" ? p.passed : null, reportedAt: e.occurredAt });
  }
  return out;
}
export { daysBetween, todayKey };
