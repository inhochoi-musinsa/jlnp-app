import { DEFAULT_TARGET_LEVEL, type Level } from "../../../shared/examSpec";

export type ExamMonth = 7 | 12;
export type DateStatus = "NOT_SELECTED" | "EXPECTED" | "CONFIRMED";

export interface ExamTarget {
  level: Level;
  targetYear: number | null;
  targetMonth: ExamMonth | null;
  expectedExamDate: string | null;
  confirmedExamDate: string | null;
  dateStatus: DateStatus;
  sourceUrl: string | null;
  sourceVerifiedAt: string | null;
  changedByEventId: string | null;
}

const pad = (n: number) => String(n).padStart(2, "0");
const utc = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d);
export const parseDay = (s: string): number => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) throw new Error(`invalid date ${s}`);
  return utc(+m[1]!, +m[2]!, +m[3]!);
};
const fmt = (t: number) => {
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};

/** Calendar day (YYYY-MM-DD) in the given IANA zone; never uses UTC for the day. */
export function todayKey(now: Date, timeZone = "Asia/Seoul"): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** First Sunday of the month. A scheduling rule, not an official announcement. */
export function firstSundayOf(year: number, month: number): string {
  const first = utc(year, month, 1);
  const iso = new Date(first).getUTCDay() || 7; // Sunday = 7
  return fmt(first + ((7 - iso) % 7) * 86400000);
}

export const isExamMonth = (m: unknown): m is ExamMonth => m === 7 || m === 12;

export function daysBetween(fromDay: string, toDay: string): number {
  return Math.round((parseDay(toDay) - parseDay(fromDay)) / 86400000);
}

export function makeExamTarget(level: Level, year: number | null, month: number | null, confirmedExamDate: string | null = null, changedByEventId: string | null = null): ExamTarget {
  if (year === null || month === null) {
    return { level, targetYear: null, targetMonth: null, expectedExamDate: null, confirmedExamDate: null, dateStatus: "NOT_SELECTED", sourceUrl: null, sourceVerifiedAt: null, changedByEventId };
  }
  if (!isExamMonth(month) || !Number.isInteger(year)) throw new Error("month must be 7 or 12 and year an integer");
  return {
    level, targetYear: year, targetMonth: month, expectedExamDate: firstSundayOf(year, month), confirmedExamDate,
    dateStatus: confirmedExamDate ? "CONFIRMED" : "EXPECTED", sourceUrl: null, sourceVerifiedAt: null, changedByEventId,
  };
}

export const effectiveDate = (t: ExamTarget): string | null => t.confirmedExamDate ?? t.expectedExamDate;

/** The session is no longer a valid future target when its date is today or earlier. */
export function isPastSession(todayDay: string, year: number, month: number): boolean {
  return daysBetween(todayDay, firstSundayOf(year, month)) <= 0;
}

/**
 * Study days from today (inclusive) through the day before the exam.
 * restIsoWeekdays: ISO weekdays (1=Mon..7=Sun) the learner never studies.
 */
export function eligibleDays(todayDay: string, examDay: string | null, restIsoWeekdays: number[] = []): number {
  if (!examDay) return 0;
  const n = daysBetween(todayDay, examDay);
  if (n <= 0) return 0;
  if (restIsoWeekdays.length === 0) return n;
  let count = 0;
  const start = parseDay(todayDay);
  for (let i = 0; i < n; i++) {
    const iso = new Date(start + i * 86400000).getUTCDay() || 7;
    if (!restIsoWeekdays.includes(iso)) count++;
  }
  return count;
}

/** Arithmetic ceiling at 60 min/day; not a pass-time estimate. */
export const maximumRemainingMinutes = (days: number, dailyBudgetMinutes = 60): number => days * dailyBudgetMinutes;

import { replayOrder, type SyncEvent } from "../storage/events";

/** ExamTarget as of the event log: the latest EXAM_TARGET_SELECTED wins, then EXAM_NOTICE_VERIFIED fills the official date. */
export function projectExamTarget(events: SyncEvent[], level: Level): ExamTarget {
  let t = makeExamTarget(level, null, null);
  for (const e of [...events].sort(replayOrder)) {
    const p = JSON.parse(e.payloadJson);
    if (e.type === "EXAM_TARGET_SELECTED") {
      t = { ...makeExamTarget(p.level ?? level, p.year ?? null, p.month ?? null, null, e.eventId) };
    } else if (e.type === "EXAM_NOTICE_VERIFIED" && t.targetYear === p.year && t.targetMonth === p.month && typeof p.confirmedExamDate === "string") {
      t = { ...t, confirmedExamDate: p.confirmedExamDate, dateStatus: "CONFIRMED", sourceUrl: p.sourceUrl ?? null, sourceVerifiedAt: e.occurredAt };
    }
  }
  return t;
}

export interface TargetOption { eventId: string; level: Level; year: number | null; month: number | null; at: string; deviceId: string }

/** `basedOn` of a target event: the head event id(s) the device saw when the learner chose; absent on events from before v4. */
const basedOnOf = (p: Record<string, unknown>): string[] | undefined =>
  p.basedOn === undefined ? undefined : Array.isArray(p.basedOn) ? (p.basedOn as unknown[]).filter((x): x is string => typeof x === "string") : typeof p.basedOn === "string" ? [p.basedOn] : [];

/**
 * Target events nobody has superseded yet. One head is the normal case. Two or more heads with different values mean two
 * devices changed the target without having seen each other: the learner must choose (plan.md §6.2); nothing is overwritten
 * meanwhile (the log is append-only) and the latest head is used as the provisional target.
 * Events without `basedOn` (written before v4.0.0) are treated as a chain ordered by time, exactly as before.
 */
export function targetHeads(events: SyncEvent[]): TargetOption[] {
  const list = events.filter((e) => e.type === "EXAM_TARGET_SELECTED").sort(replayOrder);
  const referenced = new Set<string>();
  list.forEach((e, i) => {
    const p = JSON.parse(e.payloadJson) as Record<string, unknown>;
    const b = basedOnOf(p);
    for (const id of b ?? (i > 0 ? [list[i - 1]!.eventId] : [])) referenced.add(id);
  });
  return list.filter((e) => !referenced.has(e.eventId)).map((e) => {
    const p = JSON.parse(e.payloadJson) as { level?: Level; year?: number | null; month?: number | null };
    return { eventId: e.eventId, level: p.level ?? DEFAULT_TARGET_LEVEL, year: p.year ?? null, month: p.month ?? null, at: e.occurredAt, deviceId: e.deviceId };
  });
}

/** Distinct competing options (same level/year/month from two devices is not a conflict), or null. */
export function targetConflict(events: SyncEvent[]): { options: TargetOption[]; headIds: string[] } | null {
  const heads = targetHeads(events);
  const seen = new Map<string, TargetOption>();
  for (const h of heads) { const k = `${h.level}|${h.year}|${h.month}`; if (!seen.has(k)) seen.set(k, h); }
  return seen.size > 1 ? { options: [...seen.values()], headIds: heads.map((h) => h.eventId) } : null;
}

