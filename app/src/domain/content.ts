import type { ContentRecord } from "../../../shared/schema";
import type { QuizItem } from "./quiz";

export const tagValue = (r: ContentRecord, prefix: string): string | undefined => r.tags.find((t) => t.startsWith(prefix))?.slice(prefix.length);

/** Builds a QuizItem from a QUESTION record. Reading questions carry their passage in the stem pane. */
export function toQuizItem(q: ContentRecord, byId: Map<string, ContentRecord>): QuizItem {
  const p = q.payload;
  const passage = p.stimulusId ? byId.get(p.stimulusId as string) : undefined;
  const lead = passage ? (passage.payload.pages as string[]).join("\n") + "\n" : "";
  return {
    id: q.contentId,
    stem: lead + (p.stem as string),
    choices: (p.choices as QuizItem["choices"]).map((c) => ({ ...c })),
    correctChoiceId: p.correctChoiceId as string,
    explanationKo: p.explanationKo as string,
    stimulusId: p.stimulusId as string | undefined,
  };
}

export const indexRecords = (rs: ContentRecord[]): Map<string, ContentRecord> => new Map(rs.map((r) => [r.contentId, r]));
