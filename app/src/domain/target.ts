import type { Level } from "../../../shared/examSpec";

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
