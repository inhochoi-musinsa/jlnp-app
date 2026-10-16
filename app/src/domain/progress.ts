import type { ContentRecord } from "../../../shared/schema";
import type { SyncEvent } from "../storage/events";
import type { Route } from "./diagnostic";

export type Area = "KANA" | "VOCAB" | "GRAMMAR" | "READING" | "LISTENING";
/** Areas that can actually be studied in this app version; extended as features ship (reading v2, listening v2). */
export const ACTIVE_AREAS: Area[] = ["VOCAB", "GRAMMAR", "READING"];
export const DAILY_NEW_CAP: Record<Route, number> = { KANA_FOUNDATION: 5, FOUNDATION: 10, TARGET_FOCUS: 15 };
export const RUNWAY_WARN_DAYS = 14;
/** New grammar points per day (principles take time). `[실무 제안]` */
export const GRAMMAR_NEW_PER_DAY = 1;
/** New reading passages per day (each comes with its questions). `[실무 제안]` */
export const READING_NEW_PER_DAY = 1;
export const dailyIntake = (route: Route | null): Record<Area, number> => ({ KANA: 0, VOCAB: DAILY_NEW_CAP[route ?? "FOUNDATION"], GRAMMAR: GRAMMAR_NEW_PER_DAY, READING: READING_NEW_PER_DAY, LISTENING: 0 });

const DOMAIN_AREA: Record<string, Area> = {
  KANA: "KANA", READING_KANJI: "VOCAB", ORTHOGRAPHY: "VOCAB", CONTEXT: "VOCAB", PARAPHRASE: "VOCAB", USAGE: "VOCAB",
  GRAMMAR_FORM: "GRAMMAR", SENTENCE_ORDER: "GRAMMAR", TEXT_GRAMMAR: "GRAMMAR", READING_Q: "READING", LISTENING_Q: "LISTENING",
};
export const areaOfQuestion = (r: ContentRecord): Area => DOMAIN_AREA[String(r.payload.domain)] ?? "VOCAB";

export interface Runway { perArea: Partial<Record<Area, { unseen: number; days: number }>>; days: number; limitingArea: Area | null; dailyCap: number; needsContent: boolean }

/**
 * Runway = for every studyable area, (unseen new items / daily new cap); the smallest value is the runway.
 * `pool` must already be the study pool (active, verified, not flagged).
 */
export function computeRunway(pool: ContentRecord[], events: SyncEvent[], route: Route | null, opts: { unseenVocabWords?: number; unseenGrammarPoints?: number; areas?: Area[] } = {}): Runway {
  const seen = new Set<string>();
  const reviewed = new Set<string>();
  for (const e of events) {
    const p = JSON.parse(e.payloadJson);
    if ((e.type === "QUESTION_PRESENTED" || e.type === "QUESTION_SUBMITTED") && p.contentId) { seen.add(p.contentId); if (p.refId) seen.add(p.refId); if (p.stimulusId) seen.add(p.stimulusId); }
    if (e.type === "CARD_REVIEWED" && p.contentId) reviewed.add(p.contentId);
  }
  const questionsOf = (parent: string) => pool.filter((r) => r.kind === "QUESTION" && (r.payload.linkedContentId === parent || r.payload.stimulusId === parent));
  const unseen: Record<Area, number> = { KANA: 0, VOCAB: 0, GRAMMAR: 0, READING: 0, LISTENING: 0 };
  for (const r of pool) {
    if (r.pool !== "LEARN") continue;
    if (r.kind === "VOCAB" || r.kind === "KANJI") { if (!reviewed.has(r.contentId)) unseen.VOCAB++; }
    else if (r.kind === "GRAMMAR") { if (!questionsOf(r.contentId).some((q) => seen.has(q.contentId))) unseen.GRAMMAR++; }
    else if (r.kind === "PASSAGE") { if (!seen.has(r.contentId)) unseen.READING++; }
    else if (r.kind === "LISTENING") { if (!seen.has(r.contentId)) unseen.LISTENING++; }
    else if (r.kind === "KANA") { if (!reviewed.has(r.contentId)) unseen.KANA++; }
  }
  if (opts.unseenVocabWords !== undefined) unseen.VOCAB = opts.unseenVocabWords;
  if (opts.unseenGrammarPoints !== undefined) unseen.GRAMMAR = opts.unseenGrammarPoints + (pool.filter((r) => r.kind === "QUESTION" && r.pool === "LEARN" && !r.payload.linkedContentId && areaOfQuestion(r) === "GRAMMAR" && !seen.has(r.contentId)).length);
  const intake = dailyIntake(route);
  const dailyCap = intake.VOCAB;
  const perArea: Runway["perArea"] = {};
  let days = Infinity; let limiting: Area | null = null;
  for (const a of opts.areas ?? ACTIVE_AREAS) {
    const d = Math.floor(unseen[a] / Math.max(1, intake[a]));
    perArea[a] = { unseen: unseen[a], days: d };
    if (d < days) { days = d; limiting = a; }
  }
  if (!Number.isFinite(days)) days = 0;
  return { perArea, days, limitingArea: limiting, dailyCap, needsContent: days < RUNWAY_WARN_DAYS };
}

