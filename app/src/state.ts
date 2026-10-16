import type { ContentRecord } from "../../shared/schema";
import { seedRecords } from "./content/seed";
import { indexRecords } from "./domain/content";
import { buildDiagnostic, diagnosticState, exposedContentIds, type DiagState } from "./domain/diagnostic";
import type { UserSettings } from "./domain/settings";
import { projectExamTarget, todayKey, type ExamTarget } from "./domain/target";
import type { SyncEvent } from "./storage/events";
import type { AppStorage } from "./storage/session";
import { DOMAINS, makePlan, type Plan, type PlanDomain } from "./domain/planner";
import { activeVersions, effectiveStatus, flagProjection, studyPool, type FlagInfo } from "./content/status";
import { computeRunway, dailyIntake, READING_NEW_PER_DAY, type Runway } from "./domain/progress";
import { buildQueue, observedSecondsPerCard, replayCards, wordStage, type CardState, type ReviewQueue, type Stage } from "./domain/srs";
import { allCards, directionsFor } from "./domain/cards";
import { kanaPairs } from "./domain/kana";
import { dictationItems, listeningUnits, LISTENING_NEW_PER_DAY } from "./domain/listening";

export interface AppModel {
  /** every stored row (all versions) */
  rows: ContentRecord[];
  /** active version per contentId */
  records: ContentRecord[];
  /** active, studyable, not flagged (UNVERIFIED only when the setting is on) */
  pool: ContentRecord[];
  flags: Map<string, FlagInfo>;
  retired: Set<string>;
  runway: Runway;
  byId: Map<string, ContentRecord>;
  events: SyncEvent[];
  examTarget: ExamTarget;
  diag: DiagState;
  today: string;
  activeSecondsToday: number;
  pending: number;
  plan: Plan | null;
  exposed: Set<string>;
  /** LEARN questions not yet shown to the learner. */
  studyQuestions: ContentRecord[];
  /** review engine */
  cards: CardState[];
  cardStates: Map<string, CardState>;
  grammarStages: Stage[];
  grammarPoints: ContentRecord[];
  kanaPairs: number;
  /** next unseen reading passage (with its questions) and whether today's intake allows it */
  readingNext: { passage: ContentRecord; questions: ContentRecord[] } | null;
  readingToday: number;
  /** next unseen listening items (today's intake already subtracted) and the dictation set */
  listeningNext: { listening: ContentRecord; question: ContentRecord }[];
  listeningToday: number;
  dictation: ContentRecord[];
  review: ReviewQueue;
  secondsPerCard: number;
  newToday: number;
  vocabStages: Stage[];
  vocab: ContentRecord[];
  /** why a domain is not part of today's plan */
  notes: Partial<Record<PlanDomain, string>>;
}

const SECONDS_PER_QUESTION = 60; // [실무 제안] for capacity estimates only

