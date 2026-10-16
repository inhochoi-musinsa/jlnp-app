import type { SyncEvent } from "../storage/events";
import { replayOrder } from "../storage/events";
import { daysBetween, parseDay } from "./target";

export type Direction = "READING" | "MEANING" | "AUDIO" | "CLOZE";
export const STAGES = [0, 1, 2, 3, 4] as const;
export type Stage = 0 | 1 | 2 | 3 | 4;
export const STAGE_NAME: Record<Stage, string> = { 0: "새 항목", 1: "학습 중", 2: "익숙함", 3: "거의 숙달", 4: "숙달" };

/** execution_plan §6.1: interval (days) after a CORRECT answer at each current stage; the stage it moves to. */
export const NEXT_ON_CORRECT: Record<Stage, { stage: Stage; days: number }> = {
  0: { stage: 1, days: 1 }, 1: { stage: 2, days: 3 }, 2: { stage: 3, days: 7 }, 3: { stage: 4, days: 21 }, 4: { stage: 4, days: 21 },
};

export interface CardState {
  key: string;                 // `${contentId}#${direction}`
  contentId: string;
  direction: Direction;
  stage: Stage;
  dueAt: string | null;        // YYYY-MM-DD; null while the card has never been answered
  lastAnswerWrong: boolean;
  lastReviewedDay: string | null;
  /** first day the card was answered (to count "new today") */
  firstDay: string | null;
  /** most recent answers, newest last (max 5) */
  recent: boolean[];
  /** scheduled interval of the last answer in days (for the overdue ratio) */
  intervalDays: number;
  reviews: number;
}

export const cardKey = (contentId: string, d: Direction) => `${contentId}#${d}`;
export const newCard = (contentId: string, direction: Direction): CardState => ({ key: cardKey(contentId, direction), contentId, direction, stage: 0, dueAt: null, lastAnswerWrong: false, lastReviewedDay: null, firstDay: null, recent: [], intervalDays: 1, reviews: 0 });

const addDays = (day: string, n: number): string => {
  const d = new Date(parseDay(day) + n * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
};
export { addDays };

export interface Answer { correct: boolean; day: string; /** second attempt of the same card in the same session */ retry?: boolean }

/**
 * The single review rule (execution_plan §6.1).
 * - correct: stage rises one step (4 stays 4); next due after 1/3/7/21/21 days.
 * - wrong: stage = max(1, stage - 1), lastAnswerWrong = true, due the next day (and the session asks it once more).
 * - retry (second attempt, same session): never changes the stage or the due date; it only settles lastAnswerWrong.
 */
export function applyAnswer(c: CardState, a: Answer): CardState {
  const recent = [...c.recent, a.correct].slice(-5);
  const base = { ...c, recent, lastReviewedDay: a.day, firstDay: c.firstDay ?? a.day, reviews: c.reviews + 1 };
  if (a.retry) return { ...base, lastAnswerWrong: !a.correct };
  if (a.correct) {
    const n = NEXT_ON_CORRECT[c.stage];
    return { ...base, stage: n.stage, dueAt: addDays(a.day, n.days), intervalDays: n.days, lastAnswerWrong: false };
  }
  return { ...base, stage: Math.max(1, c.stage - 1) as Stage, dueAt: addDays(a.day, 1), intervalDays: 1, lastAnswerWrong: true };
}

/** "Review target" = due today or earlier, or the last answer was wrong and it was not already handled today. */
export function isDue(c: CardState, today: string): boolean {
  if (c.dueAt !== null && c.dueAt <= today) return true;
  return c.lastAnswerWrong && c.lastReviewedDay !== today;
}

/** recent wrong ratio (last 5) + 0.25 × overdue ratio (days past due / scheduled interval, capped at 1). */
export function weaknessScore(c: CardState, today: string): number {
  if (!c.recent.length) return 0;
  const wrong = c.recent.filter((x) => !x).length / c.recent.length;
  const overdue = c.dueAt && c.dueAt < today ? Math.min(1, daysBetween(c.dueAt, today) / Math.max(1, c.intervalDays)) : 0;
  return wrong + 0.25 * overdue;
}

export interface CardEventPayload { contentId: string; direction: Direction; correct: boolean; dayKey: string; retry?: boolean; elapsedActiveMs?: number }

/** Replays CARD_REVIEWED events in deterministic order; duplicates (same eventId) were already removed by the store. */
export function replayCards(events: SyncEvent[]): Map<string, CardState> {
  const cards = new Map<string, CardState>();
  for (const e of [...events].sort(replayOrder)) {
    if (e.type !== "CARD_REVIEWED") continue;
    const p = JSON.parse(e.payloadJson) as CardEventPayload;
    if (!p.contentId || !p.direction || typeof p.dayKey !== "string") continue;
    const k = cardKey(p.contentId, p.direction);
    cards.set(k, applyAnswer(cards.get(k) ?? newCard(p.contentId, p.direction), { correct: !!p.correct, day: p.dayKey, retry: !!p.retry }));
  }
  return cards;
}

/** Word-level stage for display: the weakest direction wins; a word with no answered card is stage 0. */
export function wordStage(cards: Map<string, CardState>, contentId: string, directions: Direction[]): Stage {
  const seen = directions.map((d) => cards.get(cardKey(contentId, d))).filter((c): c is CardState => !!c && c.reviews > 0);
  return seen.length ? (Math.min(...seen.map((c) => c.stage)) as Stage) : 0;
}

export function stageDistribution(stages: Stage[]): Record<Stage, number> {
  const d: Record<Stage, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const s of stages) d[s]++;
  return d;
}

