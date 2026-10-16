import type { ContentRecord } from "../../../shared/schema";
import { getExamSpec, scoringSectionFor, type Level, type ScoringSectionId } from "../../../shared/examSpec";
import type { QuizItem } from "./quiz";
import { toQuizItem } from "./content";
import { isFreshForAssessment } from "./diagnostic";
import { quizItemFor } from "./listening";

/** Target number of questions in one assessment set per scoring section ([실무 제안]). Passages are never split. */
export const SET_SIZE: Record<ScoringSectionId, number> = { LANGUAGE_KNOWLEDGE: 10, READING: 6, LISTENING: 6, LANGUAGE_KNOWLEDGE_READING: 10 };

export interface AssessmentSet { section: ScoringSectionId; items: QuizItem[]; available: number }

const sectionOf = (q: ContentRecord, level: Level): ScoringSectionId => {
  const s = q.payload.scoringSection;
  const known = getExamSpec(level).scoringSections.map((x) => x.id) as string[];
  return typeof s === "string" && known.includes(s) ? (s as ScoringSectionId) : scoringSectionFor(level, String(q.payload.domain));
};

/**
 * Fresh ASSESS questions of one scoring section. A passage's questions (or a listening item's question) are served together;
 * anything the learner has ever been shown (learning, diagnostic or an earlier assessment) is never used again.
 */
export function assessmentSet(assessPool: ContentRecord[], byId: Map<string, ContentRecord>, exposed: Set<string>, level: Level, section: ScoringSectionId): AssessmentSet {
  const qs = assessPool.filter((r) => r.kind === "QUESTION" && r.level === level && sectionOf(r, level) === section && isFreshForAssessment(r, exposed));
  const listeningOf = new Map<string, ContentRecord>();
  for (const l of assessPool) if (l.kind === "LISTENING" && l.payload.dictation !== true) listeningOf.set(String(l.payload.questionId), l);
  const groups = new Map<string, ContentRecord[]>();
  for (const q of qs.sort((a, b) => a.contentId.localeCompare(b.contentId))) {
    const g = listeningOf.get(q.contentId)?.contentId ?? (q.payload.stimulusId as string | undefined) ?? q.contentId;
    if (exposed.has(g)) continue;
    (groups.get(g) ?? groups.set(g, []).get(g)!).push(q);
  }
  const items: QuizItem[] = [];
  const want = SET_SIZE[section];
  for (const [g, list] of groups) {
    if (items.length >= want) break;
    const lis = listeningOf.get(list[0]!.contentId);
    if (lis) items.push(quizItemFor({ listening: lis, question: list[0]! }));
    else for (const q of list) items.push(toQuizItem(q, byId));
  }
  return { section, items, available: [...groups.values()].reduce((a, l) => a + l.length, 0) };
}
