import type { ContentRecord } from "../../../shared/schema";
import { SOURCE_LABEL, TTS_LIMIT_NOTICE, overridePath, audioPath, type AudioRef, type Segment } from "../../../shared/audio";
import type { QuizItem } from "./quiz";

export type AudioSource = AudioRef["source"];
export { SOURCE_LABEL, TTS_LIMIT_NOTICE };

/** plan.md/execution_plan §5.2: BROWSER_TTS never counts for assessment unless the learner opts in. */
export function eligibleForAssessment(source: AudioSource, allowBrowserTts: boolean): boolean {
  return source === "GENERATED_FILE" || source === "RECORDED" || (source === "BROWSER_TTS" && allowBrowserTts);
}

export interface ListeningAudio {
  /** the LISTENING record */
  listeningId: string;
  ref?: AudioRef;
  segments: Segment[];
  taskType: string;
}

export const LISTENING_NEW_PER_DAY = 2;

/** The listening items a learner can still do (question linked to a verified LISTENING record that is not a dictation item). */
export function listeningUnits(pool: ContentRecord[]): { listening: ContentRecord; question: ContentRecord }[] {
  const out: { listening: ContentRecord; question: ContentRecord }[] = [];
  const questions = new Map(pool.filter((r) => r.kind === "QUESTION").map((r) => [r.contentId, r]));
  for (const l of pool) {
    if (l.kind !== "LISTENING" || l.pool !== "LEARN" || l.payload.dictation === true) continue;
    const q = questions.get(String(l.payload.questionId));
    if (q) out.push({ listening: l, question: q });
  }
  return out.sort((a, b) => a.listening.contentId.localeCompare(b.listening.contentId));
}

export const dictationItems = (pool: ContentRecord[]): ContentRecord[] =>
  pool.filter((r) => r.kind === "LISTENING" && r.payload.dictation === true && r.pool === "LEARN").sort((a, b) => a.contentId.localeCompare(b.contentId));

export function quizItemFor(unit: { listening: ContentRecord; question: ContentRecord }): QuizItem {
  const p = unit.question.payload;
  return {
    id: unit.question.contentId, stem: p.stem as string, choices: (p.choices as QuizItem["choices"]).map((c) => ({ ...c })),
    correctChoiceId: p.correctChoiceId as string, explanationKo: p.explanationKo as string, stimulusId: unit.listening.contentId,
    audio: { listeningId: unit.listening.contentId, ref: unit.listening.payload.audio as AudioRef | undefined, segments: unit.listening.payload.segments as Segment[], taskType: String(unit.listening.payload.taskType) },
  };
}

/* ---- dictation ---- */

const strip = (s: string) => s.normalize("NFKC").replace(/[\s　、。，．,.!！?？「」『』・…]/g, "");
export interface DiffPart { text: string; kind: "same" | "missing" | "extra" }

/** Character diff (LCS) between what was expected and what was typed. */
export function diffChars(expected: string, typed: string): DiffPart[] {
  const a = [...strip(expected)], b = [...strip(typed)];
  const n = a.length, m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const out: DiffPart[] = [];
  const push = (kind: DiffPart["kind"], ch: string) => { const last = out[out.length - 1]; if (last && last.kind === kind) last.text += ch; else out.push({ text: ch, kind }); };
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { push("same", a[i]!); i++; j++; }
    else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) { push("missing", a[i]!); i++; }
    else { push("extra", b[j]!); j++; }
  }
  while (i < n) push("missing", a[i++]!);
  while (j < m) push("extra", b[j++]!);
  return out;
}

const toHira = (s: string) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
export interface DictationResult { correct: boolean; diff: DiffPart[]; scriptOnly: boolean }

/** Exact kana match after NFKC and without spaces/punctuation; a hiragana/katakana mix-up is reported separately. */
export function checkDictation(expectedReading: string, typed: string): DictationResult {
  const e = strip(expectedReading), t = strip(typed);
  const correct = e === t;
  return { correct, diff: correct ? [{ text: e, kind: "same" }] : diffChars(e, t), scriptOnly: !correct && toHira(e) === toHira(t) };
}

/* ---- audio source resolution (pure parts; the element lives in ui/audio.ts) ---- */

export const fileUrlFor = (key: string, base = ""): string => `${base}./${audioPath(key)}`;
export const overrideUrlFor = (contentId: string, base = ""): string => `${base}./${overridePath(contentId)}`;