export async function loadModel(storage: AppStorage | undefined, settings: UserSettings, now = new Date()): Promise<AppModel> {
  const events = storage ? (await storage.store.listEvents()).map((s) => s.event) : [];
  const stored = storage ? await storage.store.listContent() : [];
  const seen = new Set<string>();
  const rows = [...seedRecords(), ...stored].filter((r) => { const k = `${r.contentId}@${r.contentVersion}`; if (seen.has(k)) return false; seen.add(k); return true; });
  const fp = flagProjection(events);
  const records = activeVersions(rows);
  const byId = indexRecords(records);
  const pool = studyPool(rows, fp, settings.includeUnverified);
  const today = todayKey(now, settings.timezone);
  const diagItems = buildDiagnostic(records.filter((r) => effectiveStatus(r, fp) === "VERIFIED"), settings.targetLevel);
  const diag = diagnosticState(diagItems, events);
  const exposed = exposedContentIds(events, new Map(records.filter((r) => r.kind === "QUESTION").map((r) => [r.contentId, r.payload.stimulusId as string | undefined])));
  const ids = new Set(pool.map((r) => r.contentId));
  const listeningQuestionIds = new Set(pool.filter((r) => r.kind === "LISTENING").map((r) => String(r.payload.questionId)));
  const hasParent = (r: ContentRecord) => listeningQuestionIds.has(r.contentId) || [r.payload.linkedContentId, r.payload.stimulusId].some((x) => typeof x === "string" && ids.has(x));
  // questions of a grammar point, passage or listening item are served through that parent, not as loose practice
  const studyQuestions = pool.filter((r) => r.kind === "QUESTION" && r.pool === "LEARN" && !exposed.has(r.contentId) && !hasParent(r));
  let activeSecondsToday = 0;
  for (const e of events) {
    if (e.type !== "STUDY_INTERVAL_COMPLETED") continue;
    const p = JSON.parse(e.payloadJson);
    if (p.dayKey === today) activeSecondsToday += Number(p.seconds) || 0;
  }
  const route = diag.routing.route === "PROVISIONAL" ? null : diag.routing.route;
  const notes: AppModel["notes"] = { KANA: "콘텐츠 준비 중", VOCAB: "콘텐츠 준비 중", READING: "콘텐츠 준비 중", LISTENING: "콘텐츠 준비 중" };
  // review engine: cards from the vocabulary in the pool + replayed state
  const vocab = pool.filter((r) => r.kind === "VOCAB" && r.pool === "LEARN");
  const states = replayCards(events);
  const cards = allCards(pool, states);
  const grammarPoints = pool.filter((r) => r.kind === "GRAMMAR" && r.pool === "LEARN");
  const secondsPerCard = observedSecondsPerCard(events);
  const isGrammarCard = (c: CardState) => grammarPoints.some((g) => g.contentId === c.contentId);
  const groupOf = (c: CardState) => (isGrammarCard(c) ? "GRAMMAR" : "VOCAB");
  // items (words / grammar points) first answered today, per group
  const startedToday: Record<string, Set<string>> = { VOCAB: new Set(), GRAMMAR: new Set() };
  for (const c of cards) if (c.firstDay === today) startedToday[groupOf(c)]!.add(c.contentId);
  const newTodayBy = { VOCAB: startedToday.VOCAB!.size, GRAMMAR: startedToday.GRAMMAR!.size };
  const newToday = newTodayBy.VOCAB + newTodayBy.GRAMMAR;
  const remainingMinutes = Math.max(0, Math.floor((settings.dailyBudgetMinutes * 60 - activeSecondsToday) / 60));
  const intake = dailyIntake(route);
  const review = buildQueue({ cards, today, newCaps: route ? { VOCAB: intake.VOCAB, GRAMMAR: intake.GRAMMAR } : { VOCAB: 0, GRAMMAR: 0 }, groupOf, secondsPerCard, availableMinutes: remainingMinutes, newToday: newTodayBy });
  const vocabStages = vocab.map((r) => wordStage(states, r.contentId, directionsFor(r, pool)));
  const grammarStages = grammarPoints.filter((g) => directionsFor(g, pool).length).map((g) => wordStage(states, g.contentId, directionsFor(g, pool)));
  // reading: one new passage per day, each with all of its verified questions
  const firstSeenDay = new Map<string, string>();
  for (const e of events) {
    if (e.type !== "QUESTION_PRESENTED") continue;
    const sid = JSON.parse(e.payloadJson).stimulusId as string | null | undefined;
    if (sid && !firstSeenDay.has(sid)) firstSeenDay.set(sid, todayKey(new Date(e.occurredAt), settings.timezone));
  }
  const kindOf = new Map(pool.map((r) => [r.contentId, r.kind]));
  const readingToday = [...firstSeenDay.entries()].filter(([id, d]) => d === today && kindOf.get(id) === "PASSAGE").length;
  const questionsOf = (p: ContentRecord) => pool.filter((q) => q.kind === "QUESTION" && q.payload.stimulusId === p.contentId).sort((a, b) => a.contentId.localeCompare(b.contentId));
  const unseenPassages = pool.filter((r) => r.kind === "PASSAGE" && r.pool === "LEARN" && !exposed.has(r.contentId) && questionsOf(r).length > 0).sort((a, b) => a.contentId.localeCompare(b.contentId));
  const readingNext = unseenPassages[0] && readingToday < READING_NEW_PER_DAY ? { passage: unseenPassages[0], questions: questionsOf(unseenPassages[0]) } : null;
  const listeningToday = [...firstSeenDay.entries()].filter(([id, d]) => d === today && kindOf.get(id) === "LISTENING").length;
  const listeningUnseen = listeningUnits(pool).filter((u) => !exposed.has(u.listening.contentId));
  const listeningNext = listeningUnseen.slice(0, Math.max(0, LISTENING_NEW_PER_DAY - listeningToday));
  const sessionVocab = review.session.filter((c) => !isGrammarCard(c));
  const sessionGrammar = review.session.filter(isGrammarCard);
  const available = Object.fromEntries(DOMAINS.map((d) => [d, (d === "GRAMMAR" && (studyQuestions.length > 0 || sessionGrammar.length > 0)) || (d === "VOCAB" && sessionVocab.length > 0) || (d === "READING" && !!readingNext) || (d === "LISTENING" && listeningNext.length > 0)])) as Record<PlanDomain, boolean>;
  if (!available.GRAMMAR) notes.GRAMMAR = grammarPoints.length ? "오늘 복습·새 문법이 없음" : "콘텐츠 준비 중";
  if (!available.VOCAB && vocab.length >= 4) notes.VOCAB = "오늘 복습·새 카드가 없음";
  if (!available.READING && unseenPassages.length) notes.READING = "오늘의 새 지문은 이미 읽음";
  const plan = route
    ? makePlan({ route, activeSecondsToday, dailyBudgetMinutes: settings.dailyBudgetMinutes, available, capacityMinutes: { GRAMMAR: Math.ceil((studyQuestions.length * SECONDS_PER_QUESTION + sessionGrammar.length * secondsPerCard) / 60), VOCAB: Math.ceil((sessionVocab.length * secondsPerCard) / 60), READING: readingNext ? Math.ceil((readingNext.questions.length * SECONDS_PER_QUESTION) / 60) : 0, LISTENING: Math.ceil((listeningNext.length * 90) / 60) } })
    : null;
  const unseenItems = (grammar: boolean) => new Set(cards.filter((c) => isGrammarCard(c) === grammar && cards.filter((x) => x.contentId === c.contentId).every((x) => x.reviews === 0 && x.dueAt === null)).map((c) => c.contentId)).size;
  const runway = computeRunway(pool, events, route, { unseenVocabWords: unseenItems(false), unseenGrammarPoints: unseenItems(true) });
  return {
    cards, cardStates: states, grammarStages, grammarPoints, kanaPairs: kanaPairs(pool).length, readingNext, readingToday, listeningNext, listeningToday, dictation: dictationItems(pool), review, secondsPerCard, newToday, vocabStages, vocab,
    rows, records, pool, flags: fp.flagged, retired: fp.retired, runway, byId, events, examTarget: projectExamTarget(events, settings.targetLevel), diag, today, activeSecondsToday,
    pending: storage ? (await storage.pendingCount()) : 0, plan, exposed, studyQuestions, notes,
  };
}
