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
import { computeRunway, type Runway } from "./domain/progress";

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
  const studyQuestions = pool.filter((r) => r.kind === "QUESTION" && r.pool === "LEARN" && !exposed.has(r.contentId));
  let activeSecondsToday = 0;
  for (const e of events) {
    if (e.type !== "STUDY_INTERVAL_COMPLETED") continue;
    const p = JSON.parse(e.payloadJson);
    if (p.dayKey === today) activeSecondsToday += Number(p.seconds) || 0;
  }
  const route = diag.routing.route === "PROVISIONAL" ? null : diag.routing.route;
  const notes: AppModel["notes"] = {
    KANA: "콘텐츠 준비 중", VOCAB: "카드 복습은 v1.0.0에서 제공", READING: "콘텐츠 준비 중", LISTENING: "콘텐츠 준비 중",
  };
  const available = Object.fromEntries(DOMAINS.map((d) => [d, d === "GRAMMAR" && studyQuestions.length > 0])) as Record<PlanDomain, boolean>;
  if (!available.GRAMMAR) notes.GRAMMAR = "오늘 학습할 문제가 없음";
  const plan = route
    ? makePlan({ route, activeSecondsToday, dailyBudgetMinutes: settings.dailyBudgetMinutes, available, capacityMinutes: { GRAMMAR: Math.ceil((studyQuestions.length * SECONDS_PER_QUESTION) / 60) } })
    : null;
  const runway = computeRunway(pool, events, route);
  return {
    rows, records, pool, flags: fp.flagged, retired: fp.retired, runway, byId, events, examTarget: projectExamTarget(events, settings.targetLevel), diag, today, activeSecondsToday,
    pending: storage ? (await storage.pendingCount()) : 0, plan, exposed, studyQuestions, notes,
  };
}
