import type { ContentRecord } from "../../../shared/schema";
import { getExamSpec, scoringSectionFor, type Level, type ScoringSectionId } from "../../../shared/examSpec";
import type { SyncEvent } from "../storage/events";
import { eligibleForAssessment, type AudioSource } from "./listening";
import { daysBetween, todayKey } from "./target";

/**
 * Readiness (plan.md §9). Only observable facts about NEW assessment questions are reported: right/answered counts,
 * sample size, coverage and elapsed time. No pass probability, no estimated JLPT scaled score, no official 19-point verdict.
 * The numbers below are [실무 제안] operating policy, not validated cut-offs.
 */
export const READINESS_WINDOW_DAYS = 28;
export const MIN_SAMPLE = 20;
export const WILSON_MIN_SAMPLE = 30;
export const WEAK_ACCURACY = 0.6;
export const WEAK_GAP = 0.15;

export type Evidence = "NONE" | "INSUFFICIENT" | "OBSERVED";
export interface Attempt { contentId: string; section: ScoringSectionId; correct: boolean; stimulusKey: string; source: AudioSource | null; elapsedMs: number; at: string }
export interface SectionReadiness {
  id: ScoringSectionId;
  n: number;
  k: number;
  accuracy: number | null;
  evidence: Evidence;
  /** a passage or listening item counts once even when several questions hang on it */
  uniqueStimuli: number;
  avgSeconds: number | null;
  /** 95% Wilson interval of the app's own question sample (never of the real exam), only for n >= WILSON_MIN_SAMPLE */
  interval: { lo: number; hi: number } | null;
  /** listening only: how many valid attempts used each audio source */
  sources: Partial<Record<AudioSource, number>> | null;
  weak: boolean;
}
export interface Readiness {
  level: Level;
  windowDays: number;
  sections: SectionReadiness[];
  /** NONE: nothing measured; INSUFFICIENT: at least one section n<MIN_SAMPLE; OBSERVED: all sections have enough */
  overall: Evidence;
  excluded: { reason: "NOT_FIRST_EXPOSURE" | "ANSWER_SEEN_BEFORE" | "AUDIO_INVALID" | "OUT_OF_WINDOW" | "NOT_ASSESS_POOL"; count: number }[];
}

export function wilson(k: number, n: number, z = 1.96): { lo: number; hi: number } {
  if (n <= 0) return { lo: 0, hi: 1 };
  const p = k / n, d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return { lo: Math.max(0, (c - m) / d), hi: Math.min(1, (c + m) / d) };
}

const sectionOf = (r: ContentRecord, level: Level): ScoringSectionId => {
  const s = r.payload.scoringSection;
  const known = getExamSpec(level).scoringSections.map((x) => x.id) as string[];
  return typeof s === "string" && known.includes(s) ? (s as ScoringSectionId) : scoringSectionFor(level, String(r.payload.domain));
};

export function collectAttempts(events: SyncEvent[], byId: Map<string, ContentRecord>, level: Level, now: Date, tz = "Asia/Seoul"): { attempts: Attempt[]; excluded: Map<string, number> } {
  const excluded = new Map<string, number>();
  const bump = (k: string) => excluded.set(k, (excluded.get(k) ?? 0) + 1);
  const learned = new Set<string>();      // contentIds / stimulus ids seen outside an assessment before
  const assessed = new Set<string>();     // contentIds already attempted in an assessment
  const revealed = new Set<string>();     // answers already shown for a content id
  const attempts: Attempt[] = [];
  const today = todayKey(now, tz);
  const ordered = [...events].sort((a, b) => a.deviceSeq - b.deviceSeq || a.occurredAt.localeCompare(b.occurredAt));
  const presented = new Map<string, number>();
  for (const e of ordered) {
    const p = JSON.parse(e.payloadJson);
    if (e.type === "ANSWER_REVEALED" && p.contentId) { revealed.add(p.contentId); continue; }
    if (e.type !== "QUESTION_PRESENTED" && e.type !== "QUESTION_SUBMITTED") continue;
    const id = p.contentId as string | undefined;
    if (!id) continue;
    const isAssessment = p.exposureType === "ASSESSMENT";
    if (e.type === "QUESTION_PRESENTED") {
      if (isAssessment) { if (!presented.has(id)) presented.set(id, 1); } else { learned.add(id); if (p.refId) learned.add(p.refId); if (p.stimulusId) learned.add(p.stimulusId); }
      continue;
    }
    // QUESTION_SUBMITTED
    if (!isAssessment) { learned.add(id); if (p.refId) learned.add(p.refId); if (p.stimulusId) learned.add(p.stimulusId); continue; }
    const rec = byId.get(id);
    if (!rec || rec.kind !== "QUESTION" || rec.level !== level) continue;
    if (rec.pool !== "ASSESS") { bump("NOT_ASSESS_POOL"); continue; }
    const day = todayKey(new Date(e.occurredAt), tz);
    if (daysBetween(day, today) >= READINESS_WINDOW_DAYS) { bump("OUT_OF_WINDOW"); continue; }
    const stim = (rec.payload.stimulusId as string | undefined) ?? (p.stimulusId as string | undefined) ?? null;
    if (learned.has(id) || (stim && learned.has(stim)) || assessed.has(id)) { bump("NOT_FIRST_EXPOSURE"); assessed.add(id); continue; }
    assessed.add(id);
    if (revealed.has(id)) { bump("ANSWER_SEEN_BEFORE"); continue; }
    const section = sectionOf(rec, level);
    const source = (p.audioSource ?? null) as AudioSource | null;
    if (section === "LISTENING" && (!source || !eligibleForAssessment(source, false) || !(Number(p.plays) >= 1))) { bump("AUDIO_INVALID"); continue; }
    attempts.push({ contentId: id, section, correct: p.isCorrect === true, stimulusKey: stim ?? id, source: section === "LISTENING" ? source : null, elapsedMs: Number(p.elapsedActiveMs) || 0, at: e.occurredAt });
  }
  return { attempts, excluded };
}

