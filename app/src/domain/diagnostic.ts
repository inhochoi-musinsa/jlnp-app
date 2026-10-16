import type { ContentRecord } from "../../../shared/schema";
import type { SyncEvent } from "../storage/events";
import { replayOrder } from "../storage/events";
import { tagValue } from "./content";

export const DIAG_GROUPS = ["KANA", "FOUNDATION", "TARGET_LANGUAGE", "TARGET_READING"] as const;
export type DiagGroup = (typeof DIAG_GROUPS)[number];
export type Route = "KANA_FOUNDATION" | "FOUNDATION" | "TARGET_FOCUS";
export type RouteResult = "PROVISIONAL" | Route;

export interface DiagItem { record: ContentRecord; group: DiagGroup }

/** Diagnostic items in fixed group order, from the DIAG pool of the available content. */
export function buildDiagnostic(records: ContentRecord[], level?: string): DiagItem[] {
  const out: DiagItem[] = [];
  for (const g of DIAG_GROUPS) {
    for (const r of records) {
      if (r.kind !== "QUESTION" || r.pool !== "DIAG" || r.verification.status !== "VERIFIED") continue;
      if (tagValue(r, "diag:") !== g) continue;
      if (g === "TARGET_LANGUAGE" || g === "TARGET_READING") { if (level && r.level !== level) continue; }
      out.push({ record: r, group: g });
    }
  }
  return out;
}

export interface GroupScore { answered: number; correct: number; total: number }
export type Scores = Record<DiagGroup, GroupScore>;

export interface DiagRouting {
  route: RouteResult;
  borderline: boolean;
  routeEvidence: "PROVISIONAL";
  listeningEvidence: "NOT_MEASURED";
}

/** plan.md §4.1 routing rule. 8/8 items are required in KANA and FOUNDATION before a route is set. */
export function routeFromScores(s: Scores): DiagRouting {
  const base = { routeEvidence: "PROVISIONAL" as const, listeningEvidence: "NOT_MEASURED" as const };
  const k = s.KANA, f = s.FOUNDATION;
  if (k.answered < k.total || f.answered < f.total) return { ...base, route: "PROVISIONAL", borderline: false };
  const borderline = k.correct === 7 || f.correct === 6;
  if (k.correct <= 6) return { ...base, route: "KANA_FOUNDATION", borderline };
  if (f.correct <= 5) return { ...base, route: "FOUNDATION", borderline };
  return { ...base, route: "TARGET_FOCUS", borderline };
}

export const ROUTE_LABEL: Record<RouteResult, string> = {
  PROVISIONAL: "진단 진행 중",
  KANA_FOUNDATION: "가나·기초부터",
  FOUNDATION: "기초 보강",
  TARGET_FOCUS: "목표 등급 중심",
};

export interface DiagAnswer { contentId: string; selectedChoiceId: string; isCorrect: boolean; elapsedActiveMs: number }

/** Replays QUESTION_SUBMITTED events of the diagnostic. The first submission per item wins (no second submit). */
export function diagnosticAnswers(events: SyncEvent[], diagIds: Set<string>): Map<string, DiagAnswer> {
  const out = new Map<string, DiagAnswer>();
  for (const e of [...events].sort(replayOrder)) {
    if (e.type !== "QUESTION_SUBMITTED") continue;
    const p = JSON.parse(e.payloadJson);
    if (p.exposureType !== "DIAGNOSTIC" || !diagIds.has(p.contentId) || out.has(p.contentId)) continue;
    out.set(p.contentId, { contentId: p.contentId, selectedChoiceId: p.selectedChoiceId, isCorrect: !!p.isCorrect, elapsedActiveMs: p.elapsedActiveMs ?? 0 });
  }
  return out;
}

export function scoreDiagnostic(items: DiagItem[], answers: Map<string, DiagAnswer>): Scores {
  const s = Object.fromEntries(DIAG_GROUPS.map((g) => [g, { answered: 0, correct: 0, total: 0 }])) as Scores;
  for (const it of items) {
    const g = s[it.group];
    g.total++;
    const a = answers.get(it.record.contentId);
    if (a) { g.answered++; if (a.isCorrect) g.correct++; }
  }
  return s;
}

export interface DiagState { total: number; answered: number; remaining: DiagItem[]; completed: boolean; scores: Scores; routing: DiagRouting }
export function diagnosticState(items: DiagItem[], events: SyncEvent[]): DiagState {
  const answers = diagnosticAnswers(events, new Set(items.map((i) => i.record.contentId)));
  const scores = scoreDiagnostic(items, answers);
  const remaining = items.filter((i) => !answers.has(i.record.contentId));
  return { total: items.length, answered: answers.size, remaining, completed: items.length > 0 && remaining.length === 0, scores, routing: routeFromScores(scores) };
}

/** Everything the learner has already seen (any exposure) can never be reused as a fresh assessment item. */
export function exposedContentIds(events: SyncEvent[], questionToStimulus: Map<string, string | undefined> = new Map()): Set<string> {
  const ids = new Set<string>();
  for (const e of events) {
    if (e.type !== "QUESTION_PRESENTED" && e.type !== "QUESTION_SUBMITTED") continue;
    const p = JSON.parse(e.payloadJson);
    if (p.contentId) { ids.add(p.contentId); if (p.refId) ids.add(p.refId); const st = p.stimulusId ?? questionToStimulus.get(p.contentId); if (st) ids.add(st); }
  }
  return ids;
}

export const isFreshForAssessment = (r: ContentRecord, exposed: Set<string>): boolean =>
  r.pool === "ASSESS" && !exposed.has(r.contentId) && !(r.payload.stimulusId && exposed.has(r.payload.stimulusId as string));