export interface ProgressExport {
  format: "jlpt-progress";
  formatVersion: 1;
  createdAt: string;
  appVersion: string;
  level: string;
  route: Route | null;
  dailyNewCap: number;
  /** accuracy per area: n answered, k correct (aggregates only) */
  accuracy: Partial<Record<Area, { n: number; k: number }>>;
  wrongByTag: Record<string, number>;
  unseen: Partial<Record<Area, number>>;
  reviewBacklog: { due: number; note: string };
  runway: { days: number; limitingArea: Area | null; perArea: Runway["perArea"] };
}

const STANDARD_TAG = /^[A-Z][A-Z0-9_]{2,40}$/;

/** What `content:plan` needs, and nothing personal: no sheet URL, account, token, event ids or per-question history. */
export function buildProgress(o: { records: ContentRecord[]; pool: ContentRecord[]; events: SyncEvent[]; level: string; route: Route | null; appVersion: string; now?: Date }): ProgressExport {
  const byId = new Map(o.records.map((r) => [r.contentId, r]));
  const accuracy: ProgressExport["accuracy"] = {};
  const wrongByTag: Record<string, number> = {};
  const counted = new Set<string>();
  for (const e of o.events) {
    if (e.type !== "QUESTION_SUBMITTED") continue;
    const p = JSON.parse(e.payloadJson);
    const q = byId.get(p.contentId);
    if (!q || q.kind !== "QUESTION") continue;
    const key = `${p.contentId}|${e.eventId}`;
    if (counted.has(key)) continue;
    counted.add(key);
    const a = areaOfQuestion(q);
    const cell = (accuracy[a] ??= { n: 0, k: 0 });
    cell.n++;
    if (p.isCorrect) cell.k++;
    else for (const t of q.tags) if (STANDARD_TAG.test(t)) wrongByTag[t] = (wrongByTag[t] ?? 0) + 1;
  }
  const rw = computeRunway(o.pool, o.events, o.route);
  return {
    format: "jlpt-progress", formatVersion: 1, createdAt: (o.now ?? new Date()).toISOString(), appVersion: o.appVersion, level: o.level, route: o.route,
    dailyNewCap: rw.dailyCap, accuracy, wrongByTag,
    unseen: Object.fromEntries(ACTIVE_AREAS.map((a) => [a, rw.perArea[a]?.unseen ?? 0])),
    reviewBacklog: { due: 0, note: "복습 엔진(v1.0.0) 전에는 0으로 기록됩니다" },
    runway: { days: rw.days, limitingArea: rw.limitingArea, perArea: rw.perArea },
  };
}

export interface FlagsExport { format: "jlpt-flags"; formatVersion: 1; createdAt: string; flags: { contentId: string; contentVersion?: number; contentHash?: string; reason: string; note?: string; flaggedAt: string }[] }
export function buildFlagsExport(flags: { contentId: string; contentVersion?: number; contentHash?: string; reason: string; note?: string; flaggedAt: string }[], now = new Date()): FlagsExport {
  return { format: "jlpt-flags", formatVersion: 1, createdAt: now.toISOString(), flags };
}
export const FLAG_REASONS = ["정답 오류", "해설 오류", "부자연스러운 일본어", "난이도 부적절", "기타"] as const;