export const DEFAULT_SECONDS_PER_CARD = 25;
export const REVIEW_LIMIT_MINUTES = 25;

/** Average seconds per answered card from the learner's own recent events (clamped), else the 25 s default. */
export function observedSecondsPerCard(events: SyncEvent[]): number {
  const ms: number[] = [];
  for (const e of events) if (e.type === "CARD_REVIEWED") { const p = JSON.parse(e.payloadJson); if (typeof p.elapsedActiveMs === "number" && p.elapsedActiveMs > 0) ms.push(p.elapsedActiveMs); }
  const last = ms.slice(-50);
  if (last.length < 5) return DEFAULT_SECONDS_PER_CARD;
  const avg = last.reduce((a, b) => a + b, 0) / last.length / 1000;
  return Math.min(120, Math.max(5, Math.round(avg)));
}

export interface QueueInput {
  /** all cards that can currently be asked (state may be fresh) */
  cards: CardState[];
  today: string;
  dailyNewCap: number;
  secondsPerCard: number;
  /** minutes left today (plan budget); the queue never exceeds it */
  availableMinutes: number;
  /** new cards the learner already started today */
  newToday?: number;
}

export interface ReviewQueue {
  due: CardState[];
  fresh: CardState[];
  weak: CardState[];
  expectedDueMinutes: number;
  /** due cards first (weakest first), then new cards; trimmed to the time budget */
  session: CardState[];
  newAllowed: number;
  reason: string;
}

/** §6.1/6.3: due items first; if the expected review time exceeds 25 min no NEW cards are introduced. */
export function buildQueue(i: QueueInput): ReviewQueue {
  const answered = i.cards.filter((c) => c.reviews > 0 || c.dueAt !== null);
  const due = answered.filter((c) => isDue(c, i.today)).sort((a, b) => weaknessScore(b, i.today) - weaknessScore(a, i.today) || (a.dueAt ?? "").localeCompare(b.dueAt ?? "") || a.key.localeCompare(b.key));
  const fresh = i.cards.filter((c) => c.reviews === 0 && c.dueAt === null).sort((a, b) => a.key.localeCompare(b.key));
  const weak = answered.filter((c) => weaknessScore(c, i.today) > 0).sort((a, b) => weaknessScore(b, i.today) - weaknessScore(a, i.today) || a.key.localeCompare(b.key));
  const expectedDueMinutes = (due.length * i.secondsPerCard) / 60;
  const overloaded = expectedDueMinutes > REVIEW_LIMIT_MINUTES;
  const newAllowed = overloaded ? 0 : Math.max(0, i.dailyNewCap - (i.newToday ?? 0));
  const budgetCards = Math.max(0, Math.floor((i.availableMinutes * 60) / i.secondsPerCard));
  const chosenDue = due.slice(0, budgetCards);
  const chosenNew = fresh.slice(0, Math.min(newAllowed, Math.max(0, budgetCards - chosenDue.length)));
  const reason = overloaded ? "복습이 많아 오늘은 새 항목을 추가하지 않습니다." : due.length ? "기한이 된 항목과 최근 틀린 항목을 먼저 복습합니다." : "복습할 항목이 없어 새 항목을 시작합니다.";
  return { due, fresh, weak, expectedDueMinutes, session: [...chosenDue, ...chosenNew], newAllowed, reason };
}