export function computeReadiness(events: SyncEvent[], byId: Map<string, ContentRecord>, level: Level, now = new Date(), tz = "Asia/Seoul"): Readiness {
  const { attempts, excluded } = collectAttempts(events, byId, level, now, tz);
  const spec = getExamSpec(level);
  const sections: SectionReadiness[] = spec.scoringSections.map((s) => {
    const mine = attempts.filter((a) => a.section === s.id);
    const n = mine.length, k = mine.filter((a) => a.correct).length;
    const sources: Partial<Record<AudioSource, number>> | null = s.id === "LISTENING" ? {} : null;
    if (sources) for (const a of mine) if (a.source) sources[a.source] = (sources[a.source] ?? 0) + 1;
    return {
      id: s.id, n, k, accuracy: n ? k / n : null,
      evidence: n === 0 ? "NONE" : n < MIN_SAMPLE ? "INSUFFICIENT" : "OBSERVED",
      uniqueStimuli: new Set(mine.map((a) => a.stimulusKey)).size,
      avgSeconds: n ? Math.round(mine.reduce((t, a) => t + a.elapsedMs, 0) / n / 1000) : null,
      interval: n >= WILSON_MIN_SAMPLE ? wilson(k, n) : null,
      sources, weak: false,
    };
  });
  const measured = sections.filter((s) => s.n > 0);
  const overall: Evidence = measured.length === 0 ? "NONE" : sections.every((s) => s.evidence === "OBSERVED") ? "OBSERVED" : "INSUFFICIENT";
  // relative weakness is only judged when every section has enough data (plan.md §9.3)
  if (overall === "OBSERVED") {
    const best = Math.max(...sections.map((s) => s.accuracy ?? 0));
    for (const s of sections) s.weak = (s.accuracy ?? 1) < WEAK_ACCURACY || best - (s.accuracy ?? 1) >= WEAK_GAP;
  }
  const order = ["NOT_FIRST_EXPOSURE", "ANSWER_SEEN_BEFORE", "AUDIO_INVALID", "OUT_OF_WINDOW", "NOT_ASSESS_POOL"] as const;
  return { level, windowDays: READINESS_WINDOW_DAYS, sections, overall, excluded: order.filter((r) => excluded.get(r)).map((reason) => ({ reason, count: excluded.get(reason)! })) };
}

export const SECTION_NAME: Record<ScoringSectionId, string> = { LANGUAGE_KNOWLEDGE: "언어지식(어휘·문법)", READING: "독해", LISTENING: "청해", LANGUAGE_KNOWLEDGE_READING: "언어지식·독해" };
export const EVIDENCE_LABEL: Record<Evidence, string> = { NONE: "측정 없음", INSUFFICIENT: "자료 부족", OBSERVED: "관찰됨" };
export const EXCLUDED_LABEL: Record<Readiness["excluded"][number]["reason"], string> = {
  NOT_FIRST_EXPOSURE: "이미 본 문항이라 제외", ANSWER_SEEN_BEFORE: "정답을 먼저 보고 푼 문항이라 제외", AUDIO_INVALID: "음원이 재생되지 않았거나 브라우저 음성이라 제외",
  OUT_OF_WINDOW: "최근 28일 밖이라 제외", NOT_ASSESS_POOL: "평가용 문항이 아니라 제외",
};

/** Lines for one section. Never a probability, never an estimated official score. */
export function sectionLines(s: SectionReadiness): string[] {
  const out: string[] = [];
  if (s.n === 0) return ["아직 평가 문항을 풀지 않았습니다."];
  out.push(`맞은 수/푼 수: ${s.k} / ${s.n}${s.accuracy !== null ? ` (정답률 ${Math.round(s.accuracy * 100)}%)` : ""}`);
  out.push(`서로 다른 지문·문항: ${s.uniqueStimuli}개${s.avgSeconds !== null ? ` · 평균 ${s.avgSeconds}초` : ""}`);
  if (s.evidence === "INSUFFICIENT") out.push(`자료 부족 — 표본이 ${MIN_SAMPLE}문항 미만이라 판단하지 않습니다.`);
  if (s.interval) out.push(`자체 문항 표본의 참고 구간 ${Math.round(s.interval.lo * 100)}~${Math.round(s.interval.hi * 100)}% (실제 JLPT 합격점에 대한 구간이 아닙니다)`);
  return out;
}

export const WEAK_NOTE = "상대적으로 취약합니다. JLPT 공식 과락 기준은 척도점수이며, 앱 정답률을 그 점수로 변환할 수 없습니다. 학습 우선순위를 정하는 참고용입니다.";
